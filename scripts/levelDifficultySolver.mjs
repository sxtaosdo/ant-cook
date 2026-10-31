// Offline content verification; never imported by the game runtime.
export function createSolver(level, capacity) {
  const bits = level.cells.map((_, index) => 1n << BigInt(index));
  const bitIndex = new Map(bits.map((bit, index) => [bit, index]));
  const coordinates = new Map(level.cells.map((cell, index) => [`${cell.row}.${cell.column}`, index]));
  const neighborMasks = [], colorMasks = new Map();
  let exposed = 0n;
  level.cells.forEach((cell, index) => {
    let neighbors = 0n, count = 0;
    for (const [row, column] of [[cell.row - 1, cell.column], [cell.row + 1, cell.column], [cell.row, cell.column - 1], [cell.row, cell.column + 1]]) {
      const other = coordinates.get(`${row}.${column}`);
      if (other !== undefined) { neighbors |= bits[other]; count += 1; }
    }
    neighborMasks.push(neighbors);
    if (count < 4) exposed |= bits[index];
    colorMasks.set(cell.color, (colorMasks.get(cell.color) ?? 0n) | bits[index]);
  });
  const queues = Array.from({ length: 5 }, (_, pile) => level.groups.map((group, index) => ({ ...group, index }))
    .filter(group => group.pile === pile).sort((left, right) => left.depth - right.depth));
  const minRow = Math.min(...level.cells.map(cell => cell.row)), maxRow = Math.max(...level.cells.map(cell => cell.row));
  const minColumn = Math.min(...level.cells.map(cell => cell.column)), maxColumn = Math.max(...level.cells.map(cell => cell.column));
  const width = maxColumn - minColumn + 3, height = maxRow - minRow + 3, shift = BigInt(width);
  const gridBits = level.cells.map(cell => 1n << BigInt((cell.row - minRow + 1) * width + cell.column - minColumn + 1));
  const all = (1n << BigInt(width * height)) - 1n;
  let left = 0n, right = 0n;
  for (let row = 0; row < height; row += 1) {
    left |= 1n << BigInt(row * width); right |= 1n << BigInt(row * width + width - 1);
  }
  const adjacent = mask => (((mask & ~right) << 1n) | ((mask & ~left) >> 1n) | (mask << shift) | (mask >> shift)) & all;
  const gridNeighbors = gridBits.map(adjacent);
  const initial = { active: (1n << BigInt(bits.length)) - 1n, occupied: gridBits.reduce((mask, bit) => mask | bit, 0n), exposed,
    positions: [0, 0, 0, 0, 0], slots: Array(capacity).fill(null) };
  const targetOrder = level.cells.map((_, index) => index).sort((a, b) => level.cells[b].row - level.cells[a].row || a - b);
  let lastOccupied = null, lastExternal = 0n;
  function externalMask(state) {
    if (state.occupied === lastOccupied) return lastExternal;
    const empty = all ^ state.occupied;
    let reached = 1n, frontier = 1n;
    while (frontier) { frontier = adjacent(frontier) & empty & ~reached; reached |= frontier; }
    let external = 0n;
    for (let index = 0; index < bits.length; index += 1) {
      if ((state.active & bits[index]) && (gridNeighbors[index] & reached)) external |= bits[index];
    }
    lastOccupied = state.occupied; lastExternal = external; return external;
  }
  const key = state => `${state.active.toString(36)};${state.positions.join(',')};${state.slots.map(slot => slot ? `${slot.group}.${slot.remaining}` : '-').join(',')}`;
  function choose(state, pile) {
    const empty = state.slots.indexOf(null), group = queues[pile][state.positions[pile]];
    if (empty < 0 || !group) return null;
    const next = { ...state, positions: [...state.positions], slots: state.slots.map(slot => slot && { ...slot }) };
    next.positions[pile] += 1;
    next.slots[empty] = { group: group.index, color: group.color, remaining: group.count };
    while (true) {
      let reserved = 0n;
      for (let slotIndex = 0; slotIndex < capacity; slotIndex += 1) {
        const slot = next.slots[slotIndex];
        if (!slot) continue;
        const available = next.active & next.exposed & colorMasks.get(slot.color) & ~reserved & externalMask(next);
        if (!available) continue;
        const target = targetOrder.find(index => available & bits[index]);
        if (target === undefined) continue;
        const bit = bits[target];
        reserved |= bit;
        slot.remaining -= 1;
        if (slot.remaining === 0) next.slots[slotIndex] = null;
      }
      if (!reserved) break;
      next.active &= ~reserved;
      let arrivals = reserved;
      while (arrivals) {
        const bit = arrivals & -arrivals;
        const index = bitIndex.get(bit);
        next.exposed |= neighborMasks[index];
        next.occupied &= ~gridBits[index];
        arrivals &= ~bit;
      }
    }
    return { state: next, group: group.index };
  }
  function search({ failure = false, limit = Infinity } = {}) {
    const visited = new Set();
    let exhausted = true;
    function visit(state, trace) {
      if (state.active === 0n) return failure ? null : trace;
      if (state.slots.every(Boolean)) return failure ? trace : null;
      const fingerprint = key(state);
      if (visited.has(fingerprint)) return null;
      if (visited.size >= limit) { exhausted = false; return null; }
      visited.add(fingerprint);
      for (let pile = 0; pile < 5; pile += 1) {
        const move = choose(state, pile);
        if (!move) continue;
        const found = visit(move.state, [...trace, move.group]);
        if (found) return found;
      }
      return null;
    }
    const trace = visit(initial, []);
    return { trace, states: visited.size, exhausted };
  }
  return { initial, choose, queues, search, key };
}

export function proveNormalizedMinimum(level, maximum = 5, limit = 20000) {
  const lower = [];
  for (let capacity = 1; capacity <= maximum; capacity += 1) {
    const result = createSolver(level, capacity).search({ limit });
    if (result.trace) return { normalizedMinimum: capacity, winningTrace: result.trace, winningStates: result.states, lower };
    if (!result.exhausted) throw new Error(`UNKNOWN: capacity ${capacity} exceeded ${limit} normalized states`);
    lower.push({ capacity, states: result.states, solvable: false });
  }
  return { normalizedMinimum: null, winningTrace: null, lower };
}

const closureBoards = new WeakMap();

// Optimistically dispatch every B-colored cell using the core's four-neighbor
// exposure rule, including internal empty cavities. Timing can only reduce R.
export function blockingClosure(level, blockingColors) {
  let board = closureBoards.get(level.cells);
  if (!board) {
    const bits = level.cells.map((_, index) => 1n << BigInt(index));
    const coordinates = new Map(level.cells.map((cell, index) => [`${cell.row}.${cell.column}`, index]));
    const bitIndex = new Map(bits.map((bit, index) => [bit, index])), neighbors = [], colors = new Map();
    let exposed = 0n;
    level.cells.forEach((cell, index) => {
      let adjacent = 0n, count = 0;
      for (const [row, column] of [[cell.row - 1, cell.column], [cell.row + 1, cell.column], [cell.row, cell.column - 1], [cell.row, cell.column + 1]]) {
        const other = coordinates.get(`${row}.${column}`);
        if (other !== undefined) { adjacent |= bits[other]; count += 1; }
      }
      neighbors.push(adjacent);
      if (count < 4) exposed |= bits[index];
      colors.set(cell.color, (colors.get(cell.color) ?? 0n) | bits[index]);
    });
    board = { bitIndex, neighbors, colors, exposed }; closureBoards.set(level.cells, board);
  }
  const mask = blockingColors.reduce((value, color) => value | (board.colors.get(color) ?? 0n), 0n);
  let frontier = board.exposed & mask, cleared = 0n;
  const reached = Object.fromEntries(blockingColors.map(color => [color, 0]));
  while (frontier) {
    const bit = frontier & -frontier, index = board.bitIndex.get(bit);
    frontier &= ~bit; cleared |= bit; reached[level.cells[index].color] += 1;
    frontier |= board.neighbors[index] & mask & ~cleared;
  }
  return reached;
}

export function certifyBlockingPrefixes(level, blockingColors) {
  const allowed = new Set(blockingColors), reached = blockingClosure(level, blockingColors), prefixes = [];
  for (let pile = 0; pile < 5; pile += 1) {
    const queue = level.groups.filter(group => group.pile === pile).sort((a, b) => a.depth - b.depth);
    const firstProducer = queue.findIndex(group => !allowed.has(group.color));
    if (firstProducer < 0) continue;
    const prefix = queue.slice(0, firstProducer);
    let unfreed = prefix.length;
    for (const color of blockingColors) {
      let budget = reached[color];
      for (const count of prefix.filter(group => group.color === color).map(group => group.count).sort((a, b) => a - b)) {
        if (count > budget) break;
        budget -= count;
        unfreed -= 1;
      }
    }
    prefixes.push({ pile, groups: prefix.map(group => group.id), unfreed });
  }
  const lowerBound = prefixes.length ? Math.min(...prefixes.map(prefix => prefix.unfreed)) + 1 : 1;
  return { blockingColors, reached, prefixes, lowerBound };
}

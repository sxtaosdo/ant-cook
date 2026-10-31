// Offline reference replay using the real core; never imported by game runtime.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const modules = new Map();
function load(file) {
  file = resolve(file);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const require = name => load(resolve(dirname(file), `${name}.ts`));
  runInNewContext(`(function(require,module,exports){${code}\n})`)(require, module, module.exports);
  return module.exports;
}
const { ColonyFlowModel } = load('assets/Colony/scripts/gameModel.ts');
const { deriveBoardGeometry } = load('assets/Colony/scripts/presentation/boardGeometry.ts');

export const ASYNC_PROFILES = [
  { name: 'FIFO', fifo: true, height: 1334 },
  { name: 'route-compact', height: 1334 },
  { name: '30fps-compact', height: 1334, fps: 30 },
  { name: '60fps-compact', height: 1334, fps: 60 },
  { name: 'route-tall', height: 1624 },
  { name: '60fps-tall', height: 1624, fps: 60 },
  { name: 'route-preview', height: 1515.267175572519 },
  { name: '60fps-preview', height: 1515.267175572519, fps: 60 },
];

let cacheCells, routeCache = new Map(), exposureCache = new Map();
function createModel(level, saved) {
  if (cacheCells !== level.cells) { cacheCells = level.cells; routeCache.clear(); exposureCache.clear(); }
  const model = new ColonyFlowModel({ levels: [{ ...level, level: 1 }] });
  if (saved) {
    model.board.forEach((cell, index) => { cell.cleared = saved.cleared[index]; });
    model.slots = saved.slots.map(slot => slot && { ...slot });
    model.stacks = saved.stacks.map(stack => ({ ...stack }));
    model.transported = saved.transported;
    model.result = saved.result;
    model.activeCoordinates = new Set(model.board.filter(cell => !cell.cleared).map(cell => `${cell.row}:${cell.column}`));
    model.exposedCache = null;
  }
  // Exact coordinate lookup replaces repeated linear scans only in this offline copy.
  const coordinates = new Map(model.board.map(cell => [`${cell.row}:${cell.column}`, cell]));
  model.hasActiveCell = (row, column) => {
    const cell = coordinates.get(`${row}:${column}`);
    return Boolean(cell && !cell.cleared);
  };
  // Reuse exact geometry results across timing profiles, never across boards.
  const indices = new Map(model.board.map((cell, index) => [cell.id, index]));
  const bits = model.board.map((_, index) => 1n << BigInt(index));
  let active = model.board.reduce((mask, cell, index) => cell.cleared ? mask : mask | bits[index], 0n);
  const complete = model.completeTransport.bind(model), external = model.externalCells.bind(model), route = model.routeTo.bind(model);
  model.completeTransport = id => {
    const result = complete(id), index = indices.get(id);
    if (index !== undefined && model.board[index].cleared) active &= ~bits[index];
    return result;
  };
  model.externalCells = () => {
    // completeTransport asks for exposure both before and after clearing;
    // the wrapper's active mask is updated only after that method returns.
    const mask = model.board.reduce((value, cell, index) => cell.cleared ? value : value | bits[index], 0n);
    let exposed = exposureCache.get(mask);
    if (!exposed) {
      exposed = external().map(cell => indices.get(cell.id));
      if (exposureCache.size >= 10000) exposureCache.clear();
      exposureCache.set(mask, exposed);
    }
    return exposed.map(index => model.board[index]);
  };
  model.routeTo = (cell, slot) => {
    const key = `${active.toString(36)}:${slot}:${cell.id}`;
    if (!routeCache.has(key)) {
      if (routeCache.size >= 10000) routeCache.clear();
      routeCache.set(key, route(cell, slot));
    }
    return routeCache.get(key);
  };
  return model;
}
function save(model) {
  return { cleared: model.board.map(cell => cell.cleared), slots: model.slots.map(slot => slot && { ...slot }),
    stacks: model.stacks.map(stack => ({ ...stack })), transported: model.transported, result: model.result };
}
function movementTiming(level, mode, profile) {
  const scale = mode === 'main' && level.level === 1 ? 1 : 1.6;
  const geometry = deriveBoardGeometry(level.cells, mode === 'main' && [2, 6, 7].includes(level.level) ? 520 : 560);
  const extra = Math.max(0, (profile.height - 1334) / 2);
  const boardY = 86 + extra; // Current layout: root146 + Content(-90 + approved30).
  const boardScale = 0.925; // ColonyBoardView.setFirstLevelSkin; current scene-art path.
  const slotY = -15 - extra - Math.min(70, Math.max(0, 1600 - profile.height) * .82);
  const slotXs = (level.initialSlots ?? 5) === 6
    ? [-280, -168, -56, 56, 168, 280] : [-228, -114, 0, 114, 228];
  const quantize = seconds => profile.fps ? Math.ceil(seconds * profile.fps) / profile.fps : seconds;
  const duration = (from, to, speed) => {
    const distance = Math.hypot(from.x - to.x, from.y - to.y);
    return distance < 1 ? 0 : quantize(Math.max(.07, distance / speed) / scale);
  };
  const position = point => {
    const local = geometry.toPosition(point.row, point.column);
    return { x: local.x * boardScale, y: local.y * boardScale + boardY };
  };
  return move => {
    if (profile.fifo) return { arrival: .8, end: 1.5 };
    const route = move.route.filter((point, index, points) => index === 0 || index === points.length - 1
      || point.row - points[index - 1].row !== points[index + 1].row - point.row
      || point.column - points[index - 1].column !== points[index + 1].column - point.column);
    const points = route.map(position);
    const entry = position({ row: geometry.maxRow + 1, column: route[0].column });
    let current = { x: slotXs[move.slotIndex], y: slotY + 18 };
    let arrival = duration(current, entry, 280);
    current = entry;
    for (const point of points.slice(1)) { arrival += duration(current, point, 360); current = point; }
    arrival += quantize(.07) + quantize(.09);
    let end = arrival;
    for (const point of [...points].reverse().slice(1)) { end += duration(current, point, 330); current = point; }
    end += duration(current, { x: 0, y: -218 }, 330) + quantize(.12);
    return { arrival, end };
  };
}

// Reservations remain blocking until arrival; a worker occupies the window through its return/fade.
function drain(model, timing) {
  let clock = 0, nextDispatch = 0, jobs = [], ordinal = 0, external = true;
  for (let budget = 0; budget < 20000; budget += 1) {
    clock = Math.min(nextDispatch, ...jobs.flatMap(job => job.arrived ? [job.end] : [job.arrival, job.end]));
    for (const job of jobs.filter(job => !job.arrived && job.arrival <= clock + 1e-9)
      .sort((a, b) => a.arrival - b.arrival || a.ordinal - b.ordinal)) {
      model.completeTransport(job.cellId);
      job.arrived = true;
    }
    jobs = jobs.filter(job => job.end > clock + 1e-9);
    if (nextDispatch > clock + 1e-9) continue;
    const moves = jobs.length < 20 ? model.dispatchReady().flat().filter(event => event.phase === 'MOVE') : [];
    for (const move of moves) {
      external &&= move.route.length > 1;
      const duration = timing(move);
      jobs.push({ cellId: move.cellId, arrival: clock + duration.arrival, end: clock + duration.end, ordinal: ordinal++, arrived: false });
    }
    nextDispatch = clock + .06;
    if (jobs.length === 0 && moves.length === 0) return external;
  }
  throw new Error('UNKNOWN: asynchronous replay exceeded its finite event budget');
}
export function replayAsync(level, trace, mode = 'daily', profile = ASYNC_PROFILES[1]) {
  const model = createModel(level), timing = movementTiming(level, mode, profile);
  let external = true, peak = 0;
  for (const index of trace) {
    assert.equal(model.result, 'PLAYING', `${profile.name}: trace continued after ${model.result}`);
    assert.ok(model.stacks[index]?.accessible && !model.stacks[index].selected, `${profile.name}: inaccessible group ${index}`);
    assert.ok(model.slots.some(slot => !slot), `${profile.name}: no free slot before ${index}`);
    peak = Math.max(peak, model.slots.filter(Boolean).length + 1);
    model.selectStack(level.groups[index].id);
    external = drain(model, timing) && external;
  }
  return { result: model.result, transported: model.transported, external, peak, slots: model.slots };
}
export function checkAsyncReference(level, trace, mode = 'daily', capacity = 5) {
  for (const profile of ASYNC_PROFILES) {
    const result = replayAsync(level, trace, mode, profile);
    assert.equal(result.result, 'SUCCESS', `${mode} ${level.level} ${profile.name}: ${JSON.stringify(result)}`);
    assert.equal(result.transported, level.cells.length);
    assert.ok(result.external, `${profile.name}: target was inside a sealed cavity`);
    assert.ok(result.peak <= capacity, `${mode} ${level.level} ${profile.name}: needs ${result.peak} slots, expected ${capacity}`);
  }
}

export function checkAsyncFailureReference(level, trace, mode = 'daily', selectedProfile) {
  for (const profile of selectedProfile ? [selectedProfile] : ASYNC_PROFILES) {
    const result = replayAsync(level, trace, mode, profile);
    assert.equal(result.result, 'FAIL', `${mode} ${level.level} ${profile.name}: wrong order remains ${result.result}`);
    assert.ok(result.external, `${profile.name}: target was inside a sealed cavity`);
  }
}

export function findAsyncWinningTrace(level, capacity, mode = 'daily', limit = 2000) {
  return findAsyncTrace(level, capacity, mode, limit, false);
}

export function findAsyncFailureTrace(level, mode = 'daily', limit = 2000, selectedProfile) {
  return findAsyncTrace(level, 5, mode, limit, true, selectedProfile ? [selectedProfile] : ASYNC_PROFILES);
}

function findAsyncTrace(level, capacity, mode, limit, failure, profiles = ASYNC_PROFILES) {
  const timings = profiles.map(profile => movementTiming(level, mode, profile));
  const initial = save(createModel(level)), visited = new Set();
  let states = 0;
  function visit(saved, trace) {
    if (saved.every(state => state.result === (failure ? 'FAIL' : 'SUCCESS'))) return trace;
    if (saved.some(state => state.result !== 'PLAYING') || states >= limit) return null;
    const key = saved.map(state => `${state.cleared.map(clear => clear ? '1' : '0').join('')};${state.slots.map(slot => slot ? `${slot.stackId}:${slot.remaining}` : '-').join(',')};${state.stacks.map(stack => stack.selected ? '1' : '0').join('')}`).join('|');
    if (visited.has(key)) return null;
    visited.add(key); states += 1;
    if (saved.some(state => state.slots.filter(Boolean).length >= capacity)) return null;
    const options = [];
    for (let index = 0; index < level.groups.length; index += 1) {
      if (!saved.every(state => state.stacks[index].accessible && !state.stacks[index].selected)) continue;
      const models = saved.map(state => createModel(level, state));
      let external = true;
      models.forEach((model, profile) => {
        model.selectStack(level.groups[index].id);
        external = drain(model, timings[profile]) && external;
      });
      if (!external) continue;
      const next = models.map(save);
      options.push({ index, next, occupied: Math.max(...next.map(state => state.slots.filter(Boolean).length)),
        transported: Math.min(...next.map(state => state.transported)) });
    }
    options.sort((a, b) => (failure ? b.occupied - a.occupied || a.transported - b.transported : a.occupied - b.occupied || b.transported - a.transported) || a.index - b.index);
    for (const { index, next } of options) {
      const found = visit(next, [...trace, index]);
      if (found) return found;
    }
    return null;
  }
  const trace = visit(profiles.map(() => initial), []);
  return { trace, states, exhausted: states < limit };
}

export type BoardRoutePoint = { row: number; column: number };
export type BoardBounds = { minRow: number; maxRow: number; minColumn: number; maxColumn: number };

/** 最短距离优先；在最短路径中选择转弯最少的一条。 */
export function boardRoute(start: BoardRoutePoint, target: BoardRoutePoint, bounds: BoardBounds, occupied: ReadonlySet<string>): BoardRoutePoint[] {
  const top = bounds.minRow - 1, left = bounds.minColumn - 1;
  const width = bounds.maxColumn - left + 2, height = bounds.maxRow - top + 2;
  const index = (point: BoardRoutePoint) => (point.row - top) * width + point.column - left;
  const point = (id: number): BoardRoutePoint => ({ row: top + Math.floor(id / width), column: left + id % width });
  const origin = index(start), destination = index(target), size = width * height;
  const distance = new Int32Array(size).fill(-1);
  const turns = new Int32Array(size * 4).fill(0x7fffffff);
  const previous = new Int32Array(size * 4).fill(-1);
  const queue = [origin];
  distance[origin] = 0;
  const directions = [[-1, 0], [0, -1], [0, 1], [1, 0]] as const;
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]!;
    if (current === destination) break;
    const position = point(current);
    for (let direction = 0; direction < 4; direction += 1) {
      const delta = directions[direction]!;
      const next = { row: position.row + delta[0], column: position.column + delta[1] };
      if (next.row < top || next.row >= top + height || next.column < left || next.column >= left + width) continue;
      const id = index(next);
      if (id !== destination && occupied.has(`${next.row}:${next.column}`)) continue;
      if (distance[id] === -1) { distance[id] = distance[current]! + 1; queue.push(id); }
      if (distance[id] !== distance[current]! + 1) continue;
      const state = id * 4 + direction;
      if (current === origin) { turns[state] = 0; previous[state] = -1; continue; }
      for (let incoming = 0; incoming < 4; incoming += 1) {
        const parent = current * 4 + incoming;
        const cost = turns[parent]! + (incoming === direction ? 0 : 1);
        if (cost < turns[state]!) { turns[state] = cost; previous[state] = parent; }
      }
    }
  }
  if (distance[destination] === -1) return [];
  if (origin === destination) return [{ ...start }];
  let state = destination * 4;
  for (let direction = 1; direction < 4; direction += 1) {
    if (turns[destination * 4 + direction]! < turns[state]!) state = destination * 4 + direction;
  }
  const route: BoardRoutePoint[] = [];
  while (state >= 0) { route.push(point(Math.floor(state / 4))); state = previous[state]!; }
  route.push({ ...start });
  return route.reverse();
}

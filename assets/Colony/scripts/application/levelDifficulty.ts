export type DifficultyKind = 'E' | 'S' | 'H';

/** Projection generated from the existing difficulty authority, without changing board data. */
export function readLevelDifficulty(raw: unknown): ReadonlyMap<number, DifficultyKind> {
  if (!Array.isArray(raw) || raw.length !== 60) throw new Error('难度配置必须覆盖60关');
  const entries: [number, DifficultyKind][] = raw.map((value: unknown, index) => {
    if (!value || typeof value !== 'object' || !('level' in value) || value.level !== index + 1 || !('kind' in value)
      || (value.kind !== 'E' && value.kind !== 'S' && value.kind !== 'H')) throw new Error(`第${index + 1}关难度无效`);
    return [index + 1, value.kind];
  });
  if (entries[0]![1] !== 'E') throw new Error('第一关必须保持教学难度');
  return new Map(entries);
}

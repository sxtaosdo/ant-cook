export const GAME_COLORS = [
  'berry', 'citrus', 'leaf', 'plum', 'blue', 'cocoa',
  'gold', 'orange', 'yellow', 'white', 'cream', 'charcoal',
] as const;

export type GameColor = typeof GAME_COLORS[number];
export type BoardShape = 'PROVISIONAL_ORANGE_POP' | 'PROVISIONAL_FOX' | 'NIGHT_MARKET';

/** 单关开发配置。 */
export interface DevelopmentLevelConfig {
  readonly level: number;
  readonly sourceId: string;
  readonly shape: BoardShape;
  readonly themeId?: string;
  readonly targetItemId?: string;
  readonly columns: number;
  readonly rows: number;
  readonly cells: readonly DevelopmentLevelCell[];
  readonly groups: readonly DevelopmentLevelGroup[];
  readonly initialSlots?: 5 | 6;
}

/** 棋盘单元格配置。 */
export interface DevelopmentLevelCell {
  readonly id: string;
  readonly row: number;
  readonly column: number;
  readonly color: GameColor;
}

/** 可选取数字组配置。 */
export interface DevelopmentLevelGroup {
  readonly id: string;
  readonly color: GameColor;
  readonly count: number;
  readonly pile: number;
  readonly depth: number;
}

/** 开发关卡目录。 */
export interface DevelopmentLevelCatalog {
  readonly levels: readonly DevelopmentLevelConfig[];
}

const COLORS = new Set<string>(GAME_COLORS);
const SHAPES = new Set<string>(['PROVISIONAL_ORANGE_POP', 'PROVISIONAL_FOX']);

/** 解析并校验开发关卡 JSON 目录。 */
export function parseDevelopmentLevelCatalog(raw: unknown): DevelopmentLevelCatalog {
  const document = record(raw, 'level catalog');
  if (document.schema !== 'food-hunt-development-level-catalog-v1') {
    throw new Error('Unsupported development level catalog schema');
  }
  if (!Array.isArray(document.levels) || document.levels.length === 0) {
    throw new Error('Development level catalog must contain levels');
  }
  const levels = document.levels.map((value, index) => parseLevel(value, index + 1));
  return Object.freeze({ levels: Object.freeze(levels) });
}

/** 解析单关并校验颜色计数一致性。 */
function parseLevel(raw: unknown, expectedLevel: number): DevelopmentLevelConfig {
  const value = record(raw, `level ${expectedLevel}`);
  const level = integer(value.level, `level ${expectedLevel}.level`, 1);
  if (level !== expectedLevel) throw new Error(`Level index ${level} must equal ${expectedLevel}`);
  const sourceId = text(value.sourceId, `level ${level}.sourceId`);
  const shape = text(value.shape, `level ${level}.shape`);
  if (!SHAPES.has(shape)) throw new Error(`Level ${level} has unsupported shape ${shape}`);
  if ((value.themeId === undefined) !== (value.targetItemId === undefined)) throw new Error(`Level ${level} theme and target must be paired`);
  const themeId = value.themeId === undefined ? undefined : text(value.themeId, `level ${level}.themeId`);
  const targetItemId = value.targetItemId === undefined ? undefined : text(value.targetItemId, `level ${level}.targetItemId`);
  const initialSlots = value.initialSlots;
  if (initialSlots !== undefined && initialSlots !== 5 && initialSlots !== 6) throw new Error(`Level ${level} initialSlots must be 5 or 6`);
  const columns = integer(value.columns, `level ${level}.columns`, 1);
  const rows = integer(value.rows, `level ${level}.rows`, 1);
  const cells = array(value.cells, `level ${level}.cells`).map((cell) => parseCell(cell, level, columns, rows));
  const groups = array(value.groups, `level ${level}.groups`).map((group) => parseGroup(group, level));
  if (cells.length === 0 || groups.length === 0) throw new Error(`Level ${level} must contain cells and groups`);
  unique(cells.map((cell) => cell.id), `Level ${level} cell ids`);
  unique(cells.map((cell) => `${cell.row}:${cell.column}`), `Level ${level} cell coordinates`);
  unique(groups.map((group) => group.id), `Level ${level} group ids`);
  const cellCounts = countColors(cells);
  const groupCounts = countColors(groups);
  for (const color of GAME_COLORS) {
    if ((cellCounts.get(color) ?? 0) !== (groupCounts.get(color) ?? 0)) {
      throw new Error(`Level ${level} group count does not match cells for ${color}`);
    }
  }
  return Object.freeze({
    level,
    sourceId,
    shape: shape as BoardShape,
    ...(themeId ? { themeId, targetItemId } : {}),
    ...(initialSlots === undefined ? {} : { initialSlots }),
    columns,
    rows,
    cells: Object.freeze(cells),
    groups: Object.freeze(groups),
  });
}

/** 解析棋盘格并校验边界。 */
function parseCell(raw: unknown, level: number, columns: number, rows: number): DevelopmentLevelCell {
  const value = record(raw, `level ${level} cell`);
  const row = integer(value.row, `level ${level} cell.row`, 0);
  const column = integer(value.column, `level ${level} cell.column`, 0);
  if (row >= rows || column >= columns) throw new Error(`Level ${level} cell is outside board bounds`);
  return Object.freeze({
    id: text(value.id, `level ${level} cell.id`),
    row,
    column,
    color: color(value.color, `level ${level} cell.color`),
  });
}

/** 解析数字组配置。 */
function parseGroup(raw: unknown, level: number): DevelopmentLevelGroup {
  const value = record(raw, `level ${level} group`);
  return Object.freeze({
    id: text(value.id, `level ${level} group.id`),
    color: color(value.color, `level ${level} group.color`),
    count: integer(value.count, `level ${level} group.count`, 2),
    pile: integer(value.pile, `level ${level} group.pile`, 0),
    depth: integer(value.depth, `level ${level} group.depth`, 0),
  });
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function integer(value: unknown, label: string, minimum: number): number {
  if (!Number.isInteger(value) || (value as number) < minimum) throw new Error(`${label} must be an integer >= ${minimum}`);
  return value as number;
}

function color(value: unknown, label: string): GameColor {
  const candidate = text(value, label);
  if (!COLORS.has(candidate)) throw new Error(`${label} has unsupported color ${candidate}`);
  return candidate as GameColor;
}

function countColors(items: readonly { readonly color: GameColor; readonly count?: number }[]): Map<GameColor, number> {
  const result = new Map<GameColor, number>();
  for (const item of items) result.set(item.color, (result.get(item.color) ?? 0) + (item.count ?? 1));
  return result;
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
}

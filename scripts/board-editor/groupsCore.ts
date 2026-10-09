import { GAME_COLORS, MAIN_SUPPLY_LEVELS, parseInitialGroups, queueColumns, validateDevelopmentLevel, type DevelopmentLevelGroup, type QueueColumns } from '../../assets/Colony/scripts/application/levelCatalog.js';
import { blank, documentFor, importBoard, validate, type Board } from './core.js';

export interface LevelDraft {
  board: Board; targetLevel: number; queueColumns: QueueColumns;
  groups: DevelopmentLevelGroup[]; cellOrder: string[]; cellKeys: Record<string, string>; selectionOrder: string[];
}
export const initialDraft = (board = blank(32, 32)): LevelDraft => ({ board, targetLevel: 7, queueColumns: 5, groups: [], cellOrder: [], cellKeys: {}, selectionOrder: [] });
const clone = (draft: LevelDraft): LevelDraft => structuredClone(draft);

/** History contains only initial configuration, never a model snapshot or in-flight state. */
export class DraftHistory {
  private past: LevelDraft[] = []; private future: LevelDraft[] = []; private draft: LevelDraft;
  constructor(draft: LevelDraft) { this.draft = clone(draft); }
  get current(): LevelDraft { return clone(this.draft); }
  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }
  commit(draft: LevelDraft): void {
    validate(draft.board, true);
    if (JSON.stringify(draft) === JSON.stringify(this.draft)) return;
    this.past.push(clone(this.draft)); this.past = this.past.slice(-50); this.future = []; this.draft = clone(draft);
  }
  undo(): void { const draft = this.past.pop(); if (draft) { this.future.push(clone(this.draft)); this.draft = draft; } }
  redo(): void { const draft = this.future.pop(); if (draft) { this.past.push(clone(this.draft)); this.draft = draft; } }
}
export function rowMajorOrder(board: Board): string[] {
  return board.pixels.flatMap((symbol, index) => symbol === '.' ? [] : [`${Math.floor(index / board.columns)}.${index % board.columns}`]);
}
/** Explicit reorder operations keep IDs stable; witness references are IDs until the CSV boundary. */
export function reflowGroups(groups: readonly DevelopmentLevelGroup[]): DevelopmentLevelGroup[] {
  const depths = new Map<number, number>();
  return groups.map(group => { const depth = depths.get(group.pile) ?? 0; depths.set(group.pile, depth + 1); return { ...group, depth }; });
}
export function rulesFor(draft: LevelDraft) {
  validate(draft.board);
  const validOrder = rowMajorOrder(draft.board);
  if (draft.cellOrder.length !== validOrder.length || new Set(draft.cellOrder).size !== validOrder.length
    || draft.cellOrder.some(coordinate => !validOrder.includes(coordinate))) throw new Error('格子顺序须明确覆盖每个有效格子一次；请检查或重建');
  if (!Number.isSafeInteger(draft.targetLevel) || draft.targetLevel < 1 || draft.targetLevel > 60) throw new Error('目标关号须为1–60');
  const cells = draft.cellOrder.map(coordinate => {
    const [row, column] = coordinate.split('.').map(Number);
    const symbol = draft.board.pixels[row! * draft.board.columns + column!]!;
    return { id: `cell-${row}-${column}`, row: row!, column: column!, color: GAME_COLORS[symbol.charCodeAt(0) - 65]!,
      ...(draft.cellKeys[coordinate] ? { keyId: draft.cellKeys[coordinate] } : {}) };
  });
  if (Object.keys(draft.cellKeys).some(coordinate => !validOrder.includes(coordinate))) throw new Error('钥匙必须绑定有效食物坐标');
  const initialSlots = (MAIN_SUPPLY_LEVELS as readonly number[]).includes(draft.targetLevel) ? 6 : 5;
  validateDevelopmentLevel({ level: draft.targetLevel, sourceId: 'editor-draft', shape: 'NIGHT_MARKET', columns: draft.board.columns,
    rows: draft.board.rows, cells, groups: draft.groups, queueColumns: draft.queueColumns, initialSlots }, draft.targetLevel);
  const groupRules: Record<string, { mystery?: true; linkId?: string; lockId?: string }> = {};
  draft.groups.forEach((group, index) => {
    const rules = { ...(group.mystery ? { mystery: true as const } : {}), ...(group.linkId ? { linkId: group.linkId } : {}), ...(group.lockId ? { lockId: group.lockId } : {}) };
    if (Object.keys(rules).length) groupRules[String(index)] = rules;
  });
  return { schema: 'colony-level-rules-v2' as const, queueColumns: queueColumns(draft.queueColumns), initialSlots,
    cellOrder: draft.cellOrder.join('|'), groups: draft.groups.map(group => `${String.fromCharCode(65 + GAME_COLORS.indexOf(group.color))}:${group.count}:${group.pile}:${group.depth}`).join('|'),
    groupRules, cellKeys: { ...draft.cellKeys }, selectionOrder: draft.selectionOrder.map(id => draft.groups.findIndex(group => group.id === id)) };
}
export function checkWitnessReferences(draft: LevelDraft): void {
  if (draft.selectionOrder.length !== draft.groups.length || new Set(draft.selectionOrder).size !== draft.groups.length
    || draft.selectionOrder.some(id => !draft.groups.some(group => group.id === id))) throw new Error('解法顺序须按组ID覆盖全部组一次；连体后续成员在回放中自动跳过');
}
export function draftDocument(draft: LevelDraft) {
  return { schema: 'colony-level-draft-v2', ...clone(draft), board: documentFor(draft.board) };
}
export function importDraft(raw: unknown): LevelDraft {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('关卡草稿必须是对象');
  const value = raw as Record<string, unknown>;
  if (value.schema !== 'colony-level-draft-v2' || Object.keys(value).some(key => !['schema', 'board', 'targetLevel', 'queueColumns', 'groups', 'cellOrder', 'cellKeys', 'selectionOrder'].includes(key))) throw new Error('不支持的初始草稿格式');
  if (!Array.isArray(value.groups) || !Array.isArray(value.cellOrder) || !value.cellOrder.every(id => typeof id === 'string')
    || !Array.isArray(value.selectionOrder) || !value.selectionOrder.every(id => typeof id === 'string')
    || !value.cellKeys || typeof value.cellKeys !== 'object' || Array.isArray(value.cellKeys) || !Object.values(value.cellKeys).every(id => typeof id === 'string')) throw new Error('草稿配置字段无效');
  if (!Number.isSafeInteger(value.targetLevel) || Number(value.targetLevel) < 1 || Number(value.targetLevel) > 60) throw new Error('Invalid target level');
  const draft = { board: importBoard(value.board), targetLevel: Number(value.targetLevel), queueColumns: queueColumns(value.queueColumns),
    groups: parseInitialGroups(value.groups, Number(value.targetLevel), queueColumns(value.queueColumns)), cellOrder: value.cellOrder as string[], cellKeys: value.cellKeys as Record<string, string>, selectionOrder: value.selectionOrder as string[] };
  // Intermediate color/order mismatches remain editable. Compilation still requires rulesFor().
  // Shared parsing rejects unknown mechanics and runtime state even in an unfinished draft.
  return clone(draft);
}

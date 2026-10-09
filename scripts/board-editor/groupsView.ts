import { GAME_COLORS, MAIN_SUPPLY_LEVELS, validateDevelopmentLevel, type DevelopmentLevelConfig, type DevelopmentLevelGroup } from '../../assets/Colony/scripts/application/levelCatalog.js';
import { importBoard, type PaletteColor } from './core.js';
import { initialDraft, reflowGroups, rowMajorOrder, rulesFor, type LevelDraft } from './groupsCore.js';

export const COLOR_NAMES = ['莓红', '柑橘', '叶绿', '紫色', '蓝色', '棕色', '金色', '橙色', '黄色', '白色', '奶油', '深灰'];
export const colorName = (color: string): string => COLOR_NAMES[GAME_COLORS.indexOf(color as typeof GAME_COLORS[number])] ?? '未知颜色';
export const colorHex = (color: string, palette: PaletteColor[]): string => palette.find(item => item.id === color)?.hex ?? '#d0d4d3';
export function prepareDraft(draft: LevelDraft, manualOrder = false): LevelDraft {
  const next = structuredClone(draft);
  if (!manualOrder) next.cellOrder = rowMajorOrder(next.board);
  return next;
}
export function basicExample(): LevelDraft {
  const draft = initialDraft(importBoard({ schema: 'colony-board-v1', rows: 1, columns: 3, boardCells: 'AAB' }));
  draft.queueColumns = 3;
  draft.groups = GAME_COLORS.slice(0, 3).map((_, index) => ({ id: `group-${index + 1}`, color: index === 2 ? 'citrus' : 'berry', count: 1, pile: index, depth: 0 }));
  return prepareDraft(draft);
}
function freshId(prefix: string, used: string[]): string {
  let index = 1; while (used.includes(`${prefix}-${index}`)) index++;
  return `${prefix}-${index}`;
}
export function addBlock(draft: LevelDraft, pile: number): LevelDraft {
  const next = structuredClone(draft);
  if (!Number.isInteger(pile) || pile < 0 || pile >= next.queueColumns) throw new Error('请选择当前待选区中的一列');
  next.groups.push({ id: freshId('group', next.groups.map(item => item.id)), color: 'berry', count: 1, pile, depth: next.groups.filter(item => item.pile === pile).length });
  next.selectionOrder = []; return next;
}
export function changeBlock(draft: LevelDraft, id: string, change: Partial<DevelopmentLevelGroup>): LevelDraft {
  const next = structuredClone(draft);
  if (!next.groups.some(item => item.id === id)) throw new Error('请先选中一个方块');
  next.groups = reflowGroups(next.groups.map(item => item.id === id ? { ...item, ...change } : item));
  next.selectionOrder = [];
  return next;
}
export function moveBlock(draft: LevelDraft, id: string, direction: -1 | 1): LevelDraft {
  const next = structuredClone(draft), group = next.groups.find(item => item.id === id);
  if (!group) throw new Error('请先选中一个方块');
  const pile = next.groups.filter(item => item.pile === group.pile), other = pile[pile.findIndex(item => item.id === id) + direction];
  if (other) { const a = next.groups.findIndex(item => item.id === id), b = next.groups.findIndex(item => item.id === other.id); [next.groups[a], next.groups[b]] = [next.groups[b]!, next.groups[a]!]; }
  next.groups = reflowGroups(next.groups); next.selectionOrder = []; return next;
}
export function linkBlocks(draft: LevelDraft, ids: string[]): LevelDraft {
  const next = structuredClone(draft), selected = new Set(ids), members = next.groups.filter(item => selected.has(item.id));
  const slots = (MAIN_SUPPLY_LEVELS as readonly number[]).includes(next.targetLevel) ? 6 : 5;
  if (members.length < 2 || members.length > slots) throw new Error(`一起出发请选择2至${slots}块`);
  for (const member of members) if (member.linkId && next.groups.some(item => item.linkId === member.linkId && !selected.has(item.id))) throw new Error('请选齐原有组合，或先解除原有组合');
  const linkId = freshId('link', next.groups.flatMap(item => item.linkId ? [item.linkId] : []));
  next.groups = next.groups.map(group => selected.has(group.id) ? { ...group, linkId } : group);
  next.selectionOrder = [];
  return next;
}
export function unlockBlock(draft: LevelDraft, id: string): LevelDraft {
  const next = structuredClone(draft), group = next.groups.find(item => item.id === id);
  if (!group) throw new Error('请先选中一个方块');
  const key = group.lockId;
  next.groups = next.groups.map(item => { if (item.id !== id) return item; const { lockId: _lock, ...unlocked } = item; return unlocked; });
  next.selectionOrder = [];
  if (key && !next.groups.some(item => item.lockId === key)) for (const coordinate of Object.keys(next.cellKeys)) if (next.cellKeys[coordinate] === key) delete next.cellKeys[coordinate];
  return next;
}
export function keyForBlock(draft: LevelDraft, coordinate: string, id: string): LevelDraft {
  const next = unlockBlock(draft, id);
  if (!rowMajorOrder(next.board).includes(coordinate)) throw new Error('请点上方有食物的格子');
  const key = next.cellKeys[coordinate] ?? freshId('key', [...Object.values(next.cellKeys), ...next.groups.flatMap(item => item.lockId ? [item.lockId] : [])]);
  next.cellKeys[coordinate] = key; next.groups = next.groups.map(item => item.id === id ? { ...item, lockId: key } : item);
  return next;
}
export function draftProblems(draft: LevelDraft): string[] {
  if (rowMajorOrder(draft.board).length === 0) return ['上方食物图案还是空的。请先绘制食物，或点“载入普通示例”。'];
  if (draft.groups.length === 0) return ['下方还没有待选方块。请点“＋添加方块”。'];
  const problems: string[] = [];
  for (const group of draft.groups) if (!Number.isSafeInteger(group.count) || group.count < 1 || group.count > 4096) problems.push(`第${group.pile + 1}列第${group.depth + 1}块：数量请输入1至4096的整数。`);
  for (const [index, color] of GAME_COLORS.entries()) {
    const food = draft.board.pixels.filter(symbol => symbol === String.fromCharCode(65 + index)).length;
    const supplied = draft.groups.filter(item => item.color === color).reduce((total, item) => total + item.count, 0);
    if (food !== supplied) problems.push(`${colorName(color)}：上方${food}格，下方数量合计${supplied}。请调整同色方块数量。`);
  }
  if (problems.length === 0) try { rulesFor(draft); } catch (error) { problems.push(friendlyError(error)); }
  return problems;
}
export function configForDraft(draft: LevelDraft): DevelopmentLevelConfig {
  rulesFor(draft);
  const cells = draft.cellOrder.map(coordinate => {
    const [row, column] = coordinate.split('.').map(Number);
    const symbol = draft.board.pixels[row! * draft.board.columns + column!]!;
    return { id: `cell-${row}-${column}`, row: row!, column: column!, color: GAME_COLORS[symbol.charCodeAt(0) - 65]!, ...(draft.cellKeys[coordinate] ? { keyId: draft.cellKeys[coordinate] } : {}) };
  });
  return validateDevelopmentLevel({ level: 1, sourceId: 'editor-memory-preview', shape: 'NIGHT_MARKET', rows: draft.board.rows, columns: draft.board.columns,
    cells, groups: structuredClone(draft.groups), queueColumns: draft.queueColumns, initialSlots: (MAIN_SUPPLY_LEVELS as readonly number[]).includes(draft.targetLevel) ? 6 : 5 }, 1);
}
export function friendlyError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes('UNKNOWN')) return '暂时无法判断，仍需试玩；没有找到解法不等于这关无解。';
  if (/covered|locked/.test(text)) return '这块还不能出发：请先处理它前面的方块，或取得对应钥匙。';
  if (/holding slots/.test(text)) return '空槽不够，整组没有移动。请先清理槽里的食物。';
  if (/SUCCESS|FAIL/.test(text)) return '这一局已经结束，可以点“重新试玩”。';
  if (/格子顺序/.test(text)) return '图案已变化，请在高级设置重建食物顺序，或恢复自动顺序。';
  if (/link|Link/.test(text)) return '一起出发的组合有冲突。检查成员数量和同列的前后顺序。';
  if (/key|lock|Key|Lock|钥匙/.test(text)) return '钥匙关联待修正：钥匙必须在食物格上，并对应需要解锁的方块。';
  if (/selectionOrder|witness|解法/.test(text)) return '指定的试玩顺序不适合当前配置。可清空高级解法后重新尝试。';
  if (/execution sources|stale|Sources changed/.test(text)) return '这个编辑器服务版本已变化，请保留草稿并打开新的编辑器入口。';
  if (/[\u4e00-\u9fff]/.test(text)) return text;
  return '配置尚有冲突。请检查颜色数量、组合和钥匙关联；技术详情在高级设置中。';
}

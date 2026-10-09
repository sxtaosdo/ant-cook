import { GAME_COLORS, MAIN_SUPPLY_LEVELS, validateDevelopmentLevel, type DevelopmentLevelConfig, type DevelopmentLevelGroup } from '../../assets/Colony/scripts/application/levelCatalog.js';
import { counts, importBoard, type PaletteColor } from './core.js';
import { boardStamp, editorStateFor, initialDraft, reflowGroups, rowMajorOrder, rulesFor, type LevelDraft } from './groupsCore.js';

export const COLOR_NAMES = ['莓红', '柑橘', '叶绿', '紫色', '蓝色', '棕色', '金色', '橙色', '黄色', '白色', '奶油', '深灰'];
export const colorName = (color: string): string => COLOR_NAMES[GAME_COLORS.indexOf(color as typeof GAME_COLORS[number])] ?? '未知颜色';
export const colorSymbol = (color: string): string => { const index = GAME_COLORS.indexOf(color as typeof GAME_COLORS[number]); return index < 0 ? '?' : String.fromCharCode(65 + index); };
export const colorLabel = (color: string): string => `${colorSymbol(color)} ${colorName(color)}`;
export const colorHex = (color: string, palette: PaletteColor[]): string => palette.find(item => item.id === color)?.hex ?? '#d0d4d3';
export function colorStatistics(draft: LevelDraft) {
  const board = counts(draft.board);
  return GAME_COLORS.map((color, index) => { const supplied = draft.groups.filter(group => group.color === color).reduce((total, group) => total + group.count, 0), food = board[index]!;
    return { color, label: colorLabel(color), board: food, supplied, difference: supplied - food, status: supplied === food ? 'equal' as const : supplied < food ? 'short' as const : 'extra' as const };
  });
}
export function renderColorStatistics(target: HTMLElement, draft: LevelDraft, palette: PaletteColor[]): void {
  target.replaceChildren();
  const active = colorStatistics(draft).filter(item => item.board > 0 || item.supplied > 0);
  if (!active.length) { const empty = document.createElement('p'); empty.className = 'hint'; empty.textContent = '还没有食物或待选方块。'; target.append(empty); }
  for (const item of active) {
    const card = document.createElement('div'); card.className = `color-stat-card ${item.status}`;
    const identity = document.createElement('div'); identity.className = 'stat-identity'; const swatch = document.createElement('span'); swatch.className = 'swatch'; swatch.style.backgroundColor = colorHex(item.color, palette); identity.append(swatch, item.label);
    const quantities = document.createElement('div'); quantities.className = 'stat-quantities';
    for (const text of [`棋盘 ${item.board}`, `待选 ${item.supplied}`]) { const row = document.createElement('span'); row.textContent = text; quantities.append(row); }
    const status = document.createElement('span'); status.className = 'stat-status'; status.textContent = item.status === 'equal' ? '✓ 一致' : item.status === 'short' ? `↓ 短缺${-item.difference}` : `↑ 超出${item.difference}`;
    card.append(identity, quantities, status); target.append(card);
  }
}
function editedDraft(draft: LevelDraft): LevelDraft {
  const next = structuredClone(draft); next.editorState = editorStateFor(next); next.editorState.autoFillOnEnter = false;
  if (next.editorState.boardStamp === null) next.editorState.boardStamp = boardStamp(next.board);
  return next;
}
export function boardChangedSinceBlocks(draft: LevelDraft): boolean { const stamp = editorStateFor(draft).boardStamp; return stamp !== null && stamp !== boardStamp(draft.board); }
/** One candidate block per used color, in fixed palette order. Counts alone are no witness. */
export function generateBlocks(draft: LevelDraft): LevelDraft {
  const totals = counts(draft.board); if (!totals.some(total => total > 0)) throw new Error('先在上方画出食物，再生成待选方块。');
  const next = structuredClone(draft); next.groups = [];
  for (const [index, color] of GAME_COLORS.entries()) if (totals[index]! > 0) { const pile = next.groups.length % next.queueColumns; next.groups.push({ id: `group-${String.fromCharCode(65 + index)}`, color, count: totals[index]!, pile, depth: next.groups.filter(group => group.pile === pile).length }); }
  next.cellKeys = {}; next.selectionOrder = []; next.editorState = { autoFillOnEnter: false, boardStamp: boardStamp(next.board), linkGroups: [] };
  rulesFor(prepareDraft(next, next.cellOrder.length > 0)); return next;
}
export function enterQueueConfiguration(draft: LevelDraft): LevelDraft {
  return draft.groups.length === 0 && editorStateFor(draft).autoFillOnEnter && counts(draft.board).some(total => total > 0) ? generateBlocks(draft) : structuredClone(draft);
}
export function clearBlocks(draft: LevelDraft): LevelDraft { const next = editedDraft(draft); next.groups = []; next.cellKeys = {}; next.selectionOrder = []; next.editorState!.linkGroups = []; next.editorState!.boardStamp = boardStamp(next.board); return next; }
export function linkGroupsFor(draft: LevelDraft) { return editorStateFor(draft).linkGroups.map(group => ({ ...group, members: draft.groups.filter(item => item.linkId === group.id) })); }
export function linkMarker(number: number): string { return ['◆', '●', '▲', '■', '★', '◇'][(number - 1) % 6]!; }
export function linkGroupLabel(draft: LevelDraft, id: string): string { const group = linkGroupsFor(draft).find(item => item.id === id); return group ? `${linkMarker(group.number)} 第${group.number}组` : '未编号分组'; }
export function linkProblems(draft: LevelDraft): string[] {
  const slots = (MAIN_SUPPLY_LEVELS as readonly number[]).includes(draft.targetLevel) ? 6 : 5, problems: string[] = [];
  for (const group of linkGroupsFor(draft)) {
    if (group.members.length === 1) problems.push(`${linkGroupLabel(draft, group.id)}只有1块，至少加入2块才能一起出发。`);
    if (group.members.length > slots) problems.push(`${linkGroupLabel(draft, group.id)}有${group.members.length}块，本关工作槽最多容纳${slots}块。`);
    for (let pile = 0; pile < draft.queueColumns; pile++) { const depths = group.members.filter(item => item.pile === pile).map(item => item.depth).sort((a, b) => a - b); if (depths.some((depth, index) => depth !== depths[0]! + index)) problems.push(`${linkGroupLabel(draft, group.id)}在第${pile + 1}列不连续，不能夹着其他方块一起出发。`); }
  }
  return problems;
}
function assertLinkLayout(draft: LevelDraft): void { const problem = linkProblems(draft).find(text => !text.includes('只有1块')); if (problem) throw new Error(problem); }
export function createLinkGroup(draft: LevelDraft): { draft: LevelDraft; id: string } {
  const next = editedDraft(draft), groups = next.editorState!.linkGroups;
  if (groups.length >= 4096) throw new Error('分组数量已达上限，请先解散不用的组。');
  const id = freshId('link', groups.map(group => group.id)), number = Math.max(0, ...groups.map(group => group.number)) + 1;
  if (number > 4096) throw new Error('分组编号已达上限，请先解散不用的组。');
  groups.push({ id, number }); return { draft: next, id };
}
export function toggleLinkMember(draft: LevelDraft, linkId: string, blockId: string): LevelDraft {
  const next = editedDraft(draft), member = next.groups.find(group => group.id === blockId);
  if (!linkGroupsFor(next).some(group => group.id === linkId) || !member) throw new Error('先选中一个分组，再点击现有方块。');
  if (member.linkId && member.linkId !== linkId) throw new Error(`这块属于${linkGroupLabel(next, member.linkId)}。请先从原组移出，再加入当前组。`);
  next.groups = next.groups.map(group => { if (group.id !== blockId) return group; if (group.linkId === linkId) { const { linkId: _link, ...plain } = group; return plain; } return { ...group, linkId }; });
  next.selectionOrder = []; assertLinkLayout(next); return next;
}
export function dissolveLinkGroup(draft: LevelDraft, linkId: string): LevelDraft {
  const next = editedDraft(draft); next.groups = next.groups.map(group => { if (group.linkId !== linkId) return group; const { linkId: _link, ...plain } = group; return plain; });
  next.editorState!.linkGroups = next.editorState!.linkGroups.filter(group => group.id !== linkId); next.selectionOrder = []; return next;
}
export function removeBlock(draft: LevelDraft, id: string): LevelDraft { const next = unlockBlock(editedDraft(draft), id); next.groups = reflowGroups(next.groups.filter(item => item.id !== id)); next.selectionOrder = []; return next; }
export function prepareDraft(draft: LevelDraft, manualOrder = false): LevelDraft {
  const next = structuredClone(draft);
  if (!manualOrder) next.cellOrder = rowMajorOrder(next.board);
  return next;
}
export function basicExample(): LevelDraft {
  const draft = initialDraft(importBoard({ schema: 'colony-board-v1', rows: 1, columns: 3, boardCells: 'AAB' }));
  draft.queueColumns = 3;
  draft.groups = GAME_COLORS.slice(0, 3).map((_, index) => ({ id: `group-${index + 1}`, color: index === 2 ? 'citrus' : 'berry', count: 1, pile: index, depth: 0 }));
  return prepareDraft(editedDraft(draft));
}
function freshId(prefix: string, used: string[]): string {
  let index = 1; while (used.includes(`${prefix}-${index}`)) index++;
  return `${prefix}-${index}`;
}
export function addBlock(draft: LevelDraft, pile: number): LevelDraft {
  const next = editedDraft(draft);
  if (!Number.isInteger(pile) || pile < 0 || pile >= next.queueColumns) throw new Error('请选择当前待选区中的一列');
  next.groups.push({ id: freshId('group', next.groups.map(item => item.id)), color: 'berry', count: 1, pile, depth: next.groups.filter(item => item.pile === pile).length });
  next.selectionOrder = []; return next;
}
export function changeBlock(draft: LevelDraft, id: string, change: Partial<DevelopmentLevelGroup>): LevelDraft {
  const next = editedDraft(draft);
  if (!next.groups.some(item => item.id === id)) throw new Error('请先选中一个方块');
  next.groups = reflowGroups(next.groups.map(item => item.id === id ? { ...item, ...change } : item));
  next.selectionOrder = [];
  assertLinkLayout(next); return next;
}
export function moveBlock(draft: LevelDraft, id: string, direction: -1 | 1): LevelDraft {
  const next = editedDraft(draft), group = next.groups.find(item => item.id === id);
  if (!group) throw new Error('请先选中一个方块');
  const pile = next.groups.filter(item => item.pile === group.pile), other = pile[pile.findIndex(item => item.id === id) + direction];
  if (other) { const a = next.groups.findIndex(item => item.id === id), b = next.groups.findIndex(item => item.id === other.id); [next.groups[a], next.groups[b]] = [next.groups[b]!, next.groups[a]!]; }
  next.groups = reflowGroups(next.groups); next.selectionOrder = []; assertLinkLayout(next); return next;
}
export function linkBlocks(draft: LevelDraft, ids: string[]): LevelDraft {
  const next = editedDraft(draft), selected = new Set(ids), members = next.groups.filter(item => selected.has(item.id));
  const slots = (MAIN_SUPPLY_LEVELS as readonly number[]).includes(next.targetLevel) ? 6 : 5;
  if (members.length < 2 || members.length > slots) throw new Error(`一起出发请选择2至${slots}块`);
  for (const member of members) if (member.linkId && next.groups.some(item => item.linkId === member.linkId && !selected.has(item.id))) throw new Error('请选齐原有组合，或先解除原有组合');
  const linkId = freshId('link', next.groups.flatMap(item => item.linkId ? [item.linkId] : []));
  next.groups = next.groups.map(group => selected.has(group.id) ? { ...group, linkId } : group);
  next.editorState = editorStateFor(next); next.selectionOrder = []; assertLinkLayout(next);
  return next;
}
export function unlockBlock(draft: LevelDraft, id: string): LevelDraft {
  const next = editedDraft(draft), group = next.groups.find(item => item.id === id);
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
  if (draft.groups.length === 0) return ['下方还没有待选方块。请点“按棋盘生成方块”或“＋添加方块”。'];
  const problems: string[] = [];
  for (const group of draft.groups) if (!Number.isSafeInteger(group.count) || group.count < 1 || group.count > 4096) problems.push(`第${group.pile + 1}列第${group.depth + 1}块：数量请输入1至4096的整数。`);
  if (colorStatistics(draft).some(item => item.status !== 'equal')) problems.push('同色数量尚未一致，请按统计卡调整短缺或超出的方块。');
  problems.push(...linkProblems(draft));
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

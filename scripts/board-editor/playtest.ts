import { ColonyFlowModel } from '../../assets/Colony/scripts/gameModel.js';
import { configForDraft, colorHex, colorName, friendlyError } from './groupsView.js';
import type { LevelDraft } from './groupsCore.js';
import type { PaletteColor } from './core.js';

/** One private model; no progress, storage, production catalog or Creator connection. */
export class DraftPlaytest {
  private model: ColonyFlowModel;
  constructor(private readonly draft: LevelDraft) { this.model = new ColonyFlowModel({ levels: [configForDraft(draft)] }); }
  snapshot() { return this.model.snapshot(); }
  reset(): void { this.model.reset(); }
  choose(id: string): void {
    this.model.selectStack(id);
    for (let tick = 0; tick <= this.draft.board.pixels.length; tick++) {
      const batches = this.model.dispatchReady(); if (batches.length === 0) break;
      for (const batch of batches) { const move = batch.find(event => event.phase === 'MOVE'); if (move?.cellId) this.model.completeTransport(move.cellId); }
    }
  }
}
export function openDraftPlaytest(draft: LevelDraft, palette: PaletteColor[]): void {
  const session = new DraftPlaytest(structuredClone(draft));
  const dialog = document.createElement('dialog'); dialog.className = 'draft-playtest';
  const title = document.createElement('h2'); title.textContent = '试玩这份草稿';
  const note = document.createElement('p'); note.textContent = '点待选方块让它出发。这里只测试临时草稿，不保存进度、不替换正式关卡；搬运按批次立即完成，游戏动画仍需单独验证。';
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const board = document.createElement('div'); board.className = 'playtest-board';
  const slots = document.createElement('div'); slots.className = 'playtest-slots';
  const queues = document.createElement('div'); queues.className = 'group-columns';
  const restart = document.createElement('button'); restart.textContent = '重新试玩'; restart.onclick = () => { session.reset(); render(); };
  const close = document.createElement('button'); close.textContent = '回到编辑'; close.onclick = () => dialog.close();
  dialog.append(title, note, status, board, slots, queues, restart, close);
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  function render(): void {
    const state = session.snapshot();
    status.textContent = state.result === 'SUCCESS' ? '通关！已搬完全部食物。' : state.result === 'FAIL' ? '这次试玩卡住了。可以重新试玩或回到编辑调整。' : state.stacks.some(stack => !stack.selected && stack.accessible && !stack.locked) ? `还剩${state.remainingCells}格食物；点击下方队首方块。` : '当前没有可选方块。游戏模型还可能允许铲子取钥匙；本简化试玩不含道具，可回编辑调整。';
    board.replaceChildren(); board.style.gridTemplateColumns = `repeat(${draft.board.columns}, 18px)`;
    const cells = new Map(state.board.map(cell => [`${cell.row}.${cell.column}`, cell]));
    for (let index = 0; index < draft.board.pixels.length; index++) {
      const cell = cells.get(`${Math.floor(index / draft.board.columns)}.${index % draft.board.columns}`), tile = document.createElement('span');
      tile.style.backgroundColor = cell && !cell.cleared ? colorHex(cell.color, palette) : 'transparent';
      if (cell?.keyId && !cell.cleared) tile.textContent = '钥'; board.append(tile);
    }
    slots.replaceChildren();
    state.slots.forEach(slot => { const box = document.createElement('span'); box.textContent = slot ? `${colorName(slot.color)} ${slot.remaining}` : '空槽'; if (slot) box.style.backgroundColor = colorHex(slot.color, palette); slots.append(box); });
    queues.replaceChildren(); queues.style.gridTemplateColumns = `repeat(${state.queueColumns}, minmax(80px, 1fr))`;
    for (let pile = 0; pile < (state.queueColumns ?? 5); pile++) {
      const column = document.createElement('div');
      state.stacks.filter(stack => stack.pile === pile && !stack.selected).sort((a, b) => a.depth - b.depth).forEach(stack => {
        const button = document.createElement('button'); button.className = 'queue-block';
        const concealed = stack.mystery && !stack.revealed;
        button.style.backgroundColor = concealed ? '#dce2de' : colorHex(stack.color, palette);
        button.textContent = `${stack.locked ? '锁 ' : ''}${concealed ? '?' : stack.count}${stack.linkId ? ' ↔' : ''}`;
        button.disabled = state.result !== 'PLAYING' || !stack.accessible || Boolean(stack.locked);
        button.onclick = () => { try { session.choose(stack.id); render(); } catch (error) { status.textContent = friendlyError(error); } }; column.append(button);
      }); queues.append(column);
    }
  }
  render(); document.body.append(dialog); dialog.showModal();
}

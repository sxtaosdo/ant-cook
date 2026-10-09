import { DraftHistory, initialDraft, type LevelDraft } from './groupsCore.js';
import { mountGroupsEditor } from './groupsEditor.js';
import { blank, counts, documentFor, imageBoard, importBoard, paintLine, paletteRGB, type Board, type PaletteColor, type Pixels } from './core.js';

function element<T extends HTMLElement>(id: string, type: { new(): T }): T {
  const node = document.getElementById(id); if (!(node instanceof type)) throw new Error(`缺少编辑器控件：${id}`); return node;
}
const button = (id: string): HTMLButtonElement => element(id, HTMLButtonElement);
const input = (id: string): HTMLInputElement => element(id, HTMLInputElement);
const canvas = element('board', HTMLCanvasElement), pattern = element('pattern', HTMLCanvasElement);
const rows = input('rows'), columns = input('columns'), zoom = input('zoom'), preset = element('preset', HTMLSelectElement);
const status = element('status', HTMLParagraphElement), config = element('config', HTMLTextAreaElement);
const dialog = element('image-dialog', HTMLDialogElement), removeWhite = input('remove-white');
const colorCount = element('image-color-count', HTMLSelectElement);
const imagePreview = element('image-preview', HTMLCanvasElement), imageOriginal = element('image-original', HTMLImageElement);
const reference = element('reference', HTMLImageElement), imageStatus = element('image-status', HTMLParagraphElement);
const history = new DraftHistory(initialDraft()); let board = history.current.board;
let groupsEditor: {render(): void} | null = null;
let palette: PaletteColor[] = [], symbol = 'A', erasing = false, ready = false, busy = false;
let pointer: number | null = null, last: [number, number] | null = null;
let pending: { image: Pixels; url: string; rows: number; columns: number } | null = null, filled: Board | null = null;
let referenceUrl = '', saved = JSON.stringify(history.current);
const names = ['莓红', '柑橘', '叶绿', '紫色', '蓝色', '棕色', '金色', '橙色', '黄色', '白色', '奶油', '深灰'];
const message = (text: string, error = false): void => { status.textContent = text; status.classList.toggle('error', error); };
const errorMessage = (cause: unknown): string => cause instanceof Error ? cause.message : '操作未完成，请重试';
function dimensions(): Board { return blank(Number(rows.value), Number(columns.value)); }
function draw(target: HTMLCanvasElement, value: Board, size: number, grid: boolean): void {
  const context = target.getContext('2d'); if (!context) throw new Error('浏览器无法绘制棋盘');
  if (grid) { target.width = value.columns * size; target.height = value.rows * size; }
  context.clearRect(0, 0, target.width, target.height);
  const unit = grid ? size : Math.min(target.width / value.columns, target.height / value.rows);
  const x = (target.width - value.columns * unit) / 2, y = (target.height - value.rows * unit) / 2;
  value.pixels.forEach((p, i) => {
    if (p === '.') { if (!grid) return; context.fillStyle = '#fafcf9'; }
    else context.fillStyle = palette[p.charCodeAt(0) - 65]!.hex;
    context.fillRect(x + i % value.columns * unit, y + Math.floor(i / value.columns) * unit, unit, unit);
  });
  if (grid) {
    context.strokeStyle = '#d3ded6'; context.lineWidth = 1; context.beginPath();
    for (let c = 0; c <= value.columns; c++) { context.moveTo(c * unit + .5, 0); context.lineTo(c * unit + .5, target.height); }
    for (let r = 0; r <= value.rows; r++) { context.moveTo(0, r * unit + .5); context.lineTo(target.width, r * unit + .5); }
    context.stroke();
  }
}
function controls(): void {
  const locked = !ready || busy || pointer !== null;
  for (const id of ['new-board', 'import-image', 'import-json', 'clear', 'brush', 'eraser']) button(id).disabled = locked;
  rows.disabled = columns.disabled = preset.disabled = locked;
  zoom.disabled = !ready || busy || pointer !== null;
  button('undo').disabled = locked || !history.canUndo; button('redo').disabled = locked || !history.canRedo;
  const empty = board.pixels.every(p => p === '.');
  button('export-json').disabled = button('copy-csv').disabled = locked || empty;
  for (const node of element('palette', HTMLDivElement).querySelectorAll('button')) {
    node.disabled = locked; node.setAttribute('aria-pressed', String(!erasing && node.dataset.symbol === symbol));
  }
  button('brush').setAttribute('aria-pressed', String(!erasing)); button('eraser').setAttribute('aria-pressed', String(erasing));
}
function render(): void {
  if (!ready) { controls(); return; }
  draw(canvas, board, Number(zoom.value), true); draw(pattern, board, 0, false);
  element('dimensions', HTMLSpanElement).textContent = `${board.rows} × ${board.columns}`;
  element('zoom-value', HTMLOutputElement).textContent = `${zoom.value}px / 格`;
  const totals = counts(board); element('total', HTMLElement).textContent = String(totals.reduce((a, b) => a + b, 0));
  for (const [i, total] of totals.entries()) element(`count-${i}`, HTMLElement).textContent = String(total);
  config.value = board.pixels.some(p => p !== '.') ? JSON.stringify(documentFor(board), null, 2) : '棋盘为空，请先绘制图案。';
  controls(); groupsEditor?.render();
}
function commit(next: Board): void { history.commit({...history.current, board: next}); board = history.current.board; rows.value = String(board.rows); columns.value = String(board.columns); preset.value = board.rows === board.columns && [20, 32, 48, 64].includes(board.rows) ? String(board.rows) : ''; render(); }
function run(action: () => void): void { try { action(); } catch (cause) { message(errorMessage(cause), true); } }
function cell(event: PointerEvent): [number, number] | null {
  const rect = canvas.getBoundingClientRect(), c = Math.floor((event.clientX - rect.left) * board.columns / rect.width), r = Math.floor((event.clientY - rect.top) * board.rows / rect.height);
  return r >= 0 && r < board.rows && c >= 0 && c < board.columns ? [r, c] : null;
}
canvas.addEventListener('pointerdown', event => {
  if (!ready || busy || dialog.open || pointer !== null || event.button !== 0) return;
  const at = cell(event); if (!at) return;
  pointer = event.pointerId; last = at; canvas.setPointerCapture(pointer);
  paintLine(board, at, at, erasing ? '.' : symbol); render(); event.preventDefault();
});
canvas.addEventListener('pointermove', event => {
  if (event.pointerId !== pointer) return;
  const at = cell(event);
  if (at) { paintLine(board, last ?? at, at, erasing ? '.' : symbol); last = at; render(); }
  else last = null;
});
function endStroke(event: PointerEvent): void {
  if (event.pointerId !== pointer) return; pointer = null; last = null; commit(board); message('绘制完成，可撤销本次笔画');
}
canvas.addEventListener('pointerup', endStroke); canvas.addEventListener('pointercancel', endStroke); canvas.addEventListener('lostpointercapture', endStroke);
button('brush').onclick = () => { erasing = false; controls(); };
button('eraser').onclick = () => { erasing = true; controls(); };
button('new-board').onclick = () => run(() => { commit(dimensions()); message('已生成空白棋盘，可绘制或导入图片'); });
button('clear').onclick = () => { commit(blank(board.rows, board.columns)); message('已清空棋盘，可撤销'); };
const undo = (): void => { history.undo(); board = history.current.board; commit(board); message('已撤销'); };
const redo = (): void => { history.redo(); board = history.current.board; commit(board); message('已重做'); };
button('undo').onclick = undo; button('redo').onclick = redo;
document.addEventListener('keydown', event => {
  if (!ready || busy || pointer !== null || dialog.open || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); }
});
preset.onchange = () => { if (preset.value) rows.value = columns.value = preset.value; };
rows.oninput = columns.oninput = () => { preset.value = ''; };
zoom.oninput = render;
button('export-json').onclick = () => run(() => {
  const blob = new Blob([JSON.stringify(documentFor(board), null, 2) + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `board-${board.rows}x${board.columns}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); message('已导出棋盘配置，可重新导入继续编辑');
});
button('copy-csv').onclick = async () => {
  const doc = documentFor(board), csv = `rows,columns,boardCells\n${doc.rows},${doc.columns},${doc.boardCells}`;
  try { await navigator.clipboard.writeText(csv); message('已复制棋盘CSV字段'); }
  catch { config.value = csv; message('无法自动复制，请在配置预览中复制已选中的CSV字段', true); config.closest('details')!.open = true; config.focus(); config.select(); }
};
button('import-json').onclick = () => input('json-file').click();
input('json-file').onchange = async () => {
  const field = input('json-file'), file = field.files?.[0]; field.value = ''; if (!file) return;
  busy = true; controls();
  try {
    if (file.size > 1024 * 1024) throw new Error('棋盘配置文件不能超过1MB');
    const next = importBoard(JSON.parse(await file.text()) as unknown); commit(next); message('已导入棋盘配置');
  } catch (cause) { message(errorMessage(cause), true); }
  finally { busy = false; controls(); }
};
function fillPreview(): void {
  filled = null;
  try {
    if (!pending) return;
    filled = imageBoard(pending.image, pending.rows, pending.columns, palette, removeWhite.checked, colorCount.value === '' ? undefined : Number(colorCount.value));
    draw(imagePreview, filled, 0, false); imageStatus.textContent = `${filled.rows} × ${filled.columns} · ${filled.pixels.filter(p => p !== '.').length}个有效格子 · ${counts(filled).filter(total => total > 0).length}种颜色`;
  } catch (cause) { imagePreview.getContext('2d')?.clearRect(0, 0, imagePreview.width, imagePreview.height); imageStatus.textContent = errorMessage(cause); }
  button('apply-image').disabled = !filled;
}
button('import-image').onclick = () => input('image-file').click();
input('image-file').onchange = async () => {
  const field = input('image-file'), file = field.files?.[0]; field.value = ''; if (!file) return;
  busy = true; controls(); message('正在处理图片…'); let url = '';
  try {
    const next = dimensions();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('请选择不超过10MB的PNG、JPG或WebP图片');
    url = URL.createObjectURL(file); const img = new Image(); img.src = url;
    try { await img.decode(); } catch { throw new Error('无法读取图片，请确认文件完整并使用PNG、JPG或WebP格式'); }
    const factor = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
    const working = document.createElement('canvas'); working.width = Math.max(1, Math.round(img.naturalWidth * factor)); working.height = Math.max(1, Math.round(img.naturalHeight * factor));
    const context = working.getContext('2d'); if (!context) throw new Error('浏览器无法读取图片');
    context.drawImage(img, 0, 0, working.width, working.height);
    pending = { image: context.getImageData(0, 0, working.width, working.height), url, rows: next.rows, columns: next.columns };
    imageOriginal.src = url; removeWhite.checked = true; fillPreview(); dialog.showModal(); message('图片初稿已生成，应用后仍可逐格修改');
  } catch (cause) { if (url) URL.revokeObjectURL(url); pending = null; message(errorMessage(cause), true); }
  finally { busy = false; controls(); }
};
removeWhite.onchange = fillPreview;
colorCount.onchange = fillPreview;
button('apply-image').onclick = () => {
  if (!filled || !pending) return;
  commit(filled); if (referenceUrl) URL.revokeObjectURL(referenceUrl); referenceUrl = pending.url;
  reference.src = referenceUrl; reference.hidden = false; element('no-reference', HTMLParagraphElement).hidden = true;
  pending = null; dialog.close(); message('已填充棋盘，现在可以选择颜色继续修整');
};
button('cancel-image').onclick = () => dialog.close();
dialog.addEventListener('close', () => { if (pending) URL.revokeObjectURL(pending.url); pending = null; filled = null; controls(); });
window.addEventListener('beforeunload', event => { if (JSON.stringify({...history.current, board}) !== saved) { event.preventDefault(); event.returnValue = ''; } });

async function start(): Promise<void> {
  controls();
  try {
    const response = await fetch('/api/palette'); if (!response.ok) throw new Error('读取游戏调色板失败');
    const data: unknown = await response.json();
    if (!Array.isArray(data) || !data.every(p => p && typeof p === 'object' && typeof p.id === 'string' && typeof p.hex === 'string')) throw new Error('调色板数据无效');
    palette = data as PaletteColor[]; paletteRGB(palette);
    const swatch = (hex: string): HTMLSpanElement => { const s = document.createElement('span'); s.className = 'swatch'; s.style.backgroundColor = hex; return s; };
    palette.forEach((p, i) => {
      const node = document.createElement('button'), name = document.createElement('span'); node.className = 'color-button'; node.dataset.symbol = String.fromCharCode(65 + i);
      name.textContent = names[i]!; node.title = `${p.id} ${p.hex}`; node.setAttribute('aria-label', `画笔颜色：${names[i]}`); node.append(swatch(p.hex), name);
      node.onclick = () => { symbol = node.dataset.symbol!; erasing = false; controls(); }; element('palette', HTMLDivElement).append(node);
      const count = document.createElement('div'), text = document.createElement('span'), number = document.createElement('strong'); count.className = 'count-row'; text.textContent = names[i]!; number.id = `count-${i}`;
      count.append(swatch(p.hex), text, number); element('counts', HTMLDivElement).append(count);
    });
    groupsEditor = mountGroupsEditor({ read: () => ({...history.current, board: structuredClone(board)}), commit: (draft: LevelDraft) => { history.commit(draft); board = history.current.board; rows.value = String(board.rows); columns.value = String(board.columns); render(); }, markSaved: () => { saved = JSON.stringify({...history.current, board}); }, locked: () => !ready || busy || pointer !== null || dialog.open, palette, message });
    ready = true; render(); message('从空白开始绘制，或者导入参考图片生成初稿');
  } catch (cause) { message(errorMessage(cause), true); }
}
void start();

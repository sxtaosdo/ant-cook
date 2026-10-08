export interface PaletteColor { id: string; hex: string }
export interface Board { rows: number; columns: number; pixels: string[] }
export interface Pixels { width: number; height: number; data: Uint8ClampedArray }
export const SCHEMA = 'colony-board-v1';
const symbols = 'ABCDEFGHIJKL';
const copy = (b: Board): Board => ({ ...b, pixels: [...b.pixels] });

export function blank(rows: number, columns: number): Board {
  if (![rows, columns].every(n => Number.isInteger(n) && n >= 1 && n <= 64)) throw new Error('行数和列数必须为1–64的整数');
  return { rows, columns, pixels: Array<string>(rows * columns).fill('.') };
}
export function validate(board: Board, allowEmpty = false): void {
  blank(board.rows, board.columns);
  if (board.pixels.length !== board.rows * board.columns || board.pixels.some(p => !/^[.A-L]$/.test(p))) throw new Error('棋盘格子或颜色编码无效');
  if (!allowEmpty && board.pixels.every(p => p === '.')) throw new Error('棋盘为空，请先绘制图案');
}
export function documentFor(board: Board): { schema: string; rows: number; columns: number; boardCells: string } {
  validate(board);
  const lines = Array.from({ length: board.rows }, (_, r) => board.pixels.slice(r * board.columns, (r + 1) * board.columns).join(''));
  return { schema: SCHEMA, rows: board.rows, columns: board.columns, boardCells: lines.join('/') };
}
export function importBoard(value: unknown): Board {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('棋盘JSON必须是对象');
  const v = value as Record<string, unknown>;
  if (v.schema !== SCHEMA || typeof v.rows !== 'number' || typeof v.columns !== 'number' || typeof v.boardCells !== 'string') throw new Error('不支持的棋盘配置格式');
  const board = blank(v.rows, v.columns); const lines = v.boardCells.split('/');
  if (lines.length !== board.rows || lines.some(line => line.length !== board.columns)) throw new Error('棋盘矩阵与行列数量不一致');
  board.pixels = lines.join('').split(''); validate(board); return board;
}
export function counts(board: Board): number[] {
  return Array.from(symbols, symbol => board.pixels.filter(p => p === symbol).length);
}
export function paintLine(board: Board, from: [number, number], to: [number, number], symbol: string): void {
  if (!/^[.A-L]$/.test(symbol)) throw new Error('无效画笔颜色');
  let [r, c] = from; const [endR, endC] = to;
  if (![from, to].every(([y, x]) => Number.isInteger(y) && Number.isInteger(x) && y >= 0 && y < board.rows && x >= 0 && x < board.columns)) throw new Error('绘制位置超出棋盘');
  const dx = Math.abs(endC - c), dy = -Math.abs(endR - r), sx = c < endC ? 1 : -1, sy = r < endR ? 1 : -1;
  let error = dx + dy;
  while (true) {
    board.pixels[r * board.columns + c] = symbol;
    if (r === endR && c === endC) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; c += sx; }
    if (twice <= dx) { error += dx; r += sy; }
  }
}
export class History {
  private past: Board[] = [];
  private future: Board[] = [];
  private board: Board;
  public constructor(board: Board) { validate(board, true); this.board = copy(board); }
  public get current(): Board { return copy(this.board); }
  public get canUndo(): boolean { return this.past.length > 0; }
  public get canRedo(): boolean { return this.future.length > 0; }
  public commit(board: Board): void {
    validate(board, true);
    if (JSON.stringify(board) === JSON.stringify(this.board)) return;
    this.past.push(copy(this.board)); this.past = this.past.slice(-50); this.future = []; this.board = copy(board);
  }
  public undo(): void { const b = this.past.pop(); if (b) { this.future.push(copy(this.board)); this.board = b; } }
  public redo(): void { const b = this.future.pop(); if (b) { this.past.push(copy(this.board)); this.board = b; } }
}
export function paletteRGB(palette: readonly PaletteColor[]): number[][] {
  if (palette.length !== 12 || new Set(palette.map(p => p.id)).size !== 12 || palette.some(p => !p.id || !/^#[0-9A-Fa-f]{6}$/.test(p.hex))) throw new Error('游戏调色板无效');
  return palette.map(p => [1, 3, 5].map(i => Number.parseInt(p.hex.slice(i, i + 2), 16)));
}

/** Edge-connected white removal, alpha-aware area sampling and deterministic 12-color matching. */
export function imageBoard(image: Pixels, rows: number, columns: number, palette: readonly PaletteColor[], removeWhite: boolean, colorCount?: number): Board {
  if (colorCount !== undefined && (!Number.isInteger(colorCount) || colorCount < 1 || colorCount > 12)) throw new Error('颜色数量必须为1–12的整数');
  const board = blank(rows, columns), colors = paletteRGB(palette);
  const samples = new Map<number, number[]>();
  const { width: w, height: h, data } = image, n = w * h;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > 2048 || h > 2048 || data.length !== n * 4) throw new Error('图片像素数据无效');
  const outside = new Uint8Array(n);
  if (removeWhite) {
    const queue = new Int32Array(n); let head = 0, tail = 0;
    const add = (i: number): void => {
      const p = i * 4;
      if (!outside[i] && (data[p + 3]! < 128 || data[p]! >= 245 && data[p + 1]! >= 245 && data[p + 2]! >= 245)) { outside[i] = 1; queue[tail++] = i; }
    };
    for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { add(y * w); add(y * w + w - 1); }
    while (head < tail) {
      const i = queue[head++]!;
      if (i % w > 0) add(i - 1); if (i % w < w - 1) add(i + 1);
      if (i >= w) add(i - w); if (i < n - w) add(i + w);
    }
  }
  const visible = (i: number): boolean => !outside[i] && data[i * 4 + 3]! >= 128;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let i = 0; i < n; i++) if (visible(i)) {
    const x = i % w, y = Math.floor(i / w);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  if (maxX < 0) throw new Error('未识别到有效图案，请尝试保留白色背景');
  const pad = Math.min(rows, columns) >= 3 ? 1 : 0;
  const scale = Math.min((columns - pad * 2) / (maxX - minX + 1), (rows - pad * 2) / (maxY - minY + 1));
  const left = (columns - (maxX - minX + 1) * scale) / 2, top = (rows - (maxY - minY + 1) * scale) / 2;
  for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
    const x0 = minX + (c - left) / scale, x1 = x0 + 1 / scale, y0 = minY + (r - top) / scale, y1 = y0 + 1 / scale;
    let area = 0, weight = 0; const rgb = [0, 0, 0];
    for (let y = Math.max(minY, Math.floor(y0)); y < Math.min(maxY + 1, Math.ceil(y1)); y++)
      for (let x = Math.max(minX, Math.floor(x0)); x < Math.min(maxX + 1, Math.ceil(x1)); x++) {
        const i = y * w + x; if (!visible(i)) continue;
        const a = Math.max(0, Math.min(x + 1, x1) - Math.max(x, x0)) * Math.max(0, Math.min(y + 1, y1) - Math.max(y, y0));
        const weighted = a * data[i * 4 + 3]! / 255; area += a; weight += weighted;
        for (let k = 0; k < 3; k++) rgb[k]! += weighted * data[i * 4 + k]!;
      }
    const cellArea = Math.max(0, Math.min(c + 1, left + (maxX - minX + 1) * scale) - Math.max(c, left))
      * Math.max(0, Math.min(r + 1, top + (maxY - minY + 1) * scale) - Math.max(r, top));
    if (area * scale * scale < cellArea * 0.25 || !weight) continue;
    const average = rgb.map(v => v / weight);
    if (colorCount !== undefined) samples.set(r * columns + c, average);
    let best = 0, distance = Infinity;
    colors.forEach((color, i) => { const d = color.reduce((sum, v, k) => sum + (v - average[k]!) ** 2, 0); if (d < distance) { distance = d; best = i; } });
    board.pixels[r * columns + c] = symbols[best]!;
  }
  validate(board);
  if (colorCount !== undefined) {
    if (samples.size < colorCount) throw new Error(`当前仅有${samples.size}个有效格，无法生成${colorCount}色，请降低颜色数量`);
    const totals = counts(board);
    const distance = (sample: number[], color: number): number => colors[color]!.reduce((sum, v, k) => sum + (v - sample[k]!) ** 2, 0);
    const used = totals.map((_, i) => i).filter(i => totals[i]! > 0);
    if (used.length > colorCount) {
      const kept = used.sort((a, b) => totals[b]! - totals[a]! || a - b).slice(0, colorCount).sort((a, b) => a - b);
      for (const [cell, sample] of samples) {
        let best = kept[0]!;
        for (const color of kept) if (distance(sample, color) < distance(sample, best)) best = color;
        board.pixels[cell] = symbols[best]!;
      }
    } else {
      for (let count = used.length; count < colorCount; count++) {
        let bestCell = -1, bestColor = -1, increase = Infinity;
        for (const [cell, sample] of samples) {
          const previous = symbols.indexOf(board.pixels[cell]!);
          if (totals[previous]! <= 1) continue;
          for (let color = 0; color < colors.length; color++) if (totals[color] === 0) {
            const change = distance(sample, color) - distance(sample, previous);
            if (change < increase) { increase = change; bestCell = cell; bestColor = color; }
          }
        }
        totals[symbols.indexOf(board.pixels[bestCell]!)]!--; totals[bestColor]!++;
        board.pixels[bestCell] = symbols[bestColor]!;
      }
    }
  }
  return board;
}

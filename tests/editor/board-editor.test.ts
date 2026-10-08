import assert from 'node:assert/strict';
import test from 'node:test';
import { blank, counts, documentFor, History, imageBoard, importBoard, paintLine, paletteRGB, type Pixels } from '../../scripts/board-editor/core.ts';
import { readPalette } from '../../scripts/board-editor/palette.mjs';

const palette = await readPalette();
const rgb = paletteRGB(palette);
const image = (width: number, height: number, pixel: (x: number, y: number) => number[]): Pixels => ({
  width, height, data: new Uint8ClampedArray(Array.from({ length: width * height }, (_, i) => pixel(i % width, Math.floor(i / width))).flat()),
});
const colored = (index: number): number[] => [...rgb[index]!, 255];
const white = [255, 255, 255, 255], transparent = [0, 0, 0, 0];

test('palette comes from game definitions in the existing CSV order', () => {
  assert.deepEqual(palette.map(p => p.id), ['berry', 'citrus', 'leaf', 'plum', 'blue', 'cocoa', 'gold', 'orange', 'yellow', 'white', 'cream', 'charcoal']);
  assert.equal(palette.length, 12);
  for (let i = 0; i < 12; i++) assert.equal(imageBoard(image(1, 1, () => colored(i)), 1, 1, palette, false).pixels[0], String.fromCharCode(65 + i));
  assert.throws(() => paletteRGB(palette.slice(1)), /调色板/);
  assert.throws(() => paletteRGB([...palette.slice(0, 11), palette[0]!]), /调色板/);
});
test('non-square config preserves every color, blanks and CSV row order', () => {
  const board = { rows: 3, columns: 5, pixels: 'ABCDE.FGHIJKL..'.split('') };
  const doc = documentFor(board);
  assert.equal(doc.boardCells, 'ABCDE/.FGHI/JKL..');
  assert.deepEqual(importBoard(JSON.parse(JSON.stringify(doc))), board);
  assert.equal(counts(board).reduce((a, b) => a + b), 12);
  assert.deepEqual(counts(board), Array(12).fill(1));
});
test('invalid dimensions, encoding, schema, empty and malformed documents are rejected', () => {
  for (const n of [0, 65, 1.5, NaN, Infinity]) assert.throws(() => blank(n, 32));
  assert.equal(blank(64, 64).pixels.length, 4096);
  assert.throws(() => documentFor(blank(3, 4)), /棋盘为空/);
  const valid = { schema: 'colony-board-v1', rows: 1, columns: 2, boardCells: 'AB' };
  for (const value of [null, [], 'json', {}, { ...valid, schema: 'v2' }, { ...valid, rows: '1' }, { ...valid, boardCells: 'A' }, { ...valid, boardCells: 'AM' }, { ...valid, boardCells: '..' }]) assert.throws(() => importBoard(value));
});
test('drag interpolation fills contiguous cells and a whole stroke is one undo', () => {
  const history = new History(blank(5, 5)), draft = history.current;
  paintLine(draft, [0, 0], [4, 4], 'B');
  paintLine(draft, [4, 4], [4, 0], 'B');
  history.commit(draft);
  assert.equal(counts(history.current)[1], 9);
  history.undo(); assert.deepEqual(history.current, blank(5, 5));
  history.redo(); assert.deepEqual(history.current, draft);
  paintLine(draft, [4, 0], [4, 4], '.'); assert.equal(counts(draft)[1], 4);
  assert.throws(() => paintLine(draft, [0, 0], [5, 0], 'A'));
  assert.throws(() => paintLine(draft, [0, 0], [0, 1], 'M'));
});
test('resize, image fill and clear are reversible and history copies cannot mutate stored state', () => {
  const history = new History(blank(2, 3));
  const filled = imageBoard(image(2, 1, () => colored(0)), 5, 7, palette, true);
  history.commit(filled); history.commit(blank(5, 7));
  history.undo(); assert.deepEqual(history.current, filled);
  history.undo(); assert.deepEqual(history.current, blank(2, 3));
  history.commit(history.current); assert.equal(history.canRedo, true);
  const copy = history.current; copy.pixels[0] = 'L'; assert.equal(history.current.pixels[0], '.');
  history.commit(copy); assert.equal(history.canRedo, false);
});
test('history retains exactly the latest 50 edits', () => {
  const history = new History(blank(1, 1));
  for (let i = 0; i < 60; i++) history.commit({ rows: 1, columns: 1, pixels: [i % 2 ? 'B' : 'A'] });
  let undos = 0; while (history.canUndo) { history.undo(); undos++; }
  assert.equal(undos, 50); assert.equal(history.current.pixels[0], 'B');
  let redos = 0; while (history.canRedo) { history.redo(); redos++; }
  assert.equal(redos, 50); assert.equal(history.current.pixels[0], 'B');
});
test('transparent margins are trimmed and a wide subject is centered with padding', () => {
  const source = image(10, 8, (x, y) => x >= 3 && x < 7 && y >= 3 && y < 5 ? colored(0) : transparent);
  const board = imageBoard(source, 8, 10, palette, false);
  const occupied = board.pixels.flatMap((p, i) => p === '.' ? [] : [[Math.floor(i / 10), i % 10]]);
  assert.equal(occupied.length, 32);
  assert.deepEqual([Math.min(...occupied.map(p => p[0]!)), Math.max(...occupied.map(p => p[0]!))], [2, 5]);
  assert.deepEqual([Math.min(...occupied.map(p => p[1]!)), Math.max(...occupied.map(p => p[1]!))], [1, 8]);
  assert.ok(occupied.every(([r, c]) => board.pixels[r! * 10 + c!] === 'A'));
});
test('edge-connected white disappears while enclosed white remains editable', () => {
  const source = image(7, 7, (x, y) => x < 1 || x > 5 || y < 1 || y > 5 || x >= 2 && x <= 4 && y >= 2 && y <= 4 ? white : colored(0));
  const removed = imageBoard(source, 7, 7, palette, true);
  assert.equal(removed.pixels[0], '.'); assert.equal(removed.pixels[3 * 7 + 3], 'J');
  assert.equal(removed.pixels[1 * 7 + 1], 'A');
  assert.equal(counts(removed)[9], 9);
  const retained = imageBoard(source, 9, 9, palette, false);
  assert.equal(retained.pixels[1 * 9 + 1], 'J'); assert.equal(counts(retained)[9], 33);
});
test('area sampling uses alpha-weighted averages and keeps a thin subject', () => {
  const source = image(100, 1, x => x % 2 ? [0, 0, 0, 128] : [255, 255, 255, 255]);
  const tiny = imageBoard(source, 1, 1, palette, false);
  const average = 255 * 255 / (255 + 128);
  const best = rgb.map(color => color.reduce((sum, v) => sum + (v - average) ** 2, 0)).indexOf(Math.min(...rgb.map(color => color.reduce((sum, v) => sum + (v - average) ** 2, 0))));
  assert.equal(tiny.pixels[0], String.fromCharCode(65 + best));
  assert.ok(imageBoard(image(30, 1, () => colored(2)), 32, 32, palette, true).pixels.some(p => p === 'C'));
});
test('empty or invalid images fail without altering the previous board', () => {
  const history = new History({ rows: 1, columns: 1, pixels: ['A'] });
  for (const source of [image(2, 2, () => white), image(2, 2, () => transparent), { width: 2, height: 2, data: new Uint8ClampedArray(3) }]) {
    assert.throws(() => history.commit(imageBoard(source, 5, 5, palette, true)));
    assert.equal(history.current.pixels[0], 'A');
  }
  assert.equal(imageBoard(image(1, 1, () => white), 1, 1, palette, false).pixels[0], 'J');
});

test('automatic conversion and an already matching color count preserve the original board', () => {
  const source = image(2, 1, x => colored(x));
  const automatic = imageBoard(source, 2, 4, palette, false);
  assert.deepEqual(automatic.pixels, 'AABBAABB'.split(''));
  assert.deepEqual(imageBoard(source, 2, 4, palette, false, undefined), automatic);
  assert.deepEqual(imageBoard(source, 2, 4, palette, false, 2), automatic);
});

test('reducing colors retains the most frequent colors with palette order breaking ties', () => {
  const source = image(6, 1, x => colored([2, 2, 2, 1, 1, 0][x]!));
  const reduced = imageBoard(source, 1, 6, palette, false, 2);
  assert.deepEqual([...new Set(reduced.pixels)].sort(), ['B', 'C']);
  assert.equal(reduced.pixels.slice(0, 5).join(''), 'CCCBB');
  const tied = imageBoard(image(3, 1, x => colored(2 - x)), 1, 3, palette, false, 2);
  assert.deepEqual([...new Set(tied.pixels)].sort(), ['A', 'B']);
  assert.deepEqual(imageBoard(source, 1, 6, palette, false, 1).pixels, Array(6).fill('C'));
});

test('a single-color image supports every exact count while preserving its occupied cells', () => {
  const source = image(10, 8, (x, y) => x >= 3 && x < 7 && y >= 3 && y < 5 ? colored(0) : transparent);
  const original = imageBoard(source, 8, 10, palette, false);
  for (let n = 1; n <= 12; n++) {
    const exact = imageBoard(source, 8, 10, palette, false, n);
    assert.equal(counts(exact).filter(total => total > 0).length, n);
    assert.deepEqual(exact.pixels.map(p => p === '.'), original.pixels.map(p => p === '.'));
    assert.deepEqual(imageBoard(source, 8, 10, palette, false, n), exact);
    assert.deepEqual(importBoard(documentFor(exact)), exact);
  }
  const minimum = imageBoard(image(12, 1, () => colored(0)), 1, 12, palette, false, 12);
  assert.deepEqual(counts(minimum), Array(12).fill(1));
  const maximum = imageBoard(image(1, 1, () => colored(0)), 64, 64, palette, false, 12);
  assert.equal(counts(maximum).filter(total => total > 0).length, 12);
});

test('invalid or impossible color counts reject conversion without changing history', () => {
  const history = new History({ rows: 1, columns: 1, pixels: ['B'] });
  const source = image(1, 1, () => colored(0));
  for (const n of [0, 13, 1.5, NaN, Infinity]) assert.throws(() => imageBoard(source, 2, 2, palette, false, n), /颜色数量/);
  assert.throws(() => history.commit(imageBoard(source, 1, 1, palette, false, 2)), /当前仅有1个有效格，无法生成2色/);
  assert.deepEqual(history.current, { rows: 1, columns: 1, pixels: ['B'] });
  assert.equal(history.canUndo, false);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { compileThemeCsv } from '../../scripts/compileThemeCsv.mjs';
import { OPERATIONAL_THEME_DATA } from '../../assets/Colony/scripts/application/operationalThemeData';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('five theme CSV files deterministically compile to the checked-in runtime catalog', () => {
  const compiled = compileThemeCsv();
  assert.deepEqual(compiled, OPERATIONAL_THEME_DATA);
  assert.equal(compiled.themes.length, 5);
  assert.equal(compiled.levels.length, 60);
  assert.deepEqual(compiled.themes.map((theme) => theme.items.length), [8, 8, 8, 8, 8]);
  execFileSync(process.execPath, ['scripts/compileThemeCsv.mjs', '--check'], { cwd: root });
});

test('the original mango lesson remains intact and every theme follows its twelve-level collection sequence', () => {
  const { themes, levels } = compileThemeCsv();
  const first = levels[0];
  assert.equal(first!.boardRender, 'square');
  assert.equal(first!.sourceId, 'night-market-1/main/1');
  assert.equal(first!.rows, 20);
  assert.equal(first!.columns, 20);
  assert.equal(first!.targetItemId, 'mango');
  assert.equal(first!.cells.length, 165);
  assert.equal(first!.groups.length, 15);
  assert.equal(createHash('sha256').update(JSON.stringify(first)).digest('hex'), 'd779ca07ea1474b59804c6ddef5bce5fb4b9ec665e4d05f8f3489f51cb615817');
  assert.ok(levels.every(level => level.boardRender === 'square'));
  for (const [index, theme] of themes.entries()) {
    const sequence = index === 0 ? [1, 0, 2, 3, 4, 5, 1, 2, 3, 4, 6, 7] : [0, 1, 2, 3, 4, 5, 1, 2, 3, 4, 6, 7];
    const slice = levels.slice(index * 12, index * 12 + 12);
    assert.deepEqual(slice.map(level => level.targetItemId), sequence.map(item => theme.items[item]!.id));
    assert.deepEqual(theme.items.map(item => item.target), [1, 2, 2, 2, 2, 1, 1, 1]);
    for (const item of theme.items.filter(item => item.kind !== 'produce')) {
      const kind = item.id.slice(theme.id.length + 1);
      const prefix = index === 0 && ['stall', 'lantern'].includes(kind) ? 'themes/tropical-fruit/collection' : 'collection';
      assert.equal(item.iconPath, `assets/Colony/art/toy-market/${prefix}/${kind}-256.png`);
      assert.equal(item.boardPath, `assets/Colony/art/toy-market/${prefix}/${kind}-board.png`);
    }
  }
  assert.deepEqual(levels.map(level => level.sourceId), Array.from({ length: 60 }, (_, index) => `night-market-1/main/${index + 1}`));
});

test('difficulty tuning preserves all main collection, asset, source and background metadata', () => {
  const retained = compileThemeCsv().levels.map(({ rows, columns, cells, groups, ...metadata }) => metadata);
  assert.equal(createHash('sha256').update(JSON.stringify(retained)).digest('hex'), 'f3b785dbc20f7d437adb1c809103c6b9e5315df939ef3546aa2790a123b63d1c');
});

test('second mango uses its own reference while tutorial and collection mango remain original', () => {
  const { themes, levels } = compileThemeCsv();
  assert.equal(levels[0]!.boardPath, 'assets/Colony/art/toy-market/items/mango-board.png');
  assert.equal(themes[0]!.items[1]!.boardPath, levels[0]!.boardPath);
  assert.equal(levels[6]!.boardPath, 'assets/Colony/art/toy-market/themes/tropical-fruit/variants/mango-half/items/mango-board.png');
  assert.equal(levels[6]!.iconPath, levels[0]!.iconPath);
  assert.equal(levels[1]!.cells.length, 566);
  assert.equal(levels[6]!.cells.length, 651);
});

test('later main boards use detailed silhouettes and bounded delivery groups', () => {
  for (const level of compileThemeCsv().levels.slice(1)) {
    assert.ok(level.rows >= 32 && level.rows <= 48);
    assert.ok(level.columns >= 32 && level.columns <= 48);
    const rows = level.cells.map(cell => cell.row);
    const columns = level.cells.map(cell => cell.column);
    const span = Math.max(Math.max(...rows) - Math.min(...rows) + 1, Math.max(...columns) - Math.min(...columns) + 1);
    assert.ok(span >= 21, level.sourceId);
    assert.ok(level.cells.length >= 100 && level.cells.length <= (level.level === 7 ? 651 : 600), level.sourceId);
    assert.ok(level.groups.length >= 5 && level.groups.length <= 30, level.sourceId);
    assert.ok(level.groups.every(group => group.count >= 2 && group.count <= 50), level.sourceId);
  }
});

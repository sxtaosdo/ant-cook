// Migrated from colony-flow-food-hunt; source SHA256 1d3a5ab54c441412ffcf1b71aa6820096a4eb0189ff07cb9460cf1f4df9b2d72.
import { GAME_COLORS, MAIN_SUPPLY_LEVELS, MAX_GROUP_COUNT, queueColumns, validateDevelopmentLevel } from '../assets/Colony/scripts/application/levelCatalog.ts';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configRoot = join(projectRoot, 'assets/Colony/config/themes');
const outputPath = join(projectRoot, 'assets/Colony/scripts/application/operationalThemeData.ts');
export const themeIds = ['tropical-fruit', 'tropical-vegetable', 'orchard-fruit', 'root-vegetable', 'leafy-vegetable'];
const colors = [...GAME_COLORS];
export const columns = ['themeId', 'themeName', 'level', 'sourceId', 'itemId', 'itemName', 'itemKind', 'targetCount', 'iconPath', 'boardPath', 'farPath', 'farX', 'farY', 'midPath', 'midX', 'midY', 'nearPath', 'nearX', 'nearY', 'rows', 'columns', 'boardCells', 'cellOrder', 'groups', 'boardRender'];
export const ruleColumns = [...columns, 'queueColumns', 'groupRules', 'cellKeys'];
const itemOrder = [0, 1, 2, 3, 4, 5, 1, 2, 3, 4, 6, 7];

function fail(message) { throw new Error(message); }

export function csvRows(source) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += char;
  }
  if (quoted) fail('Unclosed CSV quote');
  if (row.length || field) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function ruleMap(value, label) {
  if (value === undefined || value === '') return {};
  let result;
  try { result = JSON.parse(value); } catch { fail(`${label} must be a JSON object`); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail(`${label} must be a JSON object`);
  return result;
}

function number(value, label, minimum = -Infinity) {
  if (!/^-?\d+$/.test(value)) fail(`${label} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) fail(`${label} is out of range`);
  return parsed;
}

function assetPath(value, label, suffix) {
  if (!/^assets\/Colony\/art\/toy-market\/[a-z0-9/_-]+\.png$/.test(value) || !value.endsWith(suffix)) fail(`${label} has invalid asset path: ${value}`);
  return value;
}

function pngSize(path) {
  const bytes = readFileSync(path);
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') fail(`${path} is not a PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function assertAsset(path, width, height, assetRoot = projectRoot) {
  const absolute = join(assetRoot, path);
  if (!existsSync(absolute)) fail(`Missing asset: ${path}`);
  const [actualWidth, actualHeight] = pngSize(absolute);
  if (width && (actualWidth !== width || actualHeight !== height)) fail(`${path} must be ${width}x${height}; found ${actualWidth}x${actualHeight}`);
}

export function compileThemeCsv({ checkAssets = false, inputRoot = configRoot, assetRoot = projectRoot, sources = new Map() } = {}) {
  const themes = [], levels = [], allItems = new Set();
  for (const [themeIndex, themeId] of themeIds.entries()) {
    const path = join(inputRoot, themeId, 'levels.csv');
    if (!existsSync(path)) fail(`Missing theme CSV: ${path}`);
    const table = csvRows((sources.get(themeId) ?? readFileSync(path, 'utf8')).replace(/^\uFEFF/, ''));
    const header = table[0];
    if (![columns.join(','), ruleColumns.join(',')].includes(header?.join(','))) fail(`${themeId}: header differs from schema`);
    if (table.length !== 13) fail(`${themeId}: expected exactly 12 levels`);
    const items = new Map();
    let themeName = '';
    for (let localIndex = 0; localIndex < 12; localIndex += 1) {
      const values = table[localIndex + 1];
      if (values.length !== header.length) fail(`${themeId} row ${localIndex + 2}: expected ${header.length} columns`);
      const record = Object.fromEntries(header.map((column, index) => [column, values[index]]));
      const level = themeIndex * 12 + localIndex + 1;
      if (record.themeId !== themeId || number(record.level, `${themeId} level`, 1) !== level) fail(`${themeId} row ${localIndex + 2}: theme or level order mismatch`);
      if (!record.themeName || (themeName && themeName !== record.themeName)) fail(`${themeId}: inconsistent theme name`);
      themeName = record.themeName;
      if (!/^[a-z][a-z0-9-]*$/.test(record.itemId) || !record.itemName) fail(`Level ${level}: invalid item`);
      if (record.sourceId !== `night-market-1/main/${level}`) fail(`Level ${level}: sourceId changed`);
      const stallIndex = themeIndex === 0 ? 1 : 0;
      const expectedKind = localIndex === stallIndex ? 'stall' : [5, 10, 11].includes(localIndex) ? 'decoration' : 'produce';
      const expectedAsset = localIndex === stallIndex ? 'stall' : localIndex === 5 ? 'lantern' : localIndex === 10 ? 'sign' : localIndex === 11 ? 'planter' : record.itemId;
      const target = number(record.targetCount, `Level ${level} targetCount`, 1);
      if (record.itemKind !== expectedKind || target !== (expectedKind === 'produce' ? 2 : 1)) fail(`Level ${level}: invalid collection kind or target`);
      if (expectedKind !== 'produce' && record.itemId !== `${themeId}-${expectedAsset}`) fail(`Level ${level}: invalid theme collection item`);
      const prefix = expectedKind === 'produce' ? 'items' : 'collection';
      const iconPath = assetPath(record.iconPath, `Level ${level} icon`, `${prefix}/${expectedAsset}-256.png`);
      const boardPath = assetPath(record.boardPath, `Level ${level} board`, `${prefix}/${expectedAsset}-board.png`);
      const farPath = assetPath(record.farPath, `Level ${level} far`, `themes/${themeId}/far.png`);
      const midPath = assetPath(record.midPath, `Level ${level} mid`, `themes/${themeId}/mid.png`);
      const nearPath = assetPath(record.nearPath, `Level ${level} near`, `themes/${themeId}/near.png`);
      const art = items.get(record.itemId) ?? { id: record.itemId, name: record.itemName, kind: expectedKind, target, iconPath, boardPath, count: 0 };
      // The first occurrence supplies collection art; later levels may use another board reference.
      if (art.name !== record.itemName || art.kind !== expectedKind || art.target !== target || art.iconPath !== iconPath) fail(`Level ${level}: item metadata changed within theme`);
      art.count += 1;
      items.set(record.itemId, art);
      if (allItems.has(record.itemId) && art.count === 1) fail(`Level ${level}: item reused across themes`);
      allItems.add(record.itemId);
      const rows = number(record.rows, `Level ${level} rows`, 1);
      const cols = number(record.columns, `Level ${level} columns`, 1);
      if (record.boardRender !== 'square') fail(`Level ${level}: main levels must use square tiles`);
      const matrix = record.boardCells.split('/');
      if (matrix.length !== rows || matrix.some((line) => line.length !== cols || /[^.A-L]/.test(line))) fail(`Level ${level}: matrix dimensions or symbols invalid`);
      const matrixCells = new Map();
      matrix.forEach((line, row) => [...line].forEach((symbol, column) => {
        if (symbol !== '.') matrixCells.set(`${row}.${column}`, colors[symbol.charCodeAt(0) - 65]);
      }));
      if (!matrixCells.size) fail(`Level ${level}: empty board`);
      const order = record.cellOrder.split('|');
      if (order.length !== matrixCells.size || new Set(order).size !== order.length) fail(`Level ${level}: cellOrder does not cover board`);
      const cells = order.map((coordinate) => {
        if (!/^\d+\.\d+$/.test(coordinate) || !matrixCells.has(coordinate)) fail(`Level ${level}: invalid cellOrder coordinate ${coordinate}`);
        const [row, column] = coordinate.split('.').map(Number);
        return { row, column, id: `cell-${row}-${column}`, color: matrixCells.get(coordinate) };
      });
      const queues = queueColumns(record.queueColumns === undefined ? 5 : number(record.queueColumns, `Level ${level} queueColumns`));
      const groupRules = ruleMap(record.groupRules, "groupRules");
      const cellKeys = ruleMap(record.cellKeys, "cellKeys");
      const depths = Array.from({length: queues}, () => 0), counts = new Map();
      const groups = record.groups.split('|').map((token, index) => {
        const parts = token.split(':');
        if (parts.length !== 4 || !/^[A-L]$/.test(parts[0])) fail(`Level ${level}: invalid group ${token}`);
        const color = colors[parts[0].charCodeAt(0) - 65];
        const count = number(parts[1], `Level ${level} group ${index} count`, 1);
        if (count > MAX_GROUP_COUNT) fail(`Level ${level} group ${index} count exceeds ${MAX_GROUP_COUNT}`);
        const pile = number(parts[2], `Level ${level} group ${index} pile`, 0);
        const depth = number(parts[3], `Level ${level} group ${index} depth`, 0);
        if (pile >= queues || depth !== depths[pile]++) fail(`Level ${level}: invalid group pile or depth`);
        counts.set(color, (counts.get(color) ?? 0) + count);
        const rules = groupRules[String(index)] ?? {};
        if (!rules || typeof rules !== "object" || Array.isArray(rules) || Object.keys(rules).some(key => !["mystery", "linkId", "lockId"].includes(key))) fail("Unknown group rule");
        return { id: `delivery-${index}`, color, count, pile, depth, ...rules };
      });
      if (Object.keys(groupRules).some(index => !/^(0|[1-9]\d*)$/.test(index) || Number(index) >= groups.length)) fail('groupRules references unknown group');
      for (const [coordinate, keyId] of Object.entries(cellKeys)) {
        const cell = cells.find(cell => `${cell.row}.${cell.column}` === coordinate);
        if (!cell) fail('cellKeys references unknown cell');
        cell.keyId = keyId;
      }
      validateDevelopmentLevel({level, sourceId: record.sourceId, shape: 'NIGHT_MARKET', rows, columns: cols, cells, groups, queueColumns: queues, initialSlots: MAIN_SUPPLY_LEVELS.includes(level) ? 6 : 5}, level);
      for (const color of colors) {
        if ((counts.get(color) ?? 0) !== cells.filter((cell) => cell.color === color).length) fail(`Level ${level}: ${color} group count mismatch`);
      }
      const background = {
        far: { path: farPath, x: number(record.farX, `Level ${level} farX`), y: number(record.farY, `Level ${level} farY`) },
        mid: { path: midPath, x: number(record.midX, `Level ${level} midX`), y: number(record.midY, `Level ${level} midY`) },
        near: { path: nearPath, x: number(record.nearX, `Level ${level} nearX`), y: number(record.nearY, `Level ${level} nearY`) },
      };
      if (checkAssets) {
        assertAsset(iconPath, 256, 256, assetRoot);
        assertAsset(boardPath, 512, 512, assetRoot);
        assertAsset(farPath, 750, 1334, assetRoot);
        assertAsset(midPath, undefined, undefined, assetRoot);
        assertAsset(nearPath, undefined, undefined, assetRoot);
      }
      levels.push({ level, sourceId: record.sourceId, shape: 'NIGHT_MARKET', themeId, targetItemId: record.itemId, iconPath, boardPath, boardRender: record.boardRender, background, rows, columns: cols, cells, groups, ...(queues === 5 ? {} : {queueColumns: queues}) });
    }
    if (items.size !== 8 || [...items.values()].some((item) => item.count !== item.target)) fail(`${themeId}: expected one stall, four produce twice, and three decorations`);
    const orderedItems = ['stall', 'produce', 'decoration'].flatMap(kind => [...items.values()].filter(item => item.kind === kind));
    const sequence = themeIndex === 0 ? [1, 0, ...itemOrder.slice(2)] : itemOrder;
    for (const [localIndex, level] of levels.slice(-12).entries()) {
      if (orderedItems[sequence[localIndex]]?.id !== level.targetItemId) fail(`Level ${level.level}: collection sequence mismatch`);
    }
    themes.push({ id: themeId, name: themeName, items: orderedItems.map(({ count: _count, ...item }) => item) });
  }
  if (levels.length !== 60 || allItems.size !== 40) fail('Expected 60 levels and 40 distinct items');
  return { themes, levels };
}

export function renderThemeData(data) {
  return `// Generated by scripts/compileThemeCsv.mjs from five theme levels.csv files. Do not edit.\nexport const OPERATIONAL_THEME_DATA = {\n  themes: [\n${data.themes.map(theme => `    ${JSON.stringify(theme)},`).join('\n')}\n  ],\n  levels: [\n${data.levels.map(level => `    ${JSON.stringify(level)},`).join('\n')}\n  ],\n} as const;\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some(value => !['--check', '--assets'].includes(value))) fail('Use --check/--assets; candidate output belongs to board-editor/compile-level.ts');
    const output = renderThemeData(compileThemeCsv({ checkAssets: process.argv.includes('--assets') }));
    if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== output) fail('operationalThemeData.ts is stale; preview a candidate, do not edit the generated file');
    console.log(`Theme CSV checked without writing: 5 themes, 60 levels, 40 items${process.argv.includes('--assets') ? ', assets checked' : ''}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

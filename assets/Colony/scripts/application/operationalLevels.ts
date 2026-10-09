import { MAIN_SUPPLY_LEVELS } from './levelCatalog';
import { GAME_COLORS, type DevelopmentLevelCatalog, type DevelopmentLevelCell } from './levelCatalog';
import { OPERATIONAL_THEME_DATA } from './operationalThemeData';
import { DAILY_DIFFICULTY_GROUPS } from './dailyDifficultyGroups';

export const OPERATIONAL_CONTENT_VERSION = 'night-market-1';
export const THEME_BASKETS = OPERATIONAL_THEME_DATA.themes;
/** Sparse relief rounds use the existing sixth slot; ordinary and daily rounds remain unchanged. */
export { MAIN_SUPPLY_LEVELS } from './levelCatalog';

export function themeForLevel(levelId: number) {
  if (!Number.isInteger(levelId) || levelId < 1 || levelId > OPERATIONAL_THEME_DATA.levels.length) return null;
  const level = OPERATIONAL_THEME_DATA.levels[levelId - 1]!;
  const themeIndex = THEME_BASKETS.findIndex(theme => theme.id === level.themeId);
  const theme = THEME_BASKETS[themeIndex]!;
  const itemIndex = theme.items.findIndex(item => item.id === level.targetItemId);
  return { themeIndex, itemIndex, theme, item: theme.items[itemIndex]!, level };
}

/** Main levels are generated from the five CSV files; daily challenges stay separate. */
export function createOperationalCatalog(): DevelopmentLevelCatalog {
  return { levels: OPERATIONAL_THEME_DATA.levels.map(level => MAIN_SUPPLY_LEVELS.some(id => id === level.level)
    ? { ...level, initialSlots: 6 as const } : level) };
}

function buildChallenge(index: number, level: number) {
  const difficulty = 2 + index % 3;
  const size = 19 + difficulty * 2;
  const middle = (size - 1) / 2;
  const coordinates = new Map<string, { row: number; column: number }>();
  const family = index % 5;
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const x = Math.abs(column - middle);
      const y = Math.abs(row - middle);
      const inside = family === 0 ? x + y <= middle + 3
        : family === 1 ? x * x + y * y <= (middle + 0.4) ** 2
        : family === 2 ? x <= middle - (row % 4 === 0 ? 2 : 0)
        : family === 3 ? x + y <= middle * 1.65 && (y < middle - 1 || x < middle - 2)
        : x <= middle && y <= middle && !(x > middle - 2 && y > middle - 2);
      if (inside) coordinates.set(`${row}:${column}`, { row, column });
    }
  }
  const signature = index + 61;
  for (let bit = 0; bit < 7; bit += 1) {
    const column = 1 + bit;
    const rows = [...coordinates.values()].filter(cell => cell.column === column).map(cell => cell.row);
    if (rows.length === 0) continue;
    const top = Math.min(...rows);
    const bottom = Math.max(...rows);
    if ((signature & (1 << bit)) !== 0) coordinates.delete(`${top}:${column}`);
    else coordinates.delete(`${bottom}:${column}`);
  }
  const cells: DevelopmentLevelCell[] = [];
  const remaining = new Map(coordinates);
  let layer = 0;
  while (remaining.size > 0) {
    const exposed = [...remaining.values()].filter(({ row, column }) =>
      [[row - 1, column], [row + 1, column], [row, column - 1], [row, column + 1]]
        .some(([r, c]) => !remaining.has(`${r}:${c}`)));
    const sectors = 3;
    for (let sector = 0; sector < sectors; sector += 1) {
      const portion = exposed.filter(({ row, column }) =>
        Math.min(sectors - 1, Math.floor(((index % 2 === 0 ? column : row) / size) * sectors)) === sector);
      if (portion.length === 0) continue;
      const color = GAME_COLORS[(layer % 3) * 3 + sector]!;
      for (const cell of portion) cells.push({ ...cell, id: `cell-${cell.row}-${cell.column}`, color });
    }
    for (const cell of exposed) remaining.delete(`${cell.row}:${cell.column}`);
    layer += 1;
  }
  return {
    level, sourceId: `${OPERATIONAL_CONTENT_VERSION}/challenge/${index + 1}`,
    shape: 'NIGHT_MARKET' as const, columns: size, rows: size, cells, groups: DAILY_DIFFICULTY_GROUPS[index]!,
  };
}

export function createChallengePool(): DevelopmentLevelCatalog {
  return { levels: Array.from({ length: 30 }, (_, index) => buildChallenge(index, index + 1)) };
}

/** UTC date arithmetic on an already Beijing-normalized day key avoids device timezone drift. */
export function createChallengeCatalog(dayKey: string): DevelopmentLevelCatalog {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) throw new Error('Invalid challenge day');
  const day = Date.parse(`${dayKey}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== dayKey) throw new Error('Invalid challenge day');
  const index = ((Math.floor(day / 86400000) % 30) + 30) % 30;
  return { levels: [buildChallenge(index, 1)] };
}

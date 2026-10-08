import { THEME_BASKETS, themeForLevel } from './operationalLevels';

export function collectionObject(itemId: string) {
  for (const [themeIndex, theme] of THEME_BASKETS.entries()) {
    const item = theme.items.find(candidate => candidate.id === itemId);
    if (item) return { themeIndex, theme, item };
  }
  return null;
}

/** Only campaign first clears count; sources are deterministic existing levels. */
export function readCollectionObject(clearedLevels: readonly number[], itemId: string) {
  const object = collectionObject(itemId);
  if (!object) return null;
  const sourceLevels = Array.from({ length: 60 }, (_, i) => i + 1).filter(level => themeForLevel(level)?.item.id === itemId);
  const count = sourceLevels.filter(level => clearedLevels.includes(level)).length;
  const nextSource = sourceLevels.find(level => !clearedLevels.includes(level)) ?? null;
  const nextPlayable = Math.min(60, clearedLevels.length + 1);
  const nextLevel = nextSource === null ? null : Math.min(nextSource, nextPlayable);
  const purpose = { stall: '作为本主题摊位外观永久展示', produce: '摆在本主题摊位上，展示已收集的果蔬', decoration: '作为本主题摆件永久展示' }[object.item.kind];
  return { ...object, sourceLevels, count, complete: count >= object.item.target, nextSource, nextLevel, purpose };
}

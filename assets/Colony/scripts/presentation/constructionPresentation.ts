import { readThemeCollections, type PlayerProgressSnapshot, type ThemeCollectionItem } from '../application/playerProgress';
import { themeForLevel } from '../application/operationalLevels';

export interface ConstructionButton { action: string; label: string; enabled: boolean }
export interface ConstructionItem extends ThemeCollectionItem { index: number; selected: boolean; nextLevel: number | null }
export interface CollectionFeedback {
  readonly itemId: string; readonly name: string; readonly iconPath: string;
  readonly count: number; readonly target: number; readonly collected: number;
}
export interface ConstructionModel {
  themeIndex: number; title: string; unlocked: boolean; completed: boolean; stallCollected: boolean;
  items: ConstructionItem[]; selected: number; detail: string; primary: ConstructionButton;
  previous: ConstructionButton; next: ConstructionButton; feedback: string;
  socialAvailable: boolean; socialUnread: number;
}
const button = (action: string, label: string, enabled = true): ConstructionButton => ({ action, label, enabled });

/** Only the approved first-theme first clears receive the expanded result projection. */
export function readCollectionFeedback(progress: PlayerProgressSnapshot, level: number, firstClear: boolean, daily: boolean): CollectionFeedback | undefined {
  if (!firstClear || daily || level < 2 || level > 12) return undefined;
  const target = themeForLevel(level)!;
  const theme = readThemeCollections(progress.clearedLevels)[0]!;
  const item = theme.items[target.itemIndex]!;
  return { itemId: item.id, name: item.name, iconPath: item.iconPath, count: item.count, target: item.target,
    collected: theme.items.reduce((sum, entry) => sum + entry.count, 0) };
}

/** One theme stall displays its permanent first-clear collection; legacy construction assets stay in the save. */
export function readConstruction(progress: PlayerProgressSnapshot, themeIndex = -1, selected = -1): ConstructionModel {
  const themes = readThemeCollections(progress.clearedLevels);
  if (!Number.isInteger(themeIndex) || themeIndex < 0 || themeIndex >= themes.length) {
    themeIndex = themes.findIndex(theme => theme.items.some(item => item.count < item.target));
    if (themeIndex < 0) themeIndex = themes.length - 1;
  }
  const theme = themes[themeIndex]!;
  const items = theme.items.map((item, index) => {
    const nextLevel = Array.from({ length: 12 }, (_, offset) => themeIndex * 12 + offset + 1)
      .find(level => themeForLevel(level)?.itemIndex === index && !progress.clearedLevels.includes(level)) ?? null;
    return { ...item, index, selected: false, nextLevel };
  });
  if (!Number.isInteger(selected) || selected < 0 || selected >= items.length) {
    const next = items.filter(item => item.nextLevel !== null).sort((a, b) => a.nextLevel! - b.nextLevel!)[0];
    selected = next?.index ?? 0;
  }
  items[selected]!.selected = true;
  const completed = items.every(item => item.count >= item.target);
  const stallCollected = items.some(entry => entry.kind === 'stall' && entry.count >= entry.target);
  const item = items[selected]!;
  const unlockedNext = progress.clearedLevels.length + 1;
  const targetLevel = item.nextLevel !== null && item.nextLevel <= unlockedNext
    ? item.nextLevel : items.find(entry => entry.nextLevel !== null && entry.nextLevel <= unlockedNext)?.nextLevel;
  let primary = button('noop', '本期收集已完成', false);
  let detail = `${item.name} · ${item.count}/${item.target}${item.count >= item.target ? ' · 已收集' : ' · 等待收集'}`;
  if (!theme.unlocked) {
    detail += '\n集齐前一主题后开放，摊位和装饰都来自关卡收集';
    primary = button(`level:${unlockedNext}`, `继续收集${themeForLevel(unlockedNext)?.item.name ?? '物品'}`);
  } else if (completed) {
    detail = '本主题摊位、果蔬和装饰已全部收集，成果永久展示';
    if (themeIndex < themes.length - 1) primary = button(`theme:${themeIndex + 1}`, '前往下一主题');
  } else if (targetLevel !== undefined && targetLevel !== null) {
    const target = themeForLevel(targetLevel)!.item;
    detail += `\n下一件：${target.name} · 第 ${targetLevel} 关，通关后自动展示`;
    primary = button(`level:${targetLevel}`, `去收集${target.name}`);
  }
  if (!stallCollected) {
    const collectedProduce = items.filter(entry => entry.kind === 'produce' && entry.count > 0);
    if (collectedProduce.length) detail += `\n${collectedProduce.map(entry => entry.name).join('、')}已收集并保留，收集摊位后会自动摆上`;
  }
  return { themeIndex, title: `${theme.name} · 收集摊位`, unlocked: theme.unlocked, completed,
    stallCollected, items, selected, detail, primary, socialAvailable: progress.clearedLevels.length >= 3,
    socialUnread: progress.social.history.filter(event => event.incoming && event.id > progress.social.readThrough).length,
    previous: button(`theme:${themeIndex - 1}`, '上一主题', themeIndex > 0),
    next: button(`theme:${themeIndex + 1}`, '下一主题', themeIndex < themes.length - 1), feedback: '' };
}

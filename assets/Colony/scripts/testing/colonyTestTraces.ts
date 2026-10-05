import type { DevelopmentLevelCatalog, DevelopmentLevelConfig } from '../application/levelCatalog';

type TraceKind = 'success' | 'failure';

/** 取指定关卡的数字组列表。 */
function stacksForLevel(catalog: DevelopmentLevelCatalog, level: number): DevelopmentLevelConfig['groups'] {
  const index = Math.max(1, Math.min(level, catalog.levels.length)) - 1;
  return catalog.levels[index]!.groups;
}

/**
 * 仅供自动化 / 单测的关卡操作轨迹。
 * 不属于 Product Core 或页面会话 API。
 */
export function colonyTestLevelTrace(
  catalog: DevelopmentLevelCatalog,
  level: number,
  kind: TraceKind,
): readonly string[] {
  const groups = stacksForLevel(catalog, level);
  if (kind === 'success') return groups.map((group) => group.id);
  return groups
    .filter((group) => group.depth === 0)
    .slice()
    .sort((left, right) => left.pile - right.pile)
    .map((group) => group.id);
}

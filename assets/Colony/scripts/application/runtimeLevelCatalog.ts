import { MAIN_SUPPLY_LEVELS, parseDevelopmentLevelCatalog, type DevelopmentLevelCatalog } from './levelCatalog';

/** Shared JSON boundary for the editor and game. Invalid data never falls back to old levels. */
export class RuntimeLevelCatalog {
  public static parse(raw: unknown): DevelopmentLevelCatalog {
    try {
      const catalog = parseDevelopmentLevelCatalog(raw);
      if (catalog.levels.length !== 60) throw new Error('必须包含完整的60关');
      for (const level of catalog.levels) {
        const slots = (MAIN_SUPPLY_LEVELS as readonly number[]).includes(level.level) ? 6 : 5;
        if ((level.initialSlots ?? 5) !== slots) throw new Error(`第${level.level}关工作槽数量应为${slots}`);
      }
      return catalog;
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`关卡JSON无效：${detail}`);
    }
  }
}

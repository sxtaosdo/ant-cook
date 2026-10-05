import { readFileSync } from 'node:fs';
import { parseDevelopmentLevelCatalog, type DevelopmentLevelCatalog } from '../../assets/Colony/scripts/application/levelCatalog.js';

let catalog: DevelopmentLevelCatalog | null = null;

export function developmentLevelCatalog(): DevelopmentLevelCatalog {
  if (!catalog) {
    const path = new URL('../../assets/Colony/config/development-levels.json', import.meta.url);
    catalog = parseDevelopmentLevelCatalog(JSON.parse(readFileSync(path, 'utf8')));
  }
  return catalog;
}

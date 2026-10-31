import { _decorator, EditBox } from 'cc';
import { ColonyProgressView } from './progressView';
import type { ProgressRow } from './progressModel';
const { ccclass, property } = _decorator;
/** The GM UI reuses the projection row without owning the isolated test session. */
@ccclass('ColonyGmView')
export class ColonyGmView extends ColonyProgressView {
  @property(EditBox) public levelSelector: EditBox | null = null;
  protected layoutIndex(): number { return 0; }
  protected actionFor(row: ProgressRow): string {
    if (!this.levelSelector) throw new Error('GM level selector binding is missing');
    return row.action === 'gm:level' ? `${row.action}:${this.levelSelector.string}` : row.action;
  }
}

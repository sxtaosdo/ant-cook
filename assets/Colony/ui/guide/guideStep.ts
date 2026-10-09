import { _decorator } from 'cc';
import mk from 'mk';
const { ccclass, property } = _decorator;
@ccclass('ColonyGuideStep')
export class ColonyGuideStep extends mk.GuideStepBase {
  @property public stepNum = 0;
  @property(mk.PolygonMask) public polygon: InstanceType<typeof mk.PolygonMask> | null = null;
  public activate: (() => void) | null = null;
  public ready = false;
  public failure: unknown = null;
  public load(): void {
    try { if (this.activate) { this.activate(); this.ready = true; } }
    catch (cause) { this.failure = cause; }
  }
  public unload(): void { this.activate = null; this.ready = false; }
}

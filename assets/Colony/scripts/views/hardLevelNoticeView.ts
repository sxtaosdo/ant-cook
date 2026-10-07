import { _decorator, Component, Label, Node } from 'cc';
const { ccclass, property } = _decorator;

/** Serialized entrance artwork; the PlayState owns timing and cancellation. */
@ccclass('ColonyHardLevelNoticeView')
export class ColonyHardLevelNoticeView extends Component {
  @property(Node) public ribbon: Node | null = null;
  @property(Label) public title: Label | null = null;
  protected onLoad(): void {
    if (!this.ribbon || !this.title) throw new Error('Hard level notice editor bindings are missing');
  }
}

import { _decorator, Label, Node } from 'cc';
import { ColonyPopupView } from '../../progress/script/popupView';

const { ccclass, property } = _decorator;

/** Fixed cards/mask/art come from the dedicated Creator prefab; this view only projects data. */
@ccclass('ColonySpeedView')
export class ColonySpeedView extends ColonyPopupView {
  @property(Label) public titleLabel: Label | null = null;
  @property(Label) public summaryLabel: Label | null = null;
  @property(Label) public durationLabel: Label | null = null;
  @property(Label) public remainingLabel: Label | null = null;
  @property(Label) public offerDetailLabel: Label | null = null;
  @property(Label) public actionLabel: Label | null = null;
  @property(Label) public feedbackLabel: Label | null = null;
  @property(Node) public actionButton: Node | null = null;
  @property(Node) public dismissButton: Node | null = null;

  public render(): void {
    const { page, feedback } = this._model;
    const offer = page.rows[0];
    if (page.layout !== 'speed' || !page.speed || page.rows.length !== 1 || offer?.action !== 'ad-speed'
      || !this.titleLabel || !this.summaryLabel || !this.durationLabel || !this.remainingLabel
      || !this.offerDetailLabel || !this.actionLabel || !this.feedbackLabel || !this.actionButton || !this.dismissButton) {
      throw new Error('Speed popup binding is missing');
    }
    this.titleLabel.string = page.title;
    this.summaryLabel.string = page.summary;
    this.durationLabel.string = page.speed.durationText;
    this.remainingLabel.string = page.speed.remainingText;
    this.offerDetailLabel.string = offer.detail;
    this.actionLabel.string = offer.button;
    this.feedbackLabel.string = feedback;
    this.feedbackLabel.node.active = Boolean(feedback);
    this.bind(this.actionButton, offer.enabled, () => this.event.emit('action', offer.action));
    this.bind(this.dismissButton, true, () => this.event.emit('close'));
  }
}

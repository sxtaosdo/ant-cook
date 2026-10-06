import { _decorator, Label, Node } from 'cc';
import { ColonyPopupView } from '../../progress/script/popupView';

const { ccclass, property } = _decorator;

@ccclass('ColonyConfirmView')
export class ColonyConfirmView extends ColonyPopupView {
  @property(Node) public panel: Node | null = null;
  @property(Label) public titleLabel: Label | null = null;
  @property(Label) public headingLabel: Label | null = null;
  @property(Label) public detailLabel: Label | null = null;
  @property(Label) public noticeLabel: Label | null = null;
  @property(Node) public closeButton: Node | null = null;
  @property(Node) public confirmButton: Node | null = null;
  @property(Node) public cancelButton: Node | null = null;
  @property(Label) public confirmLabel: Label | null = null;
  @property(Label) public cancelLabel: Label | null = null;

  public render(): void {
    const { page, feedback } = this._model;
    const [confirm, cancel] = page.rows;
    if (page.layout !== 'confirm' || !confirm || !cancel || !this.panel || !this.titleLabel || !this.headingLabel
      || !this.detailLabel || !this.noticeLabel || !this.closeButton || !this.confirmButton || !this.cancelButton
      || !this.confirmLabel || !this.cancelLabel) throw new Error('Confirmation popup binding is missing');
    this.titleLabel.string = page.title;
    this.headingLabel.string = confirm.title;
    this.detailLabel.string = confirm.detail;
    this.noticeLabel.node.active = Boolean(feedback);
    this.noticeLabel.string = feedback;
    this.confirmLabel.string = confirm.button;
    this.cancelLabel.string = cancel.button;
    this.bind(this.closeButton, true, () => this.event.emit('close'));
    this.bind(this.confirmButton, confirm.enabled, () => this.event.emit('action', confirm.action));
    this.bind(this.cancelButton, cancel.enabled, () => this.event.emit('action', cancel.action));
  }
}

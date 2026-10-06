import { _decorator } from 'cc';
import { ColonyPopupView } from '../../progress/script/popupView';
import { ColonySocialView } from './socialView';
const { ccclass, property } = _decorator;

@ccclass('ColonySocialPopupView')
export class ColonySocialPopupView extends ColonyPopupView {
  @property(ColonySocialView) public socialView: ColonySocialView | null = null;
  public close(): void { this.socialView?.cancelPending(); super.close(); }
  public render(): void {
    const { page, feedback } = this._model;
    if (!this.socialView || !page.social) throw new Error('Social popup content binding is missing');
    this.socialView.render(page.social, page.title, page.summary, feedback,
      value => this.event.emit('action', value), () => this.event.emit('close'), () => this.isAvailable());
  }
}

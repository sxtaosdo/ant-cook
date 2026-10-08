import mk from 'mk';
import { ColonyToastView } from '../../popups/toast/script/toastView';
import type { ColonySceneBootstrap } from '../bootstrap/colonySceneBootstrap';
import { ColonyUtil } from '../colonyUtil';
import { ToastQueue, type ToastMessage } from './toastQueue';

export class ToastPresentation {
  private revision = 0;
  private active: ColonyToastView | null = null;
  private closing: Promise<void> | null = null;
  private readonly closingOwners = new Set<ColonyToastView>();
  private loading: Promise<void> = Promise.resolve();
  private readonly queue = new ToastQueue((message, complete) => { void this.open(message, complete); }, () => {
    ++this.revision; this.release();
  });
  constructor(private readonly context: ColonySceneBootstrap) {}
  public show(text: string, type = 'feedback', object = ''): void {
    if (!this.context.destroyed && this.context.popupRoot?.isValid) this.queue.show({ text, type, object });
  }
  public clear(): void { this.queue.clear(); }
  /** Module exit must await loads and retained owners before unregistering the view. */
  public async flush(): Promise<void> { await this.loading; await this.drainClosing(); }
  private release(): void {
    const active = this.active; this.active = null;
    if (active) { active.cancel(); this.closingOwners.add(active); }
    void this.drainClosing().catch(cause => console.error('Toast close failed; owner retained', cause));
  }
  private drainClosing(): Promise<void> {
    if (this.closing) return this.closing;
    const task = (async (): Promise<void> => {
      for (const owner of this.closingOwners) {
        await mk.uiManage.close(owner);
        this.closingOwners.delete(owner);
      }
    })();
    this.closing = task;
    const finished = (): void => { if (this.closing === task) this.closing = null; };
    void task.then(finished, finished);
    return task;
  }
  private async open(message: ToastMessage, complete: () => void): Promise<void> {
    const revision = ++this.revision, generation = this.context.generation;
    const current = (): boolean => revision === this.revision && generation === this.context.generation && !this.context.destroyed;
    const previous = this.loading;
    let releaseLoad!: () => void;
    this.loading = new Promise<void>(resolve => { releaseLoad = resolve; });
    try {
      await previous;
      await this.drainClosing();
      if (!current()) return;
      const opened = await mk.uiManage.open(ColonyToastView, { parent: this.context.popupRoot! });
      if (!(opened instanceof ColonyToastView)) throw new Error('Toast could not be opened');
      if (!current()) {
        opened.cancel(); this.closingOwners.add(opened); await this.drainClosing(); return;
      }
      this.active = opened;
      ColonyUtil.applyUiLayer(opened.node);
      opened.animate(message.text, () => {
        if (!current() || this.active !== opened) return;
        this.release(); complete();
      });
    } catch (cause) {
      console.error('Toast unavailable; failed close owners retained', cause);
      if (current()) { this.release(); complete(); }
    }
    finally { releaseLoad(); }
  }
}

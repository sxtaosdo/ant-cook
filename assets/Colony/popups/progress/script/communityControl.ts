import type { Node } from 'cc';
import mk from 'mk';
import { ProgressControl, type ProgressNavigation, type ProgressViewType } from './progressControl';
import { ColonyCommunityView } from './communityView';
import { ColonyLeaderboardView } from '../../leaderboard/script/leaderboardView';
import { ColonySocialPopupView } from '../../social/script/socialPopupView';
import { swallowMkInterrupt } from '../../resultPopupNav';

class CommunityShellControl extends ProgressControl {
  public contentParent(): Node { return (this._view as unknown as ColonyCommunityView).contentParent(); }
  public state(loading: boolean, failure = ''): void { (this._view as unknown as ColonyCommunityView)?.setContentState(loading, failure); }
  public feedback(value: string): void { if (this._model && !this.isClosing) { this._model.feedback = value; this._view?.render(); } }
}

/** One feature owns its shell and one lazily registered content page; no new UI framework. */
export class CommunityControl {
  public readonly viewType = ColonyCommunityView;
  private readonly shell: CommunityShellControl;
  private child: ProgressControl | null = null;
  private registered: ProgressViewType | null = null;
  private owner: Node | null = null;
  private desired: ProgressViewType | null = null;
  private revision = 0;
  private syncing: Promise<void> | null = null;
  private closing: Promise<void> | null = null;
  private closeRequested = false;
  private closed = false;
  private notified = false;
  private actionBusy = false;
  private failure = '';

  public constructor(parent: Node, private readonly navigation: ProgressNavigation) {
    this.shell = new CommunityShellControl(parent, { read: () => navigation.read(), act: action => this.act(action), closed: () => {} }, ColonyCommunityView);
  }
  public get model(): ProgressControl['model'] { return this.shell.model; }
  public get isClosing(): boolean { return this.closeRequested; }
  public async whenOpened(): Promise<void> { await this.shell.whenOpened(); if (!this.closeRequested) this.refresh(); }

  public refresh(): void {
    if (this.closeRequested) return;
    this.shell.refresh();
    const type = this.navigation.read().layout === 'social' ? ColonySocialPopupView : ColonyLeaderboardView;
    if (type !== this.desired) {
      this.desired = type; ++this.revision; this.failure = '';
      this.child?.suspend(); this.shell.state(true);
    }
    if (this.child && this.registered === type && !this.child.isClosing && !this.syncing) {
      this.child.refresh(); this.shell.state(false); return;
    }
    if (!this.syncing && !this.failure) {
      this.syncing = this.sync().finally(() => { this.syncing = null; });
    }
  }

  public async act(action: string): Promise<string | void> {
    if (action === 'community-close') {
      if (this.navigation.canClose?.() === false) { this.shell.feedback('奖励仍待保存，请先重试原奖励'); return; }
      await this.forceClose(); return;
    }
    if (this.closeRequested || this.actionBusy) return;
    if (action === 'community-retry') {
      this.failure = ''; ++this.revision; this.desired = null; this.refresh(); return;
    }
    this.actionBusy = true;
    try {
      const feedback = await this.navigation.act(action);
      if (!this.closeRequested) { this.shell.feedback(feedback ?? ''); this.refresh(); }
      return feedback;
    } finally { this.actionBusy = false; }
  }

  public async navigateToShop(): Promise<void> {
    try { await this.whenOpened(); } catch { return; }
    if (!this.isClosing) await this.act('section:shop');
  }

  private async sync(): Promise<void> {
    // Startup reporting and partial shell cleanup belong to the top-level owner.
    try { await this.shell.whenOpened(); } catch { return; }
    while (!this.closeRequested && this.desired) {
      const revision = this.revision, type = this.desired;
      try {
        await this.cleanupChild();
        if (revision !== this.revision || this.closeRequested) continue;
        const parent = this.shell.contentParent();
        this.owner = parent; this.registered = type;
        const source = type === ColonyLeaderboardView ? 'popups/leaderboard/prefab/leaderboardContent' : 'popups/social/prefab/socialContent';
        await mk.uiManage.regis(type, source, parent, { parent, loadConfig: { bundleStr: 'Colony' }, poolInitFillNum: 0, poolMinHoldNum: 0, poolMaxHoldNum: 0 });
        if (revision !== this.revision || this.closeRequested) continue;
        const page = this.navigation.read();
        const child = new ProgressControl(parent, {
          read: () => revision === this.revision && !this.closeRequested ? this.navigation.read() : page,
          act: action => revision === this.revision && !this.closeRequested ? this.act(action) : '',
          closed: () => {},
        }, type);
        this.child = child;
        await child.whenOpened();
        if (revision !== this.revision || this.closeRequested) { child.suspend(); continue; }
        this.shell.state(false); return;
      } catch (cause) {
        let cleanupFailed = false;
        try { await this.cleanupChild(); }
        catch (cleanup) { cleanupFailed = true; cause = new Error(`页面清理未完成，请重试关闭：${String(cleanup)}`); }
        // A superseded page's failed IO belongs to that request, not the selected tab.
        if (!cleanupFailed && revision !== this.revision && !this.closeRequested) continue;
        this.failure = cause instanceof Error ? cause.message : String(cause);
        if (!this.shell.isClosing) this.shell.state(false, this.failure);
        return;
      }
    }
  }
  private async cleanupChild(): Promise<void> {
    if (this.child) { this.child.suspend(); await swallowMkInterrupt(Promise.resolve(this.child.close())); this.child = null; }
    if (this.registered) { await mk.uiManage.unregis(this.registered, this.owner); this.registered = null; this.owner = null; }
  }
  public close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closeRequested = true; ++this.revision; this.child?.suspend();
    if (!this.closing) this.closing = Promise.resolve().then(async () => {
      await this.syncing;
      await this.cleanupChild();
      await swallowMkInterrupt(Promise.resolve(this.shell.close()));
      this.closed = true;
    }).catch(cause => { this.closing = null; this.shell.state(false, `页面清理未完成，请重试关闭：${String(cause)}`); throw cause; });
    return this.closing;
  }
  public async forceClose(): Promise<void> {
    this.navigation.closing?.(); await this.close();
    if (!this.notified) { this.notified = true; this.navigation.closed(); }
  }
}

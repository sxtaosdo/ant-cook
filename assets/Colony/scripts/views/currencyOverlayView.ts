import { _decorator, Button, Label, Node, sys, tween, Tween, UITransform, Vec3, view, Widget } from 'cc';
import mk from 'mk';
import { ColonyProgressView } from '../../popups/progress/script/progressView';
import { ColonyCommunityView } from '../../popups/progress/script/communityView';
import { ColonySettingsView } from '../../popups/settings/script/settingsView';
import { ColonyConfirmView } from '../../popups/confirm/script/confirmView';
import { ColonyShopView } from '../../popups/shop/script/shopView';
import { ColonySpeedView } from '../../popups/speed/script/speedView';
import { ColonyToolView } from '../../popups/tool/script/toolView';
import { ColonyResultSuccessView } from '../../popups/resultSuccess/script/resultSuccessView';
import { ColonyResultFailView } from '../../popups/resultFail/script/resultFailView';

const { ccclass, property } = _decorator;
const businessViews = [ColonyCommunityView, ColonySettingsView, ColonyConfirmView, ColonyShopView, ColonySpeedView,
  ColonyToolView, ColonyResultSuccessView, ColonyResultFailView];

/** Ant-owned projection of the actual MK popup stack and the current Ant wallet. */
@ccclass('ColonyCurrencyOverlayView')
export class ColonyCurrencyOverlayView extends mk.StaticViewBase {
  @property(Node) public bars: Node | null = null;
  @property(Label) public coins: Label | null = null;
  @property(Label) public diamonds: Label | null = null;
  @property(Button) public diamondButton: Button | null = null;
  @property(Button) public plusButton: Button | null = null;
  @property(Node) public profileStrip: Node | null = null;
  @property(Label) public nicknameLabel: Label | null = null;
  @property(Label) public versionLabel: Label | null = null;
  private popupOwner: Node | null = null;
  private readWallet: (() => { coins: number; diamonds: number } | null) | null = null;
  private coverPageProfiles: ((covered: boolean) => void) | null = null;
  private readonly switchHolds = new Set<object>();
  private restingPosition: Vec3 | null = null;
  private displayWanted = false;
  private animationEpoch = 0;

  public bind(owner: Node, readWallet: () => { coins: number; diamonds: number } | null, onShop: () => void,
    coverPageProfiles?: (covered: boolean) => void): void {
    if (!this.bars || !this.coins || !this.diamonds || !this.diamondButton || !this.plusButton) throw new Error('Currency overlay bindings are missing');
    this.popupOwner = owner; this.readWallet = readWallet;
    this.coverPageProfiles = coverPageProfiles ?? null;
    for (const button of [this.diamondButton, this.plusButton]) {
      button.node.targetOff(this); button.node.on(Button.EventType.CLICK, onShop, this);
    }
    Tween.stopAllByTarget(this.bars);
    this.displayWanted = false;
    this.fitSafeArea();
    view.off('canvas-resize', this.fitSafeArea, this);
    view.on('canvas-resize', this.fitSafeArea, this);
    this.bars.active = false;
    this.profileStrip!.active = false;
    this.coverPageProfiles?.(false);
  }

  /** Saved Widgets own screen placement; code only supplies the device's safe-area inset. */
  private fitSafeArea(): void {
    const screenWidget = this.node.getComponent(Widget);
    const transform = this.node.getComponent(UITransform);
    const barsWidget = this.bars?.getComponent(Widget);
    const profileWidget = this.profileStrip?.getComponent(Widget);
    if (!screenWidget || !transform || !barsWidget || !profileWidget) throw new Error('Currency overlay layout bindings are missing');
    screenWidget.updateAlignment();
    const top = transform.convertToWorldSpaceAR(new Vec3(0, transform.height * (1 - transform.anchorY), 0)).y;
    const safeArea = sys.getSafeAreaRect(false);
    const origin = transform.convertToNodeSpaceAR(new Vec3(0, top, 0));
    const safe = transform.convertToNodeSpaceAR(new Vec3(0, Math.min(top, safeArea.y + safeArea.height), 0));
    barsWidget.top = Math.max(0, origin.y - safe.y);
    Tween.stopAllByTarget(this.bars!);
    this.animationEpoch++;
    barsWidget.enabled = true;
    barsWidget.updateAlignment();
    this.restingPosition = this.bars!.position.clone();
    profileWidget.top = barsWidget.top + this.bars!.getComponent(UITransform)!.height * Math.abs(this.bars!.scale.y) + 8;
    profileWidget.updateAlignment();
    this.bars!.active = this.displayWanted;
    this.profileStrip!.active = this.displayWanted;
  }

  public hasBusinessPopup(): boolean {
    const owner = this.popupOwner;
    if (!owner?.isValid) return false;
    return mk.uiManage.get().some(view => {
      let node: Node | null = view.node;
      while (node && node !== owner) node = node.parent;
      if (!node) return false;
      if (view instanceof ColonyProgressView) return view.countsAsBusinessPopup();
      return businessViews.some(type => view instanceof type);
    });
  }

  public setProfile(nickname: string, version: string): void {
    if (!this.nicknameLabel || !this.versionLabel) throw new Error('Popup profile strip bindings are missing');
    this.nicknameLabel.string = nickname; this.versionLabel.string = `v${version}`;
  }

  /** Only an already-open business popup can retain its display across a routed replacement. */
  public holdDuringSwitch(): () => void {
    const token = {};
    if (this.hasBusinessPopup()) this.switchHolds.add(token);
    return () => { this.switchHolds.delete(token); };
  }

  protected lateUpdate(): void {
    if (!this.bars || !this.readWallet) return;
    const wallet = this.readWallet();
    const visible = Boolean(wallet && (this.hasBusinessPopup() || this.switchHolds.size));
    if (visible !== this.displayWanted) {
      this.displayWanted = visible;
      const epoch = ++this.animationEpoch;
      Tween.stopAllByTarget(this.bars);
      const end = this.restingPosition!;
      const barsWidget = this.bars.getComponent(Widget)!;
      // Keep rendering through retraction; stale completion cannot hide a reopened popup.
      barsWidget.enabled = false;
      if (visible) {
        if (!this.bars.active) this.bars.setPosition(end.x, end.y + 100, end.z);
        this.bars.active = true;
        tween(this.bars).to(0.32, { position: end.clone() }, { easing: 'quadOut' })
          .call(() => { if (epoch === this.animationEpoch && barsWidget.isValid) barsWidget.enabled = true; }).start();
      } else {
        tween(this.bars).to(0.32, { position: new Vec3(end.x, end.y + 100, end.z) }, { easing: 'quadIn' })
          .call(() => {
            if (epoch !== this.animationEpoch || !this.bars?.isValid) return;
            this.bars.active = false; this.bars.setPosition(end);
            if (barsWidget.isValid) barsWidget.enabled = true;
            if (this.profileStrip) this.profileStrip.active = false;
          }).start();
      }
      for (const button of [this.diamondButton, this.plusButton]) if (button) button.interactable = visible;
    }
    if (this.profileStrip) this.profileStrip.active = this.bars.active;
    // The page's pair stays hidden until the foreground strip finishes retracting.
    this.coverPageProfiles?.(Boolean(this.profileStrip?.active));
    if (!this.bars.active || !wallet) return;
    if (this.coins!.string !== String(wallet.coins)) this.coins!.string = String(wallet.coins);
    if (this.diamonds!.string !== String(wallet.diamonds)) this.diamonds!.string = String(wallet.diamonds);
  }

  protected onDestroy(): void {
    this.animationEpoch++;
    view.off('canvas-resize', this.fitSafeArea, this);
    if (this.bars?.isValid) Tween.stopAllByTarget(this.bars);
    this.readWallet = null; this.popupOwner = null; this.switchHolds.clear();
    this.coverPageProfiles?.(false); this.coverPageProfiles = null;
    for (const button of [this.diamondButton, this.plusButton]) if (button?.node?.isValid) button.node.targetOff(this);
  }
}

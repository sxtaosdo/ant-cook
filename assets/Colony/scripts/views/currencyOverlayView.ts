import { _decorator, Button, Label, Node } from 'cc';
import mk from 'mk';
import { ColonyProgressView } from '../../popups/progress/script/progressView';
import { ColonyCommunityView } from '../../popups/progress/script/communityView';
import { ColonySettingsView } from '../../popups/settings/script/settingsView';
import { ColonyConfirmView } from '../../popups/confirm/script/confirmView';
import { ColonyShopView } from '../../popups/shop/script/shopView';
import { ColonyToolView } from '../../popups/tool/script/toolView';
import { ColonyResultSuccessView } from '../../popups/resultSuccess/script/resultSuccessView';
import { ColonyResultFailView } from '../../popups/resultFail/script/resultFailView';

const { ccclass, property } = _decorator;
const businessViews = [ColonyCommunityView, ColonySettingsView, ColonyConfirmView, ColonyShopView,
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
  private readonly switchHolds = new Set<object>();

  public bind(owner: Node, readWallet: () => { coins: number; diamonds: number } | null, onShop: () => void): void {
    if (!this.bars || !this.coins || !this.diamonds || !this.diamondButton || !this.plusButton) throw new Error('Currency overlay bindings are missing');
    this.popupOwner = owner; this.readWallet = readWallet;
    for (const button of [this.diamondButton, this.plusButton]) {
      button.node.targetOff(this); button.node.on(Button.EventType.CLICK, onShop, this);
    }
    this.bars.active = false;
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
    this.bars.active = Boolean(wallet && (this.hasBusinessPopup() || this.switchHolds.size));
    if (this.profileStrip) this.profileStrip.active = this.bars.active;
    if (!this.bars.active || !wallet) return;
    if (this.coins!.string !== String(wallet.coins)) this.coins!.string = String(wallet.coins);
    if (this.diamonds!.string !== String(wallet.diamonds)) this.diamonds!.string = String(wallet.diamonds);
  }

  protected onDestroy(): void {
    this.readWallet = null; this.popupOwner = null; this.switchHolds.clear();
    for (const button of [this.diamondButton, this.plusButton]) if (button?.node.isValid) button.node.targetOff(this);
  }
}

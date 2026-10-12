import { _decorator, Button, Color, instantiate, Label, Node, Prefab, Sprite, SpriteFrame, sys, UITransform, Vec3, view, Widget } from 'cc';
import mk from 'mk';
import { LevelRailView } from './levelRailView';
import type { ThemeBasketProgress } from '../application/playerProgress';
import { ColonyGmButtonView } from './gmButtonView';

const { ccclass, property } = _decorator;

@ccclass('ColonyHudView')
/** 对局 HUD：关卡文案、反馈与搬运倍速。 */
export class ColonyHudView extends mk.StaticViewBase {
  private readonly iconItems = new Map<Node, string>();
  private railRemaining = 0;
  private boardTotal = 0;
  private railView: LevelRailView | null = null;
  private railRequest = 0;
  private readonly railOriginalPositions = new Map<string, number>();
  private readonly railOriginalHorizontal = new Map<string, number>();
  private feedbackColor: Color | null = null;
  private readonly boundNodes = new Set<Node>();
  @property(Node) private topBarRoot: Node | null = null;
  @property(Node) private levelRailMount: Node | null = null;
  @property(Button) private settingsButton: Button | null = null;
  @property(Button) private leaderboardButton: Button | null = null;
  @property(Label) private coinLabel: Label | null = null;
  @property(Label) private diamondLabel: Label | null = null;
  @property(Label) private nicknameLabel: Label | null = null;
  @property(Label) private buildVersionLabel: Label | null = null;
  @property(Label) private speedText: Label | null = null;
  @property(Label) private speedTime: Label | null = null;
  @property(Node) private speedTimePlate: Node | null = null;
  @property(ColonyGmButtonView) private gmButton: ColonyGmButtonView | null = null;
  @property(Button)
  private speedButton: Button | null = null;

  @property(Label)
  private levelLabel: Label | null = null;

  @property(Label)
  private feedbackLabel: Label | null = null;

  protected onLoad(): void {
    if (!this.speedButton || !this.levelLabel || !this.feedbackLabel || !this.topBarRoot || !this.levelRailMount
      || !this.settingsButton || !this.leaderboardButton || !this.coinLabel || !this.diamondLabel
      || !this.speedText || !this.speedTime || !this.speedTimePlate || !this.gmButton) {
      throw new Error('HUD Prefab is missing required editor bindings');
    }
    this.feedbackColor = this.feedbackLabel.color.clone();
    view.on('canvas-resize', this.fitSafeArea, this);
  }

  /** 绑定倍速及功能入口。 */
  public bind(onSpeed: () => void, onSettings?: () => void, onLeaderboard?: () => void, onGm?: () => void, gmAvailable = false): void {
    const speedButton = this.requireSpeedButton();
    for (const node of this.boundNodes) if (node.isValid) node.targetOff(this);
    this.boundNodes.clear();
    this.boundNodes.add(speedButton.node);
    speedButton.node.targetOff(this);
    speedButton.node.on(Button.EventType.CLICK, onSpeed, this);
    for (const [button, action] of [[this.settingsButton, onSettings], [this.leaderboardButton, onLeaderboard]] as const) {
      const node = button!.node;
      this.boundNodes.add(node);
      node.targetOff(this);
      if (action) node.on(Button.EventType.CLICK, action, this);
    }
    this.gmButton!.bind(gmAvailable, () => onGm?.());
  }
  public setSpeedBoost(multiplier: 1 | 2 | 3, remainingMs: number, source: 'manual' | 'freeFinish' = 'manual'): void {
    const text = this.speedText!;
    const time = this.speedTime!;
    const timed = multiplier > 1 && source === 'manual';
    const seconds = Math.ceil(Math.max(0, remainingMs) / 1000);
    const caption = timed ? `${Math.floor(seconds / 60)}m:${(seconds % 60).toString().padStart(2, '0')}s` : '';
    if (text.string !== `${multiplier}×`) text.string = `${multiplier}×`;
    if (time.string !== caption) time.string = caption;
    this.speedTimePlate!.active = timed;
  }

  /** 更新关卡标题。 */
  public setLevel(level: number): void {
    if (!this.levelLabel) throw new Error('HUD Prefab is missing the LevelLabel binding');
    this.levelLabel.string = `第 ${level} 关`;
  }
  public setDifficulty(hard: boolean): void {
    const badge = this.node.getChildByName('DifficultyBadge')!;
    badge.active = hard;
  }

  /** 更新操作反馈文案。 */
  public setFeedback(message: string): void {
    if (!this.feedbackLabel) throw new Error('HUD Prefab is missing the FeedbackLabel binding');
    this.feedbackLabel.string = message;
  }

  public setResources(coins: number, diamonds: number): void {
    this.diamondLabel!.string = String(diamonds);
    this.coinLabel!.string = String(coins);
  }

  public setProfile(nickname: string, version: string): void {
    if (!this.nicknameLabel || !this.buildVersionLabel) throw new Error('HUD profile bindings are missing');
    this.nicknameLabel.string = nickname;
    this.buildVersionLabel.string = `v${version}`;
  }
  public setProfileVisible(visible: boolean): void {
    if (this.nicknameLabel?.node?.isValid) this.nicknameLabel.node.active = visible;
    if (this.buildVersionLabel?.node?.isValid) this.buildVersionLabel.node.active = visible;
  }

  /** Main levels are a read-only horizontal track; progress changes only after cargo clears. */
  public async showLevelRail(level: number, itemName: string, themeId: string, initial: number, remaining: number, isCurrent: () => boolean = () => true, single = false): Promise<void> {
    const request = ++this.railRequest;
    this.boardTotal = initial;
    this.railRemaining = remaining;
    const count = this.node.getChildByName('BoardCount')?.getComponent(Label);
    if (count) count.string = `${initial - remaining} / ${initial}`;
    try {
      if (!this.railView) {
        const prefab = await mk.asset.get('db://assets/Colony/ui/levelRail.prefab', Prefab, this.node);
        if (!prefab) throw new Error('LevelRail Prefab could not be loaded');
        if (request !== this.railRequest || !this.node.isValid || !isCurrent()) return;
        const node = instantiate(prefab);
        node.parent = this.levelRailMount!;
        node.setPosition(0, 0, 0);
        node.setSiblingIndex(0);
        this.railView = new LevelRailView(node);
      }
      if (request !== this.railRequest || !this.node.isValid || !isCurrent()) return;
      this.railView.render(level, itemName, themeId, initial, this.railRemaining, single);
      this.setRailLayout(true);
      this.levelLabel!.node.active = false;
    } catch (error) {
      if (request !== this.railRequest || !isCurrent()) return;
      console.error('LevelRail unavailable:', error);
      this.hideLevelRail();
    }
  }

  public progressEndpoint(): Vec3 | null { return this.railView?.endpoint() ?? null; }
  public progressTarget(): Node | null { return this.railView?.target ?? null; }
  public hideRailBackground(): void { this.railView?.setBackground(false); }
  public waitForProgress(): Promise<void> { return this.railView?.waitForProgress() ?? Promise.resolve(); }

  public updateLevelRail(remaining: number): void {
    this.railRemaining = remaining;
    this.railView?.update(remaining);
    const count = this.node.getChildByName('BoardCount')?.getComponent(Label);
    if (count && this.boardTotal > 0) count.string = `${this.boardTotal - remaining} / ${this.boardTotal}`;
  }

  public setDailyChallenge(initial: number, remaining: number): void {
    this.boardTotal = initial;
    this.node.getChildByName('BoardCount')!.active = false;
    this.levelLabel!.node.active = false;
    this.updateLevelRail(remaining);
  }

  public hideLevelRail(): void {
    this.railRequest += 1;
    this.railView?.dispose();
    this.railView = null;
    if (this.levelLabel) this.levelLabel.node.active = true;
    this.setRailLayout(false);
  }

  /** 首关 HUD 让出棋盘上缘，目标信息留在棋盘框内。 */
  public setFirstLevelSkin(enabled: boolean, level = 1): void {
    const move = (name: string, x: number, y: number): void => {
      this.node.getChildByName(name)?.setPosition(x, y, 0);
    };
    if (enabled) {
      move('HeaderPlaque', -65, 32);
      this.levelLabel!.node.active = false;
      this.levelLabel!.string = `第 ${level} 关`;
      move('LevelLabel', -100, 47);
      this.levelLabel!.node.getComponent(UITransform)!.setContentSize(130, 36);
      move('HeaderSubtitle', -65, 15);
      move('ThemeTargetIcon', -10, 47);
      this.node.getChildByName('ThemeTargetIcon')!.getComponent(UITransform)!.setContentSize(48, 48);
      move('FeedbackLabel', -150, -170);
      for (const name of ['HeaderPlaque', 'HeaderSubtitle', 'ThemeTargetIcon']) this.node.getChildByName(name)!.active = false;
      for (const name of ['BoardTitle', 'BoardCount']) this.node.getChildByName(name)!.active = false;
      this.feedbackLabel!.color = new Color(95, 58, 31);
      this.node.getChildByName('FeedbackPill')!.active = false;
      for (const name of ['BasketIcon0', 'BasketIcon1', 'BasketIcon2', 'BasketIcon3', 'BasketProgressLabel']) {
        this.node.getChildByName(name)!.active = false;
      }
    } else {
      move('HeaderPlaque', -5, 32);
      this.node.getChildByName('ThemeTargetIcon')!.getComponent(UITransform)!.setContentSize(90, 90);
      for (const name of ['HeaderSubtitle', 'BoardTitle', 'BoardCount']) this.node.getChildByName(name)!.active = false;
      this.feedbackLabel!.color = this.feedbackColor ?? Color.WHITE;
      this.node.getChildByName('FeedbackPill')!.active = true;
    }
  }

  private setRailLayout(visible: boolean): void {
    for (const name of ['LevelLabel', 'ThemeTargetIcon', 'FeedbackLabel', 'FeedbackPill', 'BasketIcon0', 'BasketIcon1', 'BasketIcon2', 'BasketIcon3', 'BasketProgressLabel']) {
      const node = this.node.getChildByName(name);
      if (!node) continue;
      const widget = node.getComponent(Widget);
      if (widget) widget.enabled = false;
      if (!this.railOriginalPositions.has(name)) this.railOriginalPositions.set(name, node.position.y);
      if (!this.railOriginalHorizontal.has(name)) this.railOriginalHorizontal.set(name, node.position.x);
      const feedback = name === 'FeedbackLabel' || name === 'FeedbackPill';
      const shift = name.startsWith('Basket') ? 65 : feedback ? 235 : 100;
      node.setPosition(this.railOriginalHorizontal.get(name)! - (visible && feedback ? 60 : 0), this.railOriginalPositions.get(name)! - (visible ? shift : 0), 0);
    }
  }

  /** Fixed Prefab geometry stays intact; only the platform safe top can offset the header. */
  public fitSafeArea(): void {
    if (!this.topBarRoot?.isValid) return;
    const transform = this.topBarRoot.getComponent(UITransform)!;
    this.topBarRoot.setPosition(0, 0, 0);
    const top = transform.convertToWorldSpaceAR(new Vec3(0, transform.height * (1 - transform.anchorY), 0)).y;
    const area = sys.getSafeAreaRect(false);
    const worldOffset = Math.min(0, area.y + area.height - top);
    const parent = this.topBarRoot.parent!.getComponent(UITransform)!;
    const origin = parent.convertToNodeSpaceAR(new Vec3(0, top, 0));
    const safe = parent.convertToNodeSpaceAR(new Vec3(0, top + worldOffset, 0));
    this.topBarRoot.setPosition(safe.x - origin.x, safe.y - origin.y, 0);
    this.gmButton?.clampToSafeArea();
  }

  /** Show the collection target, produce counts and total stall progress. */
  public setTheme(level: number, itemName: string, itemId: string, items: ThemeBasketProgress['items']): void {
    this.levelLabel!.string = `第 ${level} 关 · ${itemName}`;
    const boardTitle = this.node.getChildByName('BoardTitle')?.getComponent(Label);
    if (boardTitle) boardTitle.string = level === 1 ? '水果摊补给' : `收集${itemName}`;
    const subtitle = this.node.getChildByName('HeaderSubtitle')?.getComponent(Label);
    if (subtitle) subtitle.string = level === 1 ? '芒果补给' : itemName;
    const produce = items.filter(item => item.kind === 'produce');
    const visible = [items.find(item => item.id === itemId)!, ...produce];
    const nodes = [this.node.getChildByName('ThemeTargetIcon'), ...produce.map((_, index) => this.node.getChildByName(`BasketIcon${index}`))];
    nodes.forEach((node, index) => {
      if (!node) return;
      node.active = index > 0;
      const item = visible[index]!;
      const id = item.id;
      this.iconItems.set(node, id);
      const sprite = node.getComponent(Sprite)!;
      sprite.color = new Color(255, 255, 255, index === 0 || item.count > 0 ? 255 : 100);
      void mk.asset.get(`db://${item.iconPath}`, SpriteFrame, this.node)
        .then(frame => {
          if (frame && node.isValid && this.iconItems.get(node) === id) sprite.spriteFrame = frame;
        });
    });
    const counts = this.node.getChildByName('BasketProgressLabel');
    if (counts) {
      counts.active = true;
      counts.getComponent(UITransform)!.setContentSize(560, 64);
      counts.getComponent(Label)!.string = `${produce.map(item => `${item.count}/${item.target}`).join('       ')}\n摊位收集 ${items.reduce((sum, item) => sum + item.count, 0)}/${items.reduce((sum, item) => sum + item.target, 0)} 件`;
    }
  }

  /** Show the latest collected items; the stall page displays the complete collection. */
  public setThemeCollected(items: readonly { frame: SpriteFrame; count: number }[] | null): void {
    const positions = [-180, -60, 60, 180];
    const collected = items?.filter(item => item.count > 0).slice(-4);
    for (let index = 0; index < 4; index += 1) {
      const node = this.node.getChildByName(`ThemeCollectible${index + 1}`);
      if (!node) throw new Error(`HUD Prefab is missing ThemeCollectible${index + 1}`);
      const item = collected?.[index];
      node.getComponent(UITransform)!.setContentSize(90, 90);
      node.setPosition(positions[index]!, -610, 0);
      const sprite = node.getComponent(Sprite)!;
      sprite.sizeMode = Sprite.SizeMode.CUSTOM;
      sprite.spriteFrame = item?.frame ?? null;
      node.setSiblingIndex(this.node.children.length - 1);
      node.active = Boolean(item && item.count > 0);
    }
  }

  public clearTheme(): void {
    for (const name of ['ThemeTargetIcon', 'BasketIcon0', 'BasketIcon1', 'BasketIcon2', 'BasketIcon3']) {
      const node = this.node.getChildByName(name);
      if (node) node.active = false;
    }
    const counts = this.node.getChildByName('BasketProgressLabel');
    if (counts) counts.active = false;
    this.setThemeCollected(null);
    this.iconItems.clear();
  }

  protected onDestroy(): void {
    this.railRequest += 1;
    this.railView?.dispose();
    this.railView = null;
    view.off('canvas-resize', this.fitSafeArea, this);
    for (const node of this.boundNodes) if (node.isValid) node.targetOff(this);
    this.boundNodes.clear();
  }

  private requireSpeedButton(): Button {
    if (!this.speedButton) throw new Error('HUD Prefab is missing the SpeedButton binding');
    return this.speedButton;
  }
}

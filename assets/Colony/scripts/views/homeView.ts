import { _decorator, Button, Label } from 'cc';
import mk from 'mk';
import type { PlayerProgress } from '../application/playerProgress';
import { StageTargetSelector } from '../application/stageTargetSelector';

const { ccclass, property } = _decorator;

@ccclass('ColonyHomeView')
/** 首页 Prefab：开始按钮与显隐。 */
export class ColonyHomeView extends mk.StaticViewBase {
  @property(Label) private nicknameLabel: Label | null = null;
  @property(Label) private buildVersionLabel: Label | null = null;
  @property(Label) private stageTargetLabel: Label | null = null;
  @property(Button) private stageTargetButton: Button | null = null;
  @property(Label) private trackedObjectLabel: Label | null = null;
  @property(Button) private trackedObjectButton: Button | null = null;

  public setProfile(nickname: string, version: string): void {
    if (!this.nicknameLabel || !this.buildVersionLabel) throw new Error('Home profile bindings are missing');
    this.nicknameLabel.string = nickname;
    this.buildVersionLabel.string = `v${version}`;
  }
  public tutorial: string | null = null;
  @property(Button)
  private startButton: Button | null = null;

  protected onLoad(): void {
    this.requireStartButton();
  }

  /** 绑定开始按钮回调。 */
  public bind(onStart: () => void, onOpen?: (section: 'market' | 'tasks' | 'collection' | 'events' | 'shop' | 'settings' | 'leaderboard' | 'social' | 'stages' | 'tracked-object') => void): void {
    const startButton = this.requireStartButton();
    startButton.node.targetOff(this);
    startButton.node.on(Button.EventType.CLICK, onStart, this);
    if (!this.stageTargetButton) throw new Error('Home stage target button binding is missing');
    this.stageTargetButton.node.targetOff(this);
    this.stageTargetButton.node.on(Button.EventType.CLICK, () => onOpen?.('stages'), this);
    if (!this.trackedObjectButton) throw new Error('Home collection target button binding is missing');
    this.trackedObjectButton.node.targetOff(this);
    this.trackedObjectButton.node.on(Button.EventType.CLICK, () => onOpen?.('tracked-object'), this);
    for (const [name, section] of [['NightMarketButton', 'market'], ['DailyButton', 'tasks'], ['CollectionButton', 'collection'], ['EventsButton', 'events'], ['ShopButton', 'shop'], ['SettingsButton', 'settings'], ['LeaderboardButton', 'leaderboard']] as const) {
      const node = this.node.getChildByName(name);
      node?.targetOff(this);
      node?.on(Button.EventType.CLICK, () => onOpen?.(section), this);
    }
  }

  public refresh(progress: PlayerProgress): void {
    const s = progress.snapshot();
    if (!this.stageTargetLabel) throw new Error('Home stage target label binding is missing');
    const stage = StageTargetSelector.select(s);
    this.stageTargetLabel.string = `${stage.title}\n${stage.rewardText} · 查看领取记录`;
    if (!this.trackedObjectLabel) throw new Error('Home collection target label binding is missing');
    const tracked = progress.trackedObject();
    this.trackedObjectLabel.string = tracked ? `关注：${tracked.item.name} ${tracked.count}/${tracked.item.target}${tracked.complete ? ' · 已完成' : ''} · 查看` : '选择一个收集目标 · 查看清单';
    const unlock = progress.availability();
    const socialButton = this.node.getChildByName('SocialButton');
    if (socialButton) {
      socialButton.active = false;
    }
    const notice = this.node.getChildByName('LeaderboardButton')?.getChildByName('Notice');
    if (notice) notice.active = progress.socialAvailable() && progress.readSocial().unread > 0;
    const names = { NightMarketButton: true, DailyButton: true, CollectionButton: unlock.collection, EventsButton: unlock.events };
    for (const [name, visible] of Object.entries(names)) {
      const node = this.node.getChildByName(name);
      if (node) node.active = visible;
    }
    const currency = this.node.getChildByName('HomeCurrencyLabel')?.getComponent(Label);
    const level = this.node.getChildByName('HomeLevelLabel')?.getComponent(Label);
    if (currency) currency.string = `金币 ${s.coins}     钻石 ${s.diamonds}`;
    if (level) level.string = s.clearedLevels.length === 60 ? '本期收集完成' : `第 ${progress.nextLevel()} 关`;
    const tips = { construction: '摊位收集完成！去看看蚂蚁搬回来的成果', daily: '日常开放：累计签到，不需要连续登录', orders: '每日订单开放：三项可以同时完成', challenge: '每日挑战开放：免费无限重试', collection: '收藏开放：用印章兑换指定收藏', events: '免费夜市季和周末补给节开放' };
    const subtitle = this.node.getChildByName('HomeSubtitleLabel')?.getComponent(Label);
    if (subtitle) subtitle.string = this.tutorial ? tips[this.tutorial as keyof typeof tips] : '通关收集物品，一件件摆满自己的摊位';
  }

  /** 显示或隐藏首页。 */
  public setVisible(visible: boolean): void {
    this.node.active = visible;
  }

  public setFeedback(message: string): void {
    const label = this.node.getChildByName('HomeSubtitleLabel')?.getComponent(Label);
    if (label) label.string = message;
  }

  protected onDestroy(): void {
    this.startButton?.node?.targetOff(this);
    this.stageTargetButton?.node?.targetOff(this);
    this.trackedObjectButton?.node?.targetOff(this);
  }

  private requireStartButton(): Button {
    if (!this.startButton) throw new Error('Home Prefab is missing the StartButton binding');
    return this.startButton;
  }
}

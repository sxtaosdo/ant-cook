import { readThemeCollections, type PlayerProgress, type ThemeBasketProgress } from '../../application/playerProgress';
import type { LeaderboardConfig } from '../../application/leaderboard/leaderboard';
import type { SocialConfig, SocialEvent, SocialPartner } from '../../application/social/social';
import type { ProgressPage } from '../../../popups/progress/script/progressModel';

export interface SocialCard {
  title: string; detail: string; name: string; avatarColor: string; badge: string;
  action: string; button: string; enabled: boolean;
}
export interface SocialProfile {
  partner: SocialPartner; avatarColor: string; theme: ThemeBasketProgress;
  previous: boolean; next: boolean; canFollow: boolean; liked: boolean; commented: boolean; canRequest: boolean; canInteract: boolean;
}
export interface SocialPage {
  tab: 'partners' | 'history' | 'help' | 'profile' | 'messages'; cards: SocialCard[];
  footer: string; profile?: SocialProfile;
}
const at = (value: number): string => new Date(value + 8 * 3600000).toISOString().slice(5, 16).replace('T', ' ');

/** Product commands and read projections; the MK popup never owns a player or puzzle model. */
export class SocialPresentation {
  private tab: SocialPage['tab'] = 'partners';
  private partnerId = '';
  private themeIndex = -1;
  public constructor(private readonly progress: PlayerProgress, private readonly config: SocialConfig, private readonly leaderboard: LeaderboardConfig) {}

  public isProfile(): boolean { return this.tab === 'profile'; }
  public openPartner(id: string): void {
    if (!this.progress.readSocial().partners.some(p => p.id === id)) throw new Error('这位伙伴已离榜，历史记录仍然保留');
    if (this.progress.socialCanInteract()) this.progress.interactPartner(id, 'visit');
    this.partnerId = id; this.themeIndex = -1; this.tab = 'profile';
  }
  public read(): ProgressPage {
    const model = this.progress.readSocial();
    const canInteract = this.progress.socialCanInteract();
    const color = (avatar: number): string => this.leaderboard.avatarColors[avatar]!;
    const card = (name: string, avatar: number, title: string, detail: string, action: string, button: string, enabled = true, badge = ''): SocialCard =>
      ({ name, avatarColor: color(avatar), title, detail, action, button, enabled, badge });
    let title = '伙伴中心'; let summary = '本地虚拟伙伴 · 来访与回应均为模拟';
    const social: SocialPage = { tab: this.tab, cards: [], footer: `常客 ${model.partners.filter(p => p.followed).length}/5 · 今日互助 ${model.helped}/3 · 已获 ${model.helped * this.config.helpCoins}/30 金币` };
    if (!this.progress.socialAvailable()) {
      summary = this.progress.socialUnlockHint(); social.footer = '继续收集，认识夜市伙伴';
    } else if (this.tab === 'partners') {
      social.cards = model.partners.map(p => card(p.name, p.avatar, p.name, `主线 ${p.cleared}/60 关\n${p.ranked ? '点击拜访主题摊位' : '离榜常客 · 保留最后收集成果'}`, `profile:${p.id}`, '拜访', true, p.followed ? '常客' : '榜单伙伴'));
    } else if (this.tab === 'history') {
      social.cards = model.history.map(event => {
        const p = model.partners.find(bot => bot.id === event.actor.id);
        const label = this.eventText(event);
        return card(event.actor.name, event.actor.avatar, `${event.incoming ? event.actor.name : '我'} · ${label}`, `${at(event.at)} 北京时间\n${event.message || (event.incoming ? '点击回访这位伙伴' : `对象：${event.actor.name}`)}`, `profile:${event.actor.id}`, p ? '回访' : '已离榜', Boolean(p), event.incoming ? '收到' : '送出');
      });
      summary = '最近100条互动 · 北京时间';
      if (!social.cards.length) social.footer = '还没有来访记录，先去拜访一个伙伴吧';
    } else if (this.tab === 'help') {
      const request = model.request;
      if (request) social.cards.push(card(request.actor.name, request.actor.avatar, request.ready ? '伙伴援助已到达' : '正在等待伙伴援助', `${request.actor.name} · 1张补给券\n${request.ready ? '领取后沿用每局额外补给一次限制' : `预计 ${at(request.dueAt)} 北京时间回应`}`, 'claim', request.ready ? '领取' : '等待中', request.ready && canInteract, '我的求助'));
      else social.cards.push(card('我', 0, model.requested ? '今日已求助' : '向伙伴求助', '每天一次 · 18–30小时后收到\n1张补给券，手动领取', 'tab:partners', model.requested ? '明日再来' : '选伙伴', !model.requested, '我的求助'));
      social.cards.push(...model.helpRequests.map(r => card(r.actor.name, r.actor.avatar, `${r.actor.name}请求援助`, '免费援助，不扣补给券\n奖励10金币 · 每日最多30', `help:${r.id}`, r.done ? '已帮助' : '送出援助', !r.done && canInteract, '伙伴求助')));
    } else {
      const p = model.partners.find(bot => bot.id === this.partnerId);
      if (!p) { title = '伙伴已离榜'; summary = '原有记录和待领取援助仍然保留'; }
      else {
        const themes = readThemeCollections(Array.from({ length: p.cleared }, (_, i) => i + 1));
        const last = Math.min(4, Math.floor(p.cleared / 12));
        const index = this.themeIndex < 0 ? last : Math.min(this.themeIndex, last);
        social.profile = { partner: p, avatarColor: color(p.avatar), theme: themes[index]!, previous: index > 0, next: index < last,
          canFollow: canInteract && (p.followed || model.partners.filter(bot => bot.followed).length < this.config.maxFollows), canInteract,
          liked: model.liked.includes(p.id), commented: model.commented.includes(p.id), canRequest: canInteract && !model.requested && !model.request };
        title = `${p.name}的摊位`; summary = `虚拟伙伴 · 主线 ${p.cleared}/60 关${p.ranked ? '' : ' · 离榜常客'}`;
        if (this.tab === 'messages') {
          title = '给伙伴留句话';
          social.cards = this.config.messages.map((message, i) => card(p.name, p.avatar, message, '每天一次固定短句\n18–30小时后回应', `message:${i}`, '留言', canInteract && !model.commented.includes(p.id)));
        }
      }
    }
    if (this.progress.socialAvailable() && !canInteract) social.footer = '时间回退：可以浏览，互动与领奖暂缓';
    return { title, summary, rows: [], layout: 'social', showBack: this.tab === 'profile' || this.tab === 'messages', social };
  }

  public act(action: string): string {
    const [kind, value] = action.split(':');
    if (kind === 'profile') { this.openPartner(value); return ''; }
    if (kind === 'tab') {
      if (!['partners', 'history', 'help'].includes(value)) throw new Error('伙伴页面不存在');
      if (value === 'history') this.progress.markSocialRead();
      this.tab = value as SocialPage['tab']; return '';
    }
    if (kind === 'back') { this.tab = this.tab === 'messages' ? 'profile' : 'partners'; return ''; }
    if (kind === 'help') return this.progress.helpPartner(Number(value)) ? '援助已送出，获得10金币' : '这份援助已经完成';
    if (kind === 'claim') { this.progress.claimPartnerHelp(); return '已收到1张补给券'; }
    if (kind === 'messages') { this.tab = 'messages'; return ''; }
    const p = this.progress.readSocial().partners.find(bot => bot.id === this.partnerId);
    if (!p) throw new Error('这位伙伴已离榜，历史记录仍然保留');
    if (kind === 'follow') { this.progress.followPartner(p.id, !p.followed); return p.followed ? '已取消关注' : '已关注为常客'; }
    if (kind === 'like') return this.progress.interactPartner(p.id, 'like') ? '点赞已送出' : '今天已经点过赞';
    if (kind === 'message') {
      const sent = this.progress.interactPartner(p.id, 'comment', Number(value));
      this.tab = 'profile'; return sent ? '留言已送出，约一天后收到回应' : '今天已经给这位伙伴留过言';
    }
    if (kind === 'request') { this.progress.requestPartnerHelp(p.id); return '求助已送出，18–30小时后查看互助页'; }
    if (kind === 'theme') {
      const index = Number(value); const last = Math.min(4, Math.floor(p.cleared / 12));
      if (!Number.isInteger(index) || index < 0 || index > last) throw new Error('伙伴尚未解锁这个主题');
      this.themeIndex = index; return '';
    }
    throw new Error('伙伴操作不存在');
  }
  private eventText(event: SocialEvent): string {
    return { visit: '拜访摊位', like: '点赞', comment: '留言', help: '送出援助', request: '请求援助', aid: '补给券已到达', thanks: '感谢援助' }[event.kind];
  }
}

import type { SettingsSavePort } from './userSettings';
import type { LeaderboardEntry } from './leaderboard/leaderboard';

export const PROFILE_SAVE_KEY = 'colony.profile.v1';
export interface PlayerProfileSnapshot {
  readonly playerId: string;
  readonly nickname: string;
  readonly avatar: number;
  readonly registeredAt: number | null;
}

/** One local identity, independent of installation diagnostics and gameplay balances. */
export class PlayerProfile {
  private data: PlayerProfileSnapshot;
  public constructor(private readonly port: SettingsSavePort, private readonly avatarCount: number,
    createId: () => string, now: () => number, legacyPlayer: boolean) {
    if (!Number.isSafeInteger(avatarCount) || avatarCount < 1) throw new Error('头像配置不可用');
    const encoded = port.read(PROFILE_SAVE_KEY);
    if (encoded) {
      const saved: unknown = JSON.parse(encoded);
      if (!this.valid(saved)) throw new Error('玩家资料无法读取，请重试');
      this.data = { ...saved };
    } else {
      const created = { playerId: createId(), nickname: '蚂蚁摊主', avatar: 0, registeredAt: legacyPlayer ? null : now() };
      if (!this.valid(created)) throw new Error('本地玩家资料创建失败，请重试');
      port.write(PROFILE_SAVE_KEY, JSON.stringify(created));
      this.data = created;
    }
  }
  public snapshot(): PlayerProfileSnapshot { return { ...this.data }; }
  /** Display only: compact base-36 projection of the identity's random suffix.
   * Collisions are possible; associations and persistence always retain the full ID. */
  public static displayId(playerId: string): string {
    if (!/^local-[a-f0-9]{32}$/.test(playerId)) return playerId.slice(0, 10);
    return Number.parseInt(playerId.slice(-13), 16).toString(36).padStart(10, '0').slice(-10);
  }
  public save(nickname: string, avatar: number): PlayerProfileSnapshot {
    const next = { ...this.data, nickname: PlayerProfile.nickname(nickname), avatar };
    if (!Number.isSafeInteger(avatar) || avatar < 0 || avatar >= this.avatarCount) throw new Error('请选择有效头像');
    // Publish only after the complete profile has been persisted successfully.
    this.port.write(PROFILE_SAVE_KEY, JSON.stringify(next));
    this.data = next;
    return this.snapshot();
  }
  public leaderboard(entries: readonly LeaderboardEntry[], colors: readonly string[]): LeaderboardEntry[] {
    return entries.map(entry => entry.isSelf ? { ...entry, id: this.data.playerId, name: this.data.nickname,
      avatarColor: colors[this.data.avatar] ?? colors[0] ?? '#D9A44E' } : { ...entry });
  }
  public static nickname(value: string): string {
    const text = value.normalize('NFC').trim();
    if ([...text].length < 1 || [...text].length > 12 || /[\p{C}\p{Zl}\p{Zp}<>]/u.test(text)) throw new Error('昵称需为1–12个字符，不能含换行或标签');
    return text;
  }
  private valid(value: unknown): value is PlayerProfileSnapshot {
    if (!value || typeof value !== 'object') return false;
    const profile = value as Partial<PlayerProfileSnapshot>;
    if (typeof profile.playerId !== 'string' || !/^local-[a-f0-9]{32}$/.test(profile.playerId)
      || typeof profile.nickname !== 'string' || !Number.isSafeInteger(profile.avatar) || profile.avatar! < 0 || profile.avatar! >= this.avatarCount
      || (profile.registeredAt !== null && (!Number.isSafeInteger(profile.registeredAt) || profile.registeredAt! < 0 || profile.registeredAt! > Date.UTC(9999, 11, 31, 15, 59, 59, 999)))) return false;
    try { return PlayerProfile.nickname(profile.nickname) === profile.nickname; } catch { return false; }
  }
}

import type { GameColor, GameplayFeedback } from '../gameModel';

/** Text-only projection of model facts, shared by the existing HUD and toast. */
export class GameplayFeedbackText {
  private static readonly colors: Readonly<Record<GameColor, string>> = {
    berry: '莓红', citrus: '柑橘', leaf: '叶绿', plum: '紫', blue: '蓝', cocoa: '棕',
    gold: '金', orange: '橙', yellow: '黄', white: '白', cream: '奶油', charcoal: '炭灰',
  };

  public static status(feedback: GameplayFeedback): string {
    const slots = `槽位 ${feedback.totalSlots - feedback.emptySlots}/${feedback.totalSlots}`;
    if (feedback.failureReason === 'slots') return `${slots} · 空槽不足，且无可运输颜色，无法继续`;
    if (feedback.failureReason === 'blocked') return `${slots} · 无可取数字组，且无可运输颜色，无法继续`;
    const colors = feedback.transportColors.map(color => this.colors[color]).join('、');
    return `${slots} · ${colors ? `可运 ${colors}` : feedback.pendingDeliveries > 0 ? '搬运中' : '暂无可运输颜色'}`;
  }

  public static selection(feedback: GameplayFeedback): string {
    const selection = feedback.selection;
    if (!selection) return '';
    switch (selection.reason) {
      case 'finished': return '本局已结束';
      case 'missing': return '数字组已不可用';
      case 'selected': return '这组已入槽';
      case 'locked': return '这组尚未解锁';
      case 'covered': return '先取走前方数字组；连体组需全部可取';
      default: return '';
    }
  }
}
import type { CollectionFeedback } from '../scripts/presentation/constructionPresentation';

export type ResultPopupKind = 'success' | 'fail';
export type ResultPopupEvent = 'primary' | 'home';
export type ResultPopupAction = 'continue' | 'home';

/** 打开结算弹窗时的种子数据。 */
export interface ResultPopupSeed {
  readonly level: number;
  readonly transported: number;
  readonly hasNextLevel: boolean;
  readonly rewardText?: string;
  readonly daily?: boolean;
  readonly adAvailable?: boolean;
  readonly firstBuild?: boolean;
  readonly collection?: CollectionFeedback;
}

/** 结算弹窗导航回调合同。 */
export interface ResultPopupNav {
  readonly onContinue: () => void | Promise<void>;
  readonly onHome: () => void | Promise<void>;
  readonly onAd?: () => Promise<string>;
  readonly canAd?: () => boolean;
  readonly canNavigate?: () => boolean;
}

/** 将结算弹窗按钮事件映射为页面导航动作。 */
export function resolveResultPopupAction(
  kind: ResultPopupKind,
  event: ResultPopupEvent,
  hasNextLevel: boolean,
  daily = false,
): ResultPopupAction {
  if (event === 'home') return 'home';
  if (kind === 'fail') return 'continue';
  return daily || hasNextLevel ? 'continue' : 'home';
}

/** 吞掉 MK UI「中断」错误，其它异常继续抛出。 */
export async function swallowMkInterrupt(task: Promise<void>): Promise<void> {
  try {
    await task;
  } catch (error) {
    if (error !== '中断') throw error;
  }
}

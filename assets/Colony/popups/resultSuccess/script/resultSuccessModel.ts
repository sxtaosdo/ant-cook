import mk from 'mk';
import type { CollectionFeedback } from '../../../scripts/presentation/constructionPresentation';

/** 胜利结算 Model：关卡、运送数、是否有下一关。 */
export class ResultSuccessModel extends mk.MVCModelBase {
  public level = 0;
  public transported = 0;
  public hasNextLevel = false;
  public rewardText = '';
  public daily = false;
  public adAvailable = false;
  public firstBuild = false;
  public collection: CollectionFeedback | undefined;
}

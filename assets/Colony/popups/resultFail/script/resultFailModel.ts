import mk from 'mk';

/** 失败结算 Model：关卡、运送数、是否有下一关。 */
export class ResultFailModel extends mk.MVCModelBase {
  public level = 0;
  public transported = 0;
  public hasNextLevel = false;
}

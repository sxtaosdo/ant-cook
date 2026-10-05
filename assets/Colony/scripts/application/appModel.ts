import type { ColonyApplicationError } from './contracts';

/** 仅持有全局应用错误；页面身份在 State，关卡号在 ColonyFlowModel。 */
export class AppModel {
  public error: ColonyApplicationError | null = null;

  /** 写入全局错误。 */
  public setError(error: ColonyApplicationError): void {
    this.error = error;
  }

  /** 清除全局错误。 */
  public clearError(): void {
    this.error = null;
  }
}

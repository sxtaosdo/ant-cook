import type { ColonyTool, GameResult, GameSnapshot, ObservableEvent } from '../gameModel';

export type { ColonyTool };

/** 通用成功/失败结果包装。 */
export type ApplicationResult<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/** Play 页只读投影：快照、道具与全局错误。 */
export interface ColonyReadModel {
  readonly currentLevel: number;
  readonly maxLevel: number;
  readonly usedTools: readonly ColonyTool[];
  readonly result: GameResult;
  readonly snapshot: GameSnapshot;
  readonly lastEvents: readonly ObservableEvent[];
  readonly lastDispatchRound: readonly (readonly ObservableEvent[])[];
  readonly suggestedStackId: string | null;
  readonly error: ColonyApplicationError | null;
}

/** 应用层错误合同。 */
export interface ColonyApplicationError {
  readonly code: 'CONFIG' | 'INVALID_OPERATION' | 'RUNTIME';
  readonly message: string;
}

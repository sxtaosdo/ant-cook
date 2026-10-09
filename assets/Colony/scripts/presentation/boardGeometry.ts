import type { BoardCellState, StackState } from '../gameModel';

const BOARD_CENTER_Y = 90;
const BOARD_MAX_SPAN = 420;

export type BoardPosition = Readonly<{ x: number; y: number }>;

/** 棋盘几何：格子尺寸与行列到本地坐标的换算。 */
export type BoardGeometry = Readonly<{
  minRow: number;
  maxRow: number;
  minColumn: number;
  maxColumn: number;
  cellSize: number;
  toPosition: (row: number, column: number) => BoardPosition;
  entryPosition: (column: number) => BoardPosition;
}>;

/** 由当前棋盘快照推导表现层几何。 */
export function deriveBoardGeometry(board: readonly Readonly<BoardCellState>[], maxSpan = BOARD_MAX_SPAN): BoardGeometry {
  const rows = board.map((cell) => cell.row);
  const columns = board.map((cell) => cell.column);
  const minRow = Math.min(...rows);
  const maxRow = Math.max(...rows);
  const minColumn = Math.min(...columns);
  const maxColumn = Math.max(...columns);
  const span = Math.max(maxRow - minRow + 1, maxColumn - minColumn + 1);
  const cellSize = Math.min(
    span <= 5 ? 84 : span <= 7 ? 64 : 28,
    maxSpan / span,
  );
  const centerRow = (minRow + maxRow) / 2;
  const centerColumn = (minColumn + maxColumn) / 2;
  const toPosition = (row: number, column: number): BoardPosition => ({
    x: (column - centerColumn) * cellSize,
    y: BOARD_CENTER_Y + (centerRow - row) * cellSize,
  });
  return {
    minRow,
    maxRow,
    minColumn,
    maxColumn,
    cellSize,
    toPosition,
    entryPosition: (column: number) => toPosition(maxRow + 1, column),
  };
}

const STACK_COLUMN_GAP = 102;
const STACK_ROW_GAP = 104;

/** 未选择的数字组按列纵向排开；列首选走后，后续数字组依次向槽位方向补位。 */
/** Compute each queue head once per projection, including locked and offscreen items. */
export function stackPileHeads(stacks: readonly Readonly<StackState>[]): ReadonlyMap<number, number> {
  const heads = new Map<number, number>();
  for (const stack of stacks) if (!stack.selected) heads.set(stack.pile, Math.min(heads.get(stack.pile) ?? Infinity, stack.depth));
  return heads;
}

export function stackPilePosition(stack: Readonly<StackState>, stacks: readonly Readonly<StackState>[], heads?: ReadonlyMap<number, number>, queueColumns: 3 | 4 | 5 = 5): BoardPosition {
  const head = heads ? heads.get(stack.pile) ?? Infinity : Math.min(...stacks.filter((item) => item.pile === stack.pile && !item.selected).map((item) => item.depth));
  const row = Math.max(0, stack.depth - head);
  return {
    x: -(queueColumns - 1) * STACK_COLUMN_GAP / 2 + (queueColumns === 5 ? -1 : 0) + stack.pile * STACK_COLUMN_GAP,
    y: row === 0 ? 0 : -row * STACK_ROW_GAP,
  };
}

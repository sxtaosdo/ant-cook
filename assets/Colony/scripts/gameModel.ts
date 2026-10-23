import { boardRoute, type BoardBounds } from './application/boardRoute';
import type { DevelopmentLevelCatalog, DevelopmentLevelConfig } from './application/levelCatalog';
import { GAME_COLORS, validateDevelopmentLevel, type QueueColumns, type BoardShape, type GameColor } from './application/levelCatalog';

export { GAME_COLORS, type BoardShape, type GameColor } from './application/levelCatalog';
/** 对局结果：进行中 / 成功 / 失败。 */
export type GameResult = "PLAYING" | "SUCCESS" | "FAIL";
/** 本关一次性道具：铲子 / 扩槽 / 指南针。 */
export type ColonyTool = 'trowel' | 'slot' | 'compass';

export type BoardCellState = { id: string; row: number; column: number; color: GameColor; cleared: boolean; keyId?: string };
export type StackState = { id: string; color: GameColor; count: number; pile: number; depth: number; selected: boolean; accessible: boolean; mystery?: true; revealed?: boolean; linkId?: string; lockId?: string; locked?: boolean };
export type SlotStackState = { stackId: string; color: GameColor; remaining: number };
export type RoutePoint = { row: number; column: number };
/** 玩法只读快照，供 UI 投影。 */
export type GameSnapshot = {
  level: number;
  shape: BoardShape;
  result: GameResult;
  board: BoardCellState[];
  remainingCells: number;
  exposedCellIds: string[];
  slots: Array<SlotStackState | null>;
  stacks: StackState[];
  transported: number;
  queueColumns?: QueueColumns;
  acquiredKeys?: string[];
};

export type SelectionFeedback = Readonly<{
  reason: 'finished' | 'missing' | 'selected' | 'locked' | 'covered' | 'slots' | null;
  requiredSlots?: number;
}>;
/** Detached facts for feedback; never exposes queue contents or a suggested choice. */
export type GameplayFeedback = Readonly<{
  totalSlots: number;
  emptySlots: number;
  transportColors: readonly GameColor[];
  pendingDeliveries: number;
  failureReason: 'slots' | 'blocked' | null;
  selection?: SelectionFeedback;
}>;
export const EMPTY_GAME_SNAPSHOT: GameSnapshot = {
  level: 0,
  shape: 'PROVISIONAL_ORANGE_POP',
  result: 'PLAYING',
  board: [],
  remainingCells: 0,
  exposedCellIds: [],
  slots: [],
  stacks: [],
  transported: 0,
};

/** 可观察玩法事件，供表现层驱动动画与反馈。 */
export type ObservableEvent = {
  phase: "INPUT" | "SLOT" | "SPAWN" | "MOVE" | "INTERACT" | "COUNT" | "RELEASE" | "REVEAL" | "GROUP_REVEAL" | "UNLOCK" | "SUCCESS" | "FAIL";
  color?: GameColor;
  stackId?: string;
  cellId?: string;
  slotIndex?: number;
  remaining?: number;
  route?: RoutePoint[];
  message: string;
};

type StackDefinition = Readonly<Omit<StackState, "selected" | "accessible" | "revealed" | "locked">>;
type LevelDefinition = {
  readonly level: number;
  readonly shape: BoardShape;
  readonly board: readonly Readonly<BoardCellState>[];
  readonly stacks: readonly StackDefinition[];
  readonly initialSlots: 5 | 6;
  readonly queueColumns: QueueColumns;
};
export const TRANSPORT_DISPATCH_INTERVAL_MS = 180;

/** 将开发关卡配置冻结为关卡定义。 */
function createDevelopmentLevel(config: DevelopmentLevelConfig): LevelDefinition {
  config = validateDevelopmentLevel(config, config.level);
  const initialSlots = config.initialSlots ?? 5;
  if (initialSlots !== 5 && initialSlots !== 6) throw new Error(`Level ${config.level} initialSlots must be 5 or 6`);
  const cells = config.cells.map((cell) => Object.freeze({
    id: cell.id,
    row: cell.row,
    column: cell.column,
    color: cell.color as GameColor,
    cleared: false,
    ...(cell.keyId ? { keyId: cell.keyId } : {}),
  }));
  return Object.freeze({
    level: config.level,
    shape: config.shape,
    initialSlots,
    queueColumns: config.queueColumns ?? 5,
    board: Object.freeze(cells),
    stacks: Object.freeze(config.groups.map((group) => Object.freeze({
      id: group.id,
      color: group.color as GameColor,
      count: group.count,
      pile: group.pile,
      depth: group.depth,
      ...(group.mystery ? { mystery: true as const } : {}),
      ...(group.linkId ? { linkId: group.linkId } : {}),
      ...(group.lockId ? { lockId: group.lockId } : {}),
    }))),
  });
}

/** 从关卡目录构建全部关卡定义。 */
function levelDefinitions(catalog: DevelopmentLevelCatalog): readonly LevelDefinition[] {
  return Object.freeze(catalog.levels.map(createDevelopmentLevel));
}

/** 纯玩法状态 Owner：棋盘、暂存槽、数字组、道具与胜负。 */
export class ColonyFlowModel {
  private level = 1;
  private shape: BoardShape = "PROVISIONAL_ORANGE_POP";
  private result: GameResult = "PLAYING";
  private board: BoardCellState[] = [];
  private activeCoordinates = new Set<string>();
  private exposedCache: BoardCellState[] | null = null;
  private bounds!: BoardBounds;
  private slots: Array<SlotStackState | null> = [];
  private stacks: StackState[] = [];
  private transported = 0;
  private queueColumns: QueueColumns = 5;
  private readonly acquiredKeys = new Set<string>();
  private readonly inFlight = new Map<string, number>();
  /** 已派出蚂蚁、尚未清除的棋盘格预约。 */
  private reservations = new Map<string, { slotIndex: number; color: GameColor; stackId: string }>();
  private readonly usedTools = new Set<ColonyTool>();
  private extraSupplyUsed = false;
  private lastEvents: ObservableEvent[] = [];
  private lastDispatchRound: ObservableEvent[][] = [];
  private suggestedStackId: string | null = null;

  private readonly definitions: readonly LevelDefinition[];

  public constructor(private readonly catalog: DevelopmentLevelCatalog) {
    this.definitions = levelDefinitions(catalog);
    this.reset();
  }

  /** 关卡总数。 */
  public get levelCount(): number {
    return this.definitions.length;
  }

  /** 当前关卡号（1-based）。 */
  public get currentLevel(): number {
    return this.level;
  }

  /** 加载指定关卡并清空瞬时对局状态。 */
  public reset(level = 1) {
    this.level = Math.max(1, Math.min(level, this.definitions.length));
    this.result = "PLAYING";
    const definition = this.definitions[this.level - 1]!;
    this.shape = definition.shape;
    this.queueColumns = definition.queueColumns;
    this.acquiredKeys.clear();
    this.inFlight.clear();
    this.board = definition.board.map((cell) => ({ ...cell, cleared: false }));
    this.activeCoordinates = new Set(this.board.map(cell => `${cell.row}:${cell.column}`));
    this.exposedCache = null;
    this.bounds = { minRow: Math.min(...this.board.map(cell => cell.row)), maxRow: Math.max(...this.board.map(cell => cell.row)), minColumn: Math.min(...this.board.map(cell => cell.column)), maxColumn: Math.max(...this.board.map(cell => cell.column)) };
    this.slots = Array.from({ length: definition.initialSlots }, () => null);
    this.stacks = definition.stacks.map((stack) => ({ ...stack, selected: false, accessible: stack.depth === 0 }));
    this.transported = 0;
    this.reservations.clear();
    this.usedTools.clear();
    this.extraSupplyUsed = false;
    this.clearTransient();
    this.refreshQueue([]);
    this.finalize([]);
    return this.snapshot();
  }

  /** 供 UI / Presenter 消费的不可变只读投影。 */
  snapshot(): GameSnapshot {
    return {
      level: this.level,
      shape: this.shape,
      result: this.result,
      board: this.board.map((cell) => ({ ...cell })),
      remainingCells: this.board.length - this.transported,
      exposedCellIds: this.exposedCells().map((cell) => cell.id),
      slots: this.slots.map((slot) => slot ? { ...slot } : null),
      stacks: this.stacks.map((stack) => ({ ...stack })),
      transported: this.transported,
      queueColumns: this.queueColumns,
      acquiredKeys: [...this.acquiredKeys],
    };
  }

  /** Read existing rules without selecting, reserving, revealing or consuming anything. */
  public feedback(stackId?: string): GameplayFeedback {
    const emptySlots = this.slots.filter(slot => slot === null).length;
    const transportColors = [...new Set(this.slots.flatMap((slot, index) =>
      slot && this.findDispatchForSlot(index) ? [slot.color] : []))];
    const hasFront = this.result === 'FAIL' && this.stacks.some(stack => this.frontAvailable(this.members(stack)));
    return {
      totalSlots: this.slots.length, emptySlots, transportColors,
      pendingDeliveries: this.reservations.size,
      failureReason: this.result === 'FAIL' ? (hasFront ? 'slots' : 'blocked') : null,
      ...(stackId === undefined ? {} : { selection: this.selectionFeedback(stackId, emptySlots) }),
    };
  }

  private selectionFeedback(stackId: string, emptySlots: number): SelectionFeedback {
    if (this.result !== 'PLAYING') return { reason: 'finished' };
    const stack = this.stacks.find(candidate => candidate.id === stackId);
    if (!stack) return { reason: 'missing' };
    if (stack.selected || stack.count === 0) return { reason: 'selected' };
    if (stack.locked) return { reason: 'locked' };
    const members = this.members(stack);
    if (!this.frontAvailable(members)) return { reason: 'covered' };
    // Linked groups can include a still-hidden member; do not disclose its size.
    const visible = members.every(member => !member.locked && (!member.mystery || member.revealed));
    return { reason: emptySlots < members.length ? 'slots' : null,
      ...(visible ? { requiredSlots: members.length } : {}) };
  }

  /** 本关已使用的道具列表。 */
  usedToolList(): readonly ColonyTool[] {
    return [...this.usedTools];
  }

  /** Includes hidden rows and groups removed by the trowel; no board snapshot allocation. */
  public get selectableQueueExhausted(): boolean {
    return this.result === 'PLAYING' && this.stacks.every(stack => stack.selected || stack.count === 0);
  }

  /** 最近一次指令产生的事件副本。 */
  lastEventList(): ObservableEvent[] {
    return this.cloneEvents(this.lastEvents);
  }

  /** 最近一轮派发的事件分组副本。 */
  lastDispatchRoundList(): ObservableEvent[][] {
    return this.lastDispatchRound.map((events) => this.cloneEvents(events));
  }

  /** 指南针建议的数字组 id。 */
  suggestedStack(): string | null {
    return this.suggestedStackId;
  }

  /** 连体先完成整组预检，再按配置顺序原子入槽；失败不改变状态。 */
  selectStack(stackId: string): ObservableEvent[] {
    if (this.result !== "PLAYING") throw new Error(`Cannot select a Stack after ${this.result}`);
    const stack = this.stacks.find(candidate => candidate.id === stackId);
    if (!stack) throw new Error(`Unknown Stack: ${stackId}`);
    if (stack.selected) throw new Error(`Stack was already selected: ${stackId}`);
    const members = this.members(stack);
    if (!this.frontAvailable(members)) throw new Error(`Stack is covered, selected or locked: ${stackId}`);
    const empty = this.slots.flatMap((slot, index) => slot === null ? [index] : []);
    if (empty.length < members.length) throw new Error('Not enough empty holding slots for the whole linked group');
    this.clearTransient();
    const events: ObservableEvent[] = [];
    for (const [index, member] of members.entries()) {
      const slotIndex = empty[index]!;
      member.selected = true;
      member.accessible = false;
      if (member.mystery && !member.revealed) {
        member.revealed = true;
        events.push({ phase: 'GROUP_REVEAL', stackId: member.id, message: `${member.id} revealed its configured contents` });
      }
      this.slots[slotIndex] = { stackId: member.id, color: member.color, remaining: member.count };
      events.push({ phase: 'INPUT', color: member.color, stackId: member.id, message: `${member.id} selected` },
        { phase: 'SLOT', color: member.color, stackId: member.id, slotIndex, remaining: member.count, message: `${member.id} entered holding slot ${slotIndex + 1}` });
    }
    this.refreshQueue(events);
    this.finalize(events);
    this.lastEvents = events;
    return this.lastEventList();
  }

  private members(stack: StackState): StackState[] {
    return stack.linkId ? this.stacks.filter(candidate => candidate.linkId === stack.linkId && !candidate.selected && candidate.count > 0) : [stack];
  }
  private frontAvailable(members: readonly StackState[]): boolean {
    const ids = new Set(members.map(member => member.id));
    return members.length > 0 && members.every(member => !member.selected && member.count > 0
      && (!member.lockId || this.acquiredKeys.has(member.lockId))
      && !this.stacks.some(predecessor => predecessor.pile === member.pile && predecessor.depth < member.depth
        && !predecessor.selected && predecessor.count > 0 && !ids.has(predecessor.id)));
  }
  private refreshQueue(events: ObservableEvent[]): void {
    for (const stack of this.stacks) {
      stack.locked = Boolean(stack.lockId && !this.acquiredKeys.has(stack.lockId));
      const head = !this.stacks.some(previous => previous.pile === stack.pile && previous.depth < stack.depth && !previous.selected && previous.count > 0);
      if (!stack.revealed && (!stack.mystery || stack.selected || head)) {
        stack.revealed = true;
        if (stack.mystery) events.push({ phase: 'GROUP_REVEAL', stackId: stack.id, message: `${stack.id} reached the queue head` });
      }
      stack.accessible = !stack.selected && this.frontAvailable(this.members(stack));
    }
  }
  private acquireKey(cell: BoardCellState, events: ObservableEvent[]): void {
    if (!cell.keyId || this.acquiredKeys.has(cell.keyId)) return;
    this.acquiredKeys.add(cell.keyId);
    events.push({ phase: 'UNLOCK', cellId: cell.id, message: `Key ${cell.keyId} unlocked its configured groups` });
    this.refreshQueue(events);
  }
  private releaseCompleted(slotIndex: number, events: ObservableEvent[]): void {
    const slot = this.slots[slotIndex];
    if (!slot || slot.remaining !== 0 || (this.inFlight.get(slot.stackId) ?? 0) !== 0) return;
    this.slots[slotIndex] = null;
    events.push({ phase: 'RELEASE', color: slot.color, stackId: slot.stackId, slotIndex, remaining: 0, message: `${slot.stackId} completed every unit` });
  }

  /** 若存在匹配，派发一次「槽位 → 暴露格」搬运。 */
  dispatchOne(): ObservableEvent[] {
    if (this.result !== "PLAYING") return [];
    const dispatch = this.findDispatch();
    return dispatch ? this.dispatch(dispatch.slotIndex, dispatch.cell) : [];
  }

  /** 每个就绪槽位派发一次；可选颜色过滤以配合表现节奏。 */
  dispatchReady(allowedColors?: ReadonlySet<GameColor>, blockedStackIds?: ReadonlySet<string>): ObservableEvent[][] {
    this.clearTransient();
    if (this.result !== "PLAYING") return [];
    const events: ObservableEvent[][] = [];
    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex += 1) {
      const slot = this.slots[slotIndex];
      if (slot && blockedStackIds?.has(slot.stackId)) continue;
      if (slot && allowedColors && !allowedColors.has(slot.color)) continue;
      const cell = this.findDispatchForSlot(slotIndex);
      if (cell) events.push(this.dispatch(slotIndex, cell));
    }
    this.lastDispatchRound = events;
    this.lastEvents = events.flat();
    return this.lastDispatchRoundList().map((round) => [...round]);
  }

  /** 蚂蚁到达：清除格子并结算胜负；最后一份食物实际清除后释放槽位。 */
  completeTransport(cellId: string): ObservableEvent[] {
    this.clearTransient();
    const reservation = this.reservations.get(cellId);
    const cell = this.board.find((candidate) => candidate.id === cellId);
    if (!reservation || !cell || cell.cleared) return [];
    const exposedBefore = new Set(this.exposedCells().map((candidate) => candidate.id));
    this.reservations.delete(cellId);
    this.inFlight.set(reservation.stackId, (this.inFlight.get(reservation.stackId) ?? 1) - 1);
    cell.cleared = true;
    this.activeCoordinates.delete(`${cell.row}:${cell.column}`);
    this.exposedCache = null;
    this.transported += 1;
    const events: ObservableEvent[] = [{
      phase: "INTERACT",
      color: reservation.color,
      stackId: reservation.stackId,
      cellId,
      slotIndex: reservation.slotIndex,
      message: `${cellId} cleared after its ant arrived`,
    }];
    this.acquireKey(cell, events);
    this.releaseCompleted(reservation.slotIndex, events);
    const newlyExposed = this.exposedCells().filter((candidate) => !exposedBefore.has(candidate.id));
    if (newlyExposed.length > 0) events.push({ phase: "REVEAL", cellId: newlyExposed[0]!.id, message: `${newlyExposed.length} covered board cells became reachable` });
    this.finalize(events);
    this.lastEvents = events;
    return this.lastEventList();
  }

  /** 不消耗道具，将暂存槽扩展至最多 6 个。 */
  addExtraSlot(): boolean {
    if (this.result !== "PLAYING" || this.slots.length >= 6) return false;
    this.slots.push(null);
    return true;
  }

  /** 消耗扩槽道具并新增一个暂存槽。 */
  useExtraSlot(): void {
    this.clearTransient();
    if (!this.canUseTool('slot')) throw new Error('Extra slot is not available');
    this.consumeTool('slot');
    this.addExtraSlot();
  }

  /** 清除首个暴露格（小铲子效果本体）。 */
  clearOneExposedCell(): ObservableEvent[] {
    if (this.result !== "PLAYING") return [];
    const cell = this.exposedCells()[0];
    if (!cell) return [];
    cell.cleared = true;
    this.activeCoordinates.delete(`${cell.row}:${cell.column}`);
    this.exposedCache = null;
    this.transported += 1;
    const events: ObservableEvent[] = [{ phase: "INTERACT", color: cell.color, cellId: cell.id, message: `${cell.id} cleared by trowel` }];
    const slotIndex = this.slots.findIndex((slot) => slot?.color === cell.color && slot.remaining > 0);
    if (slotIndex >= 0) {
      const slot = this.slots[slotIndex]!;
      slot.remaining -= 1;
      events.push({ phase: "COUNT", color: slot.color, stackId: slot.stackId, slotIndex, remaining: slot.remaining, message: `${slot.stackId} has ${slot.remaining} units left` });
      this.releaseCompleted(slotIndex, events);
    } else {
      const stack = this.stacks.find((candidate) => !candidate.selected && candidate.color === cell.color && candidate.count > 0);
      if (stack) {
        stack.count -= 1;
        if (stack.count === 0) {
          stack.selected = true;
          stack.accessible = false;

        }
      }
    }
    this.acquireKey(cell, events);
    this.refreshQueue(events);
    this.finalize(events);
    return events;
  }

  /** 消耗小铲子并清除一个暴露格。 */
  useTrowel(): ObservableEvent[] {
    this.clearTransient();
    if (!this.canUseTool('trowel')) throw new Error('No exposed cargo can be cleared');
    this.consumeTool('trowel');
    const events = this.clearOneExposedCell();
    this.lastEvents = events;
    return this.lastEventList();
  }

  /** 在有空槽时，优先选出颜色匹配暴露格的可取数字组。 */
  autoSelectableStackId(): string | null {
    if (this.result !== "PLAYING" || !this.slots.some((slot) => slot === null)) return null;
    const exposedColors = new Set(this.exposedCells().map((cell) => cell.color));
    const empty = this.slots.filter(slot => slot === null).length;
    return this.stacks.find(stack => stack.accessible && this.members(stack).length <= empty && exposedColors.has(stack.color))?.id ?? null;
  }

  /** 消耗指南针，并向 Presenter 写入建议选取的数字组 id。 */
  useCompass(): string | null {
    this.clearTransient();
    if (!this.canUseTool('compass')) throw new Error('No selectable stack can be suggested');
    this.consumeTool('compass');
    this.suggestedStackId = this.autoSelectableStackId();
    return this.suggestedStackId;
  }

  public canUseTool(tool: ColonyTool): boolean {
    if (this.result !== 'PLAYING' || this.usedTools.has(tool)) return false;
    if (tool === 'slot') return this.slots.length < 6;
    if (tool === 'trowel') return this.exposedCells().length > 0;
    return this.autoSelectableStackId() !== null;
  }

  /** 额外补给只补充已用的非扩槽道具；资产由长期进度先完成事务。 */
  canUseExtraSupply(tool: 'trowel' | 'compass'): boolean {
    return this.result === 'PLAYING' && !this.extraSupplyUsed && this.usedTools.has(tool)
      && (tool === 'trowel' ? this.exposedCells().length > 0 : this.autoSelectableStackId() !== null);
  }

  useExtraSupply(tool: 'trowel' | 'compass'): void {
    if (!this.canUseExtraSupply(tool)) throw new Error('本局无法使用此额外补给');
    this.usedTools.delete(tool);
    this.extraSupplyUsed = true;
    if (tool === 'trowel') this.useTrowel();
    else this.useCompass();
  }

  /** 消耗指定道具；重复使用或非 PLAYING 时抛错。 */
  private consumeTool(tool: ColonyTool): void {
    if (this.result !== "PLAYING") throw new Error('Gameplay requires PLAYING result');
    if (this.usedTools.has(tool)) throw new Error(`${tool} was already used`);
    this.usedTools.add(tool);
  }

  /** 清除不得跨输入残留的上一指令投影。 */
  private clearTransient(): void {
    this.lastEvents = [];
    this.lastDispatchRound = [];
    this.suggestedStackId = null;
  }

  /** 深拷贝事件列表（含路线点）。 */
  private cloneEvents(events: readonly ObservableEvent[]): ObservableEvent[] {
    return events.map((event) => ({
      ...event,
      route: event.route?.map((point) => ({ ...point })),
    }));
  }

  /** 预约格子并产出一只蚂蚁的 SPAWN/MOVE/COUNT 事件。 */
  private dispatch(slotIndex: number, cell: BoardCellState): ObservableEvent[] {
    const slot = this.slots[slotIndex]!;
    const route = this.routeTo(cell, slotIndex);
    this.reservations.set(cell.id, { slotIndex, color: slot.color, stackId: slot.stackId });
    this.inFlight.set(slot.stackId, (this.inFlight.get(slot.stackId) ?? 0) + 1);
    const events: ObservableEvent[] = [
      { phase: "SPAWN", color: slot.color, stackId: slot.stackId, cellId: cell.id, slotIndex, remaining: slot.remaining, message: `${slot.color} unit spawned from ${slot.stackId}` },
      { phase: "MOVE", color: slot.color, stackId: slot.stackId, cellId: cell.id, slotIndex, remaining: slot.remaining, route, message: `${slot.color} unit crawled through blank space` },
    ];
    slot.remaining -= 1;
    events.push({ phase: "COUNT", color: slot.color, stackId: slot.stackId, cellId: cell.id, slotIndex, remaining: slot.remaining, message: `${slot.stackId} has ${slot.remaining} units left` });
    return events;
  }

  /** 棋盘清空或死锁时追加 SUCCESS/FAIL。 */
  private finalize(events: ObservableEvent[]) {
    const remainingCells = this.board.length - this.transported;
    if (remainingCells === 0) {
      this.result = "SUCCESS";
      events.push({ phase: "SUCCESS", message: "Every board cell was transported" });
    } else if (this.reservations.size === 0 && !(this.canUseTool('trowel') && this.exposedCells()[0]?.keyId && !this.acquiredKeys.has(this.exposedCells()[0]!.keyId!)) && !this.findDispatch() && !this.stacks.some(stack => this.frontAvailable(this.members(stack)) && this.members(stack).length <= this.slots.filter(slot => slot === null).length)) {
      this.result = "FAIL";
      events.push({ phase: "FAIL", message: "No legal queue selection, transport or pending delivery remains" });
    }
  }

  /** 查找任意可派发的槽位与目标格。 */
  private findDispatch(): { slotIndex: number; cell: BoardCellState } | null {
    for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex += 1) {
      const cell = this.findDispatchForSlot(slotIndex);
      if (cell) return { slotIndex, cell };
    }
    return null;
  }

  /** 为指定槽位查找颜色匹配的暴露格。 */
  private findDispatchForSlot(slotIndex: number): BoardCellState | null {
    const slot = this.slots[slotIndex];
    if (!slot || slot.remaining <= 0) return null;
    let target: BoardCellState | null = null;
    for (const candidate of this.exposedCells()) {
      if (candidate.color === slot.color && (!target || candidate.row > target.row)) target = candidate;
    }
    return target;
  }

  /** 至少有一条正交空边且未被预约的格子。 */
  private exposedCells(): BoardCellState[] {
    this.exposedCache ??= this.externalCells();
    return this.exposedCache.filter(cell => !this.reservations.has(cell.id));
  }

  /** Flood only exterior empty space; a sealed inner hole cannot admit an ant. */
  private externalCells(): BoardCellState[] {
    const { minRow, maxRow, minColumn, maxColumn } = this.bounds;
    const queue = [{ row: maxRow + 1, column: minColumn - 1 }];
    const seen = new Set([`${maxRow + 1}:${minColumn - 1}`]);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const { row, column } = queue[cursor]!;
      for (const [r, c] of [[row - 1, column], [row + 1, column], [row, column - 1], [row, column + 1]]) {
        const key = `${r}:${c}`;
        if (r! < minRow - 1 || r! > maxRow + 1 || c! < minColumn - 1 || c! > maxColumn + 1 || seen.has(key) || this.hasActiveCell(r!, c!)) continue;
        seen.add(key); queue.push({ row: r!, column: c! });
      }
    }
    return this.board.filter(cell => !cell.cleared &&
      [[cell.row - 1, cell.column], [cell.row + 1, cell.column], [cell.row, cell.column - 1], [cell.row, cell.column + 1]]
        .some(([row, column]) => seen.has(`${row}:${column}`)));
  }

  /** 坐标上是否仍有未清除格子。 */
  private hasActiveCell(row: number, column: number): boolean {
    return this.activeCoordinates.has(`${row}:${column}`);
  }

  /** 同样最短的路线优先选择更少的转弯。 */
  private routeTo(target: BoardCellState, slotIndex: number): RoutePoint[] {
    const { minColumn, maxColumn, maxRow } = this.bounds;
    const start = { row: maxRow + 1, column: Math.round(minColumn + (maxColumn - minColumn) * slotIndex / Math.max(1, this.slots.length - 1)) };
    const route = boardRoute(start, target, this.bounds, this.activeCoordinates);
    // 保留旧无路标记；异步难度验证会拒绝该内洞，不新增穿格路径。
    return route.length ? route : [{ row: target.row, column: target.column }];
  }
}

import { Button, Color, EventTouch, Label, Node, Sprite, SpriteFrame, tween, Tween, UITransform, Vec3 } from 'cc';
import type { ColonyReadModel } from '../application/contracts';
import type { ObservableEvent, SlotStackState } from '../gameModel';
import { colonyColor } from './colonyColors';
import { deriveBoardGeometry, stackPileHeads, stackPilePosition, type BoardGeometry } from './boardGeometry';
import { NodeFactory } from './nodeFactory';
import { PuzzleFrames } from './puzzleFrames';

/** 棋盘/暂存槽/数字组表现：节点池、入槽动画与暴露高亮。 */
export class BoardPresentation {
  private disposed = false;
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.recycle();
    this.factory.dispose();
    this.puzzle?.dispose(); this.puzzle = null;
    this.produce?.dispose(); this.produce = null;
  }
  private readonly factory = new NodeFactory();
  private readonly cellPool = this.factory.pool('board-cell');
  private readonly stackPool = this.factory.pool('number-group');
  private readonly slotTokenPool = this.factory.pool('slot-token');
  private readonly cellNodes = new Map<string, Node>();
  private readonly stackNodes = new Map<string, Node>();
  private readonly moving = new Set<string>();
  private stackRootOriginalSiblingIndex: number | null = null;
  private movingStackAnimations = 0;
  private slotNodes: Node[] = [];
  private displaySlots: Array<SlotStackState | null> = [];
  private slotTokens: Array<{ node: Node; label: Label; stackId: string; color: SlotStackState['color']; remaining: number; frame: SpriteFrame } | null> = [];
  private geometryValue: BoardGeometry | null = null;
  private queueOffset = 0;
  private queueMaxOffset = 0;
  private queueTouchY = 0;
  private queueDragged = false;
  private suppressQueueClickUntil = 0;
  private latestReadModel: ColonyReadModel | null = null;
  private puzzle: PuzzleFrames | null = null;
  private produce: PuzzleFrames | null = null;
  private squareTile: SpriteFrame | null = null;
  private squareSpan = 560;
  private stackTile: SpriteFrame | null = null;
  private stackChain: SpriteFrame | null = null;
  private readonly animationWaits = new Set<() => void>();
  private readonly originalSlotX: number[];
  private readonly puzzleCells = new Map<string, Readonly<{ row: number; column: number }>>();

  public constructor(
    private readonly boardRoot: Node,
    private readonly slotRoot: Node,
    private readonly fixedSlots: readonly Node[],
    private readonly stackFrame: SpriteFrame,
    private readonly cellFrame: SpriteFrame,
    private readonly stackRoot: Node,
    private readonly selectStack: (stackId: string) => void,
  ) { this.originalSlotX = fixedSlots.map(slot => slot.position.x); }

  public setStackTile(frame: SpriteFrame | null): void { this.stackTile = frame; }
  public setStackChain(frame: SpriteFrame | null): void { this.stackChain = frame; }

  /** Set the theme image and the full CSV grid before reset; null restores plain cells. */
  public setPuzzle(
    frame: SpriteFrame | null,
    rows: number,
    columns: number,
    cells: readonly Readonly<{ id: string; row: number; column: number }>[],
    produceFrame: SpriteFrame | null = null,
  ): void {
    this.puzzle?.dispose(); this.produce?.dispose();
    this.squareTile = null;
    this.puzzle = frame ? new PuzzleFrames(frame, rows, columns) : null;
    this.produce = produceFrame ? new PuzzleFrames(produceFrame, rows, columns) : null;
    this.puzzleCells.clear();
    if (!this.puzzle) return;
    for (const cell of cells) {
      if (this.puzzleCells.has(cell.id)) throw new Error(`Duplicate puzzle cell ${cell.id}`);
      this.puzzle.piece(cell.row, cell.column);
      this.puzzleCells.set(cell.id, { row: cell.row, column: cell.column });
    }
  }

  public setSquareTile(frame: SpriteFrame, span = 560): void {
    this.puzzle?.dispose(); this.produce?.dispose();
    this.puzzle = null;
    this.produce = null;
    this.puzzleCells.clear();
    this.squareTile = frame;
    this.squareSpan = span;
  }

  /** Return the exact cell image even after its board node has been cleared. */
  public pieceForCell(cellId: string): SpriteFrame | null {
    const cell = this.puzzleCells.get(cellId);
    return cell ? (this.produce ?? this.puzzle)?.piece(cell.row, cell.column) ?? null : null;
  }

  /** 按 ReadModel 重建棋盘、槽位与数字组。 */
  public reset(readModel: ColonyReadModel): void {
    this.recycle();
    this.displaySlots = readModel.snapshot.slots.map(() => null);
    this.createBoard(readModel);
    this.createSlots(readModel.snapshot.slots.length);
    this.createStacks(readModel);
  }

  /** 回收全部表现节点并重置瞬态。 */
  public recycle(): void {
    for (const node of this.cellNodes.values()) this.cellPool.put(node);
    for (const node of this.stackNodes.values()) this.stackPool.put(node);
    for (const [index, node] of this.fixedSlots.entries()) {
      Tween.stopAllByTarget(node);
      node.active = false;
      node.setScale(Vec3.ONE);
      node.setPosition(this.originalSlotX[index]!, node.position.y, 0);
      for (const child of [...node.children]) this.slotTokenPool.put(child);
      const sprite = node.getComponent(Sprite);
      if (sprite) sprite.enabled = false;
    }
    this.cellNodes.clear();
    this.stackNodes.clear();
    this.slotNodes = [];
    this.displaySlots = [];
    this.slotTokens = [];
    this.moving.clear();
    this.movingStackAnimations = 0;
    if (this.stackRootOriginalSiblingIndex !== null && this.stackRoot.parent) {
      this.stackRoot.setSiblingIndex(Math.min(this.stackRootOriginalSiblingIndex, this.stackRoot.parent.children.length - 1));
      this.stackRootOriginalSiblingIndex = null;
    }
    this.geometryValue = null;
    this.latestReadModel = null;
    this.stackRoot.targetOff(this);
    for (const finish of [...this.animationWaits]) finish();
  }

  private wait(animation: Tween<Node>, complete?: () => void): Promise<void> {
    return new Promise(resolve => {
      const finish = (): void => { this.animationWaits.delete(finish); resolve(); };
      this.animationWaits.add(finish); animation.call(() => { try { complete?.(); } finally { finish(); } }).start();
    });
  }

  /** 应用入槽选择事件，刷新槽位与数字组。 */
  public applySelection(events: readonly ObservableEvent[], readModel: ColonyReadModel): void {
    const slot = events.find((event) => event.phase === 'SLOT');
    if (slot?.slotIndex !== undefined && slot.color && slot.remaining !== undefined && slot.stackId) {
      this.displaySlots[slot.slotIndex] = {
        stackId: slot.stackId,
        color: slot.color,
        remaining: slot.remaining,
      };
      this.renderSlots();
    }
    this.renderStacks(readModel, true);
  }

  /** 应用 COUNT/RELEASE，刷新计数、数字组与暴露态。 */
  public applyCounts(events: readonly ObservableEvent[], readModel: ColonyReadModel): void {
    for (const event of events) {
      if (event.phase === 'COUNT' && event.slotIndex !== undefined && event.remaining !== undefined) {
        const occupant = this.displaySlots[event.slotIndex];
        if (occupant) occupant.remaining = Math.min(occupant.remaining, event.remaining);
      }
      if (event.phase === 'RELEASE' && event.slotIndex !== undefined) {
        this.displaySlots[event.slotIndex] = null;
      }
    }
    this.renderSlots();
    this.renderStacks(readModel);
    this.renderExposure(readModel);
  }

  /** 扩槽后重建槽位锚点。 */
  public addExtraSlot(readModel: ColonyReadModel): void {
    this.slotNodes = [];
    while (this.displaySlots.length < readModel.snapshot.slots.length) this.displaySlots.push(null);
    this.createSlots(readModel.snapshot.slots.length);
    this.renderStacks(readModel);
  }

  /** 标记数字组是否处于入槽移动中。 */
  public markMoving(stackId: string, value: boolean): void {
    if (value) this.moving.add(stackId);
    else this.moving.delete(stackId);
  }

  /** Reuse locked feedback without selecting, moving or changing the model. */
  public shakeStack(stackId: string): void {
    const node = this.stackNodes.get(stackId);
    if (!node?.isValid || this.moving.has(stackId)) return;
    Tween.stopAllByTarget(node); node.angle = 0;
    tween(node).to(0.04, { angle: -6 }).to(0.06, { angle: 6 })
      .to(0.06, { angle: -4 }).to(0.08, { angle: 0 }).start();
  }

  /** 将数字组节点缓动到目标暂存槽并回收。 */
  public async moveStackToSlot(stackId: string, slotIndex: number): Promise<void> {
    const stack = this.stackNodes.get(stackId);
    const slot = this.slotNodes[slotIndex];
    if (!stack || !slot) return;
    Tween.stopAllByTarget(stack);
    stack.angle = 0;
    this.raiseStackFlight(stack);
    const target = this.stackRoot.getComponent(UITransform)?.convertToNodeSpaceAR(slot.worldPosition) ?? slot.position;
    try {
      await this.wait(tween(stack)
          .to(0.16, { position: target, scale: new Vec3(0.9, 0.9, 1) })
        , () => { this.stackNodes.delete(stackId); this.stackPool.put(stack); }
      );
    } finally {
      this.finishStackFlight();
    }
  }

  /** 暂存槽入驻缩放反馈。 */
  public async pulseSlot(slotIndex: number): Promise<void> {
    const slot = this.slotNodes[slotIndex];
    if (!slot?.isValid) return;
    await this.wait(tween(slot)
        .to(0.09, { scale: new Vec3(1.16, 1.16, 1) })
        .to(0.11, { scale: Vec3.ONE })
        .delay(0.5)
    );
  }

  /** 棋盘格清除缩放动画后回收节点。 */
  public async clearCell(cellId: string): Promise<void> {
    const cell = this.cellNodes.get(cellId);
    if (!cell?.parent) return;
    await this.wait(tween(cell)
        .to(0.07, { scale: new Vec3(1.22, 1.22, 1) })
        .to(0.09, { scale: new Vec3(0.35, 0.35, 1) })
      , () => { this.cellNodes.delete(cellId); this.cellPool.put(cell); }
    );
  }

  /** 槽位世界坐标，供蚂蚁出生点使用。 */
  public getSlotWorldPosition(index: number): Readonly<Vec3> {
    return this.slotNodes[index]?.worldPosition ?? Vec3.ZERO;
  }

  /** 当前棋盘几何；未 reset 时为 null。 */
  public get geometry(): BoardGeometry | null {
    return this.geometryValue;
  }

  /** 活跃棋盘/数字组/槽位节点计数。 */
  public get pooledCount(): number {
    return this.cellNodes.size + this.stackNodes.size + this.slotNodes.length;
  }

  /** 创建棋盘格节点并设置暴露高亮。 */
  private createBoard(readModel: ColonyReadModel): void {
    const geometry = deriveBoardGeometry(readModel.snapshot.board, this.squareTile ? this.squareSpan : undefined);
    this.geometryValue = geometry;
    const cellSize = geometry.cellSize;
    for (const cell of readModel.snapshot.board) {
      const { x, y } = geometry.toPosition(cell.row, cell.column);
      const size = this.squareTile ? cellSize - 2 : cellSize;
      const node = this.factory.acquire(this.cellPool, cell.id, x, y, size, size, this.boardRoot);
      const puzzleFrame = this.pieceForCell(cell.id);
      if (this.puzzle && !puzzleFrame) throw new Error(`Puzzle image has no cell ${cell.id}`);
      const color = colonyColor(cell.color);
      this.factory.token(node, this.produce
        ? new Color(Math.round(166 + color.r * 0.35), Math.round(166 + color.g * 0.35), Math.round(166 + color.b * 0.35))
        : color, this.squareTile ?? puzzleFrame ?? this.cellFrame);
      let picture = node.getChildByName('ProducePicture');
      if (this.produce) {
        if (!picture) {
          picture = new Node('ProducePicture');
          picture.layer = node.layer;
          picture.setParent(node);
          picture.addComponent(UITransform);
          picture.addComponent(Sprite);
        }
        picture.active = true;
        picture.getComponent(UITransform)!.setContentSize(cellSize, cellSize);
        this.factory.token(picture, Color.WHITE, this.produce.piece(cell.row, cell.column));
      } else if (picture) picture.active = false;
      this.cellNodes.set(cell.id, node);
    }
    this.renderExposure(readModel);
  }

  /** 激活 Prefab 序列化的固定槽位锚点。 */
  private createSlots(count: number): void {
    this.fixedSlots.forEach((slot, index) => { slot.active = index < count; });
    for (let index = 0; index < count; index += 1) {
      const slot = this.fixedSlots[index];
      if (!slot) throw new Error(`Slot Prefab is missing serialized slot ${index + 1}`);
      slot.name = `HoldingSlot${index + 1}`;
      slot.active = true;
      slot.setParent(this.slotRoot);
      const squareX = count === 5 ? [-228, -114, 0, 114, 228] : [-280, -168, -56, 56, 168, 280];
      slot.setPosition(this.stackTile ? squareX[index]! : this.originalSlotX[index]!, slot.position.y, 0);
      slot.setScale(Vec3.ONE);
      const sprite = slot.getComponent(Sprite);
      if (sprite) sprite.enabled = true;
      this.slotNodes.push(slot);
    }
    this.renderSlots();
  }

  /** 创建可点击数字组并绑定选取回调。 */
  private createStacks(readModel: ColonyReadModel): void {
    const stacks = [...readModel.snapshot.stacks].sort((left, right) => right.depth - left.depth);
    const heads = stackPileHeads(stacks);
    for (const stack of stacks) {
      const position = stackPilePosition(stack, stacks, heads);
      const node = this.factory.acquire(
        this.stackPool,
        `stack-${stack.id}`,
        position.x,
        position.y,
        this.stackTile ? 100 : 82,
        this.stackTile ? 100 : 94,
        this.stackRoot,
      );
      this.factory.token(node, colonyColor(stack.color), this.stackTile ?? this.stackFrame);
      this.factory.bindButton(node, this, () => {
        if (Date.now() < this.suppressQueueClickUntil) return;
        const current = this.latestReadModel?.snapshot.stacks.find(value => value.id === stack.id);
        if (!current?.accessible) {
          this.shakeStack(stack.id); return;
        }
        this.selectStack(stack.id);
      });
      const label = node.getComponentInChildren(Label)
        ?? this.factory.label(String(stack.count), node, 82, 38, 31, Color.WHITE);
      label.string = String(stack.count);
      label.color = ['white', 'cream', 'yellow', 'gold', 'orange', 'citrus'].includes(stack.color) ? new Color('#493F53') : Color.WHITE;
      if (this.stackChain && !node.getChildByName('UnlockHint')) {
        const hint = new Node('UnlockHint'); hint.layer = node.layer; hint.parent = node;
        hint.addComponent(UITransform).setContentSize(80, 80);
        this.factory.token(hint, Color.WHITE, this.stackChain);
      }
      label.node.setSiblingIndex(node.children.length - 1);
      this.stackNodes.set(stack.id, node);
    }
    this.bindQueueScroll(stacks);
    this.renderStacks(readModel);
  }

  private bindQueueScroll(stacks: ColonyReadModel['snapshot']['stacks']): void {
    this.queueOffset = 0;
    this.queueMaxOffset = Math.max(0, Math.max(0, ...stacks.map(stack => stack.depth)) * 104 - 100);
    this.stackRoot.targetOff(this);
    this.stackRoot.on(Node.EventType.TOUCH_START, (event: EventTouch) => {
      this.queueTouchY = event.getUILocation().y;
      this.queueDragged = false;
    }, this);
    this.stackRoot.on(Node.EventType.TOUCH_MOVE, (event: EventTouch) => {
      const y = event.getUILocation().y;
      const delta = y - this.queueTouchY;
      this.queueTouchY = y;
      if (Math.abs(delta) > 1) this.queueDragged = true;
      this.queueOffset = Math.max(0, Math.min(this.queueMaxOffset, this.queueOffset + delta));
      const current = this.latestReadModel;
      if (current) this.renderStacks(current);
    }, this);
    const end = (): void => {
      if (this.queueDragged) this.suppressQueueClickUntil = Date.now() + 180;
      this.queueDragged = false;
    };
    this.stackRoot.on(Node.EventType.TOUCH_END, end, this);
    this.stackRoot.on(Node.EventType.TOUCH_CANCEL, end, this);
  }

  /** 按 displaySlots 绘制槽内色块与剩余计数。 */
  private renderSlots(): void {
    this.slotNodes.forEach((node, index) => {
      const occupant = this.displaySlots[index];
      const cached = this.slotTokens[index];
      const frame = this.stackTile ?? this.stackFrame;
      if (occupant && cached?.node.isValid && cached.label.isValid && cached.node.parent === node && cached.node.active
        && cached.stackId === occupant.stackId && cached.color === occupant.color && cached.frame === frame) {
        if (cached.remaining !== occupant.remaining) { cached.label.string = String(occupant.remaining); cached.remaining = occupant.remaining; }
        return;
      }
      for (const child of [...node.children]) this.slotTokenPool.put(child);
      this.slotTokens[index] = null;
      if (!occupant) return;
      const token = this.factory.acquire(this.slotTokenPool, `slot-token-${index}`, 0, 0, 80, 80, node);
      this.factory.token(token, colonyColor(occupant.color), frame);
      const label = token.getComponentInChildren(Label)
        ?? this.factory.label(String(occupant.remaining), token, 76, 34, 28, Color.WHITE);
      label.string = String(occupant.remaining);
      label.color = ['white', 'cream', 'yellow', 'gold', 'orange', 'citrus'].includes(occupant.color) ? new Color('#493F53') : Color.WHITE;
      this.slotTokens[index] = { node: token, label, stackId: occupant.stackId, color: occupant.color, remaining: occupant.remaining, frame };
    });
  }

  /** 按可取状态刷新数字组可交互与外观。 */
  private renderStacks(readModel: ColonyReadModel, animateReflow = false): void {
    this.latestReadModel = readModel;
    const stacks = new Map(readModel.snapshot.stacks.map((stack) => [stack.id, stack]));
    const heads = stackPileHeads(readModel.snapshot.stacks);
    for (const [stackId, node] of this.stackNodes) {
      const stack = stacks.get(stackId);
      if (!stack) continue;
      if (this.moving.has(stackId)) {
        const button = node.getComponent(Button);
        if (button) button.interactable = false;
        continue;
      }
      if (stack.selected) {
        if (node.active) node.active = false;
        continue;
      }
      const position = stackPilePosition(stack, readModel.snapshot.stacks, heads);
      const y = position.y + this.queueOffset;
      const visible = this.stackTile ? y >= -260 && y <= 64 : y >= -112 && y <= 112;
      if (node.active !== visible) node.active = visible;
      const target = new Vec3(position.x, y, 0);
      if (animateReflow && Vec3.distance(node.position, target) > 1) {
        Tween.stopAllByTarget(node);
        node.angle = 0;
        tween(node).to(0.26, { position: target }, { easing: 'quadOut' }).start();
      } else {
        node.setPosition(target);
      }
      const label = node.getComponentInChildren(Label);
      if (label) label.string = String(stack.count);
      const button = node.getComponent(Button);
      const enabled = stack.accessible && !this.moving.has(stackId);
      if (button) { button.interactable = true; button.transition = enabled ? Button.Transition.SCALE : Button.Transition.NONE; }
      node.setScale(Vec3.ONE);
      const sprite = node.getComponent(Sprite);
      const color = colonyColor(stack.color);
      if (sprite) sprite.color = color;
      const hint = node.getChildByName('UnlockHint');
      if (hint) hint.active = Boolean(this.stackTile && !enabled);
    }
  }

  /** 放大高亮当前暴露格。 */
  private renderExposure(readModel: ColonyReadModel): void {
    const exposed = new Set(readModel.snapshot.exposedCellIds);
    for (const [cellId, node] of this.cellNodes) {
      const scale = exposed.has(cellId) ? (this.squareTile ? 1.03 : 1.08) : 1;
      if (node.scale.x !== scale || node.scale.y !== scale) node.setScale(scale, scale, 1);
    }
  }

  /** 抬高槽位飞行动画的整层与选中块，确保它盖在棋盘和蚂蚁上方。 */
  private raiseStackFlight(stack: Node): void {
    const parent = this.stackRoot.parent;
    if (parent) {
      if (this.stackRootOriginalSiblingIndex === null) this.stackRootOriginalSiblingIndex = this.stackRoot.getSiblingIndex();
      this.stackRoot.setSiblingIndex(parent.children.length - 1);
    }
    stack.setSiblingIndex(this.stackRoot.children.length - 1);
    this.movingStackAnimations += 1;
  }

  private finishStackFlight(): void {
    this.movingStackAnimations = Math.max(0, this.movingStackAnimations - 1);
    if (this.movingStackAnimations !== 0 || this.stackRootOriginalSiblingIndex === null) return;
    const parent = this.stackRoot.parent;
    if (parent) this.stackRoot.setSiblingIndex(Math.min(this.stackRootOriginalSiblingIndex, parent.children.length - 1));
    this.stackRootOriginalSiblingIndex = null;
  }
}

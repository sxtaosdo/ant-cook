import { Button, Color, EventTouch, Graphics, Label, Node, Sprite, SpriteFrame, tween, Tween, UIOpacity, UITransform, Vec3 } from 'cc';
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
  private readonly zeroExits = new Map<Node, { stackId: string; generation: number; sequence: number }>();
  private visualGeneration = 0;
  private zeroExitSequence = 0;
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
  private cancelEntrance: (() => void) | null = null;

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

  /** A single visual clock lifts the new board in a wave, then lands every cell exactly in place. */
  public animateEntrance(): Promise<void> {
    this.cancelEntrance?.();
    if (this.disposed || !this.boardRoot.isValid || !this.cellNodes.size || !this.geometryValue) return Promise.resolve();
    const geometry = this.geometryValue;
    const center = geometry.toPosition((geometry.minRow + geometry.maxRow) / 2, (geometry.minColumn + geometry.maxColumn) / 2);
    const radius = Math.max(geometry.cellSize, Math.hypot(geometry.maxColumn - geometry.minColumn, geometry.maxRow - geometry.minRow) * geometry.cellSize / 2);
    const cells = [...this.cellNodes.values()].map(node => ({
      node, position: node.position.clone(), scale: node.scale.clone(), angle: node.angle,
      opacity: node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity),
      delay: Math.min(1, Math.hypot(node.position.x - center.x, node.position.y - center.y) / radius) * 0.34,
      lift: Math.min(76, Math.max(38, geometry.cellSize * 2.4)),
    }));
    const panels = [this.slotRoot, this.stackRoot].map(node => ({
      node, opacity: node.getComponent(UIOpacity) ?? node.addComponent(UIOpacity),
    }));
    const originals = [...cells, ...panels].map(entry => ({ opacity: entry.opacity, value: entry.opacity.opacity }));
    const effects: Node[] = [];
    const effect = (name: string): { node: Node; graphics: Graphics; opacity: UIOpacity } => {
      const node = new Node(name); effects.push(node);
      node.layer = this.boardRoot.layer; node.parent = this.boardRoot;
      node.addComponent(UITransform).setContentSize(radius * 2 + 100, radius * 2 + 100);
      return { node, graphics: node.addComponent(Graphics), opacity: node.addComponent(UIOpacity) };
    };
    const shadows = effect('BoardArrivalShadows');
    shadows.node.setSiblingIndex(0);
    shadows.graphics.fillColor = new Color(64, 42, 24, 24);
    for (const cell of cells) shadows.graphics.ellipse(cell.position.x, cell.position.y - geometry.cellSize * 0.24, geometry.cellSize * 0.38, geometry.cellSize * 0.12);
    shadows.graphics.fill(); // Draw once; only the layer's opacity changes during flight.
    const halo = effect('BoardArrivalRipple');
    halo.node.setPosition(center.x, center.y); halo.node.setSiblingIndex(1);
    halo.graphics.lineWidth = 2;
    halo.graphics.strokeColor = new Color(255, 225, 154, 255);
    halo.graphics.circle(0, 0, radius * 0.82); halo.graphics.stroke();
    const clock = { time: 0 };
    const generation = this.visualGeneration;
    return new Promise(resolve => {
      let finished = false;
      const finish = (): void => {
        if (finished) return;
        finished = true;
        Tween.stopAllByTarget(clock);
        for (const cell of cells) if (cell.node.isValid) {
          cell.node.setPosition(cell.position); cell.node.setScale(cell.scale); cell.node.angle = cell.angle;
        }
        for (const original of originals) if (original.opacity.isValid) original.opacity.opacity = original.value;
        for (const node of effects) if (node.isValid) node.destroy();
        if (this.cancelEntrance === finish) this.cancelEntrance = null;
        resolve();
      };
      this.cancelEntrance = finish;
      const smooth = (value: number): number => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
      const update = (): void => {
        if (this.disposed || generation !== this.visualGeneration || !this.boardRoot.isValid) { finish(); return; }
        const time = clock.time;
        for (const cell of cells) {
          if (!cell.node.isValid) continue;
          const age = Math.max(0, Math.min(0.84, time - cell.delay));
          let height = 0, squash = 0;
          if (age < 0.30) height = cell.lift * (1 - Math.pow(1 - age / 0.30, 3));
          else if (age < 0.38) height = cell.lift;
          else if (age < 0.62) height = cell.lift * (1 - Math.pow((age - 0.38) / 0.24, 2));
          else if (age < 0.70) squash = Math.sin((age - 0.62) / 0.08 * Math.PI) * 0.10;
          else height = Math.sin((age - 0.70) / 0.14 * Math.PI) * 4 * (1 - (age - 0.70) / 0.14);
          const appear = smooth(age / 0.16), lift = height / cell.lift;
          const scale = (0.48 + 0.52 * appear) * (1 + lift * 0.055);
          cell.node.setPosition(cell.position.x, cell.position.y + height, cell.position.z);
          cell.node.setScale(cell.scale.x * scale * (1 + squash), cell.scale.y * scale * (1 - squash), cell.scale.z);
          cell.node.angle = cell.angle + Math.sin(cell.position.x * 0.035 + cell.position.y * 0.017) * lift * 3;
          cell.opacity.opacity = Math.round(255 * appear);
        }
        for (const panel of panels) if (panel.node.isValid) panel.opacity.opacity = Math.round(255 * smooth((time - 0.32) / 0.32));
        shadows.opacity.opacity = Math.round(46 * smooth(time / 0.16) * (1 - smooth((time - 0.62) / 0.50)));
        const wave = smooth(time / 1.18);
        halo.node.setScale(0.08 + wave * 1.20, 0.08 + wave * 1.20, 1);
        halo.opacity.opacity = Math.round(100 * Math.sin(Math.PI * wave) * (1 - wave));
      };
      update();
      tween(clock).to(1.18, { time: 1.18 }, { onUpdate: update }).call(finish).start();
    });
  }

  /** 回收全部表现节点并重置瞬态。 */
  public recycle(): void {
    this.cancelEntrance?.();
    ++this.visualGeneration;
    for (const token of this.zeroExits.keys()) {
      Tween.stopAllByTarget(token);
      this.slotTokenPool.put(token);
    }
    this.zeroExits.clear();
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
    for (const slot of events.filter(event => event.phase === 'SLOT')) {
    if (slot.slotIndex !== undefined && slot.color && slot.remaining !== undefined && slot.stackId) {
      this.displaySlots[slot.slotIndex] = {
        stackId: slot.stackId,
        color: slot.color,
        remaining: slot.remaining,
      };
      this.renderSlots();
    }
    }
    this.renderStacks(readModel, true);
  }

  /** 应用 COUNT/RELEASE，刷新计数、数字组与暴露态。 */
  public applyCounts(events: readonly ObservableEvent[], readModel: ColonyReadModel): void {
    for (const event of events) {
      if (event.phase === 'COUNT' && event.slotIndex !== undefined && event.remaining !== undefined) {
        const occupant = this.displaySlots[event.slotIndex];
        if (occupant && occupant.stackId === event.stackId) occupant.remaining = Math.min(occupant.remaining, event.remaining);
      }
      if (event.phase === 'RELEASE' && event.slotIndex !== undefined) {
        const occupant = this.displaySlots[event.slotIndex];
        if (!occupant || occupant.stackId !== event.stackId) continue;
        this.exitZeroToken(event.slotIndex, occupant.stackId);
        this.displaySlots[event.slotIndex] = null;
      }
    }
    this.renderSlots();
    this.renderStacks(readModel);
    this.renderExposure(readModel);
  }

  /** Business release already happened; this detached view can only return itself to the pool. */
  private exitZeroToken(index: number, stackId: string): void {
    const cached = this.slotTokens[index];
    if (!cached?.node.isValid || !cached.label.isValid || cached.stackId !== stackId) return;
    const token = cached.node;
    this.slotTokens[index] = null;
    Tween.stopAllByTarget(token);
    cached.label.string = '0';
    token.setParent(this.slotRoot, true);
    const scale = token.scale.clone();
    const identity = { stackId, generation: this.visualGeneration, sequence: ++this.zeroExitSequence };
    this.zeroExits.set(token, identity);
    tween(token).to(0.10, { scale: new Vec3(scale.x * 1.12, scale.y * 1.12, scale.z) })
      .to(0.16, { scale: new Vec3(0, 0, scale.z) })
      .call(() => {
        if (this.disposed || !token.isValid || identity.generation !== this.visualGeneration
          || this.zeroExits.get(token) !== identity) return;
        this.zeroExits.delete(token);
        this.slotTokenPool.put(token);
      }).start();
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
      let keyBadge = node.getChildByName('KeyBadge');
      if (cell.keyId && !keyBadge) { keyBadge = this.factory.label('钥', node, cellSize, cellSize, Math.max(12, Math.min(20, cellSize * 0.65)), Color.WHITE).node; keyBadge.name = 'KeyBadge'; }
      if (keyBadge) keyBadge.active = Boolean(cell.keyId);
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
      if (keyBadge) keyBadge.setSiblingIndex(node.children.length - 1);
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
      const position = stackPilePosition(stack, stacks, heads, readModel.snapshot.queueColumns);
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
        if (Date.now() < this.suppressQueueClickUntil || this.moving.has(stack.id)) return;
        const current = this.latestReadModel?.snapshot.stacks.find(value => value.id === stack.id);
        if (!current || current.selected) return;
        // The command boundary explains locked, covered and capacity refusals.
        this.selectStack(stack.id);
      });
      const label = node.getChildByName('StackCountLabel')?.getComponent(Label)
        ?? this.factory.label(String(stack.count), node, 82, 38, 31, Color.WHITE);
      label.node.name = 'StackCountLabel';
      label.overflow = Label.Overflow.SHRINK;
      label.string = stack.mystery && !stack.revealed ? '?' : String(stack.count);
      label.color = ['white', 'cream', 'yellow', 'gold', 'orange', 'citrus'].includes(stack.color) ? new Color('#493F53') : Color.WHITE;
      if (this.stackChain && !node.getChildByName('UnlockHint')) {
        const hint = new Node('UnlockHint'); hint.layer = node.layer; hint.parent = node;
        hint.addComponent(UITransform).setContentSize(80, 80);
        this.factory.token(hint, Color.WHITE, this.stackChain);
      }
      for (const [name, text, show] of [['LinkBadge', '连', Boolean(stack.linkId)], ['LockBadge', '锁', Boolean(stack.locked)]] as const) {
        let badge = node.getChildByName(name);
        if (!badge && show) { badge = this.factory.label(text, node, 26, 26, 17, Color.WHITE).node; badge.name = name; badge.setPosition(name === 'LinkBadge' ? -30 : 30, 30); }
        if (badge) badge.active = show;
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
      const position = stackPilePosition(stack, readModel.snapshot.stacks, heads, readModel.snapshot.queueColumns);
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
      const label = node.getChildByName('StackCountLabel')?.getComponent(Label);
      if (label) { label.color = stack.mystery && !stack.revealed ? Color.WHITE : ['white', 'cream', 'yellow', 'gold', 'orange', 'citrus'].includes(stack.color) ? new Color('#493F53') : Color.WHITE; }
      if (label) label.string = stack.mystery && !stack.revealed ? '?' : String(stack.count);
      const button = node.getComponent(Button);
      const enabled = stack.accessible && !this.moving.has(stackId);
      if (button) { button.interactable = true; button.transition = enabled ? Button.Transition.SCALE : Button.Transition.NONE; }
      node.setScale(Vec3.ONE);
      const sprite = node.getComponent(Sprite);
      const color = stack.mystery && !stack.revealed ? new Color('#6D777A') : colonyColor(stack.color);
      if (sprite) sprite.color = color;
      const lockBadge = node.getChildByName('LockBadge');
      if (lockBadge) lockBadge.active = Boolean(stack.locked);
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

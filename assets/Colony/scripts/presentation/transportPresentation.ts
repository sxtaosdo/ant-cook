import { Color, Node, Sprite, SpriteFrame, tween, Tween, UIOpacity, UITransform, Vec3 } from 'cc';
import type { GameColor, RoutePoint } from '../gameModel';
import { colonyColor } from './colonyColors';
import type { BoardGeometry } from './boardGeometry';
import { NodeFactory } from './nodeFactory';

const BACKGROUND_HOLE_Y = -218;

/** 蚂蚁搬运过程的可观测计数。 */
export interface TransportEvidence {
  movementScale: number;
  boostMultiplier: number;
  movingWorkers: number;
  outboundCrawls: number;
  returnsToHole: number;
  activeWorkers: number;
  maxConcurrentColors: number;
  spawnedByColor: Partial<Record<GameColor, number>>;
}

/** 蚂蚁搬运动画：沿路线爬行、清除格子、携货返回洞口。 */
export class TransportPresentation {
  private disposed = false;
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    this.factory.dispose();
  }
  private readonly factory = new NodeFactory();
  private readonly workerPool = this.factory.pool('ant-worker');
  private readonly cargoPool = this.factory.pool('carried-food');
  private readonly activeByColor: Partial<Record<GameColor, number>> = {};
  private evidenceValue: TransportEvidence = this.emptyEvidence();
  private geometry: BoardGeometry | null = null;
  private resolveCargoFrame: ((cellId: string) => SpriteFrame | null) | null = null;
  private squareTile: SpriteFrame | null = null;
  private movementScale = 1;
  private boostMultiplier = 1;
  private readonly movementTweens = new Set<Tween<Node>>();
  private readonly waits = new Set<() => void>();
  private epoch = 0;

  public constructor(
    private readonly root: Node,
    private readonly boardRoot: Node,
    private readonly antFrame: SpriteFrame | null,
    private readonly cellFrame: SpriteFrame,
  ) {}

  public configureMovement(mode: 'main' | 'daily', level: number): void {
    this.movementScale = mode === 'main' && level === 1 ? 1 : 1.6;
  }
  public setSpeedMultiplier(multiplier: 1 | 2 | 3): void {
    if (this.boostMultiplier === multiplier) return;
    this.boostMultiplier = multiplier;
    for (const movement of this.movementTweens) movement.timeScale(multiplier);
  }
  public get moving(): boolean { return this.movementTweens.size > 0; }

  /** Use the board's cached slice for each MOVE cellId; null keeps the plain cargo token. */
  public setPuzzle(resolveCellFrame: ((cellId: string) => SpriteFrame | null) | null): void {
    this.resolveCargoFrame = resolveCellFrame;
    this.squareTile = null;
  }

  public setSquareTile(frame: SpriteFrame): void {
    this.resolveCargoFrame = null;
    this.squareTile = frame;
  }

  /** 停止动画并回收全部 worker/cargo。 */
  public reset(): void {
    this.epoch++;
    this.movementTweens.clear();
    this.boostMultiplier = 1;
    this.evidenceValue = this.emptyEvidence();
    for (const color of Object.keys(this.activeByColor) as GameColor[]) delete this.activeByColor[color];
    for (const child of [...this.root.children]) {
      Tween.stopAllByTarget(child);
      for (const cargo of [...child.children]) this.cargoPool.put(cargo);
      this.workerPool.put(child);
    }
    this.geometry = null;
    for (const finish of [...this.waits]) finish();
  }

  /** 绑定棋盘几何，用于路线坐标换算。 */
  public setBoardGeometry(geometry: BoardGeometry): void {
    this.geometry = geometry;
  }

  /** 记录本轮派发的出生颜色（证据用）。 */
  public recordSpawn(colors: ReadonlySet<GameColor>): void {
    for (const color of colors) {
      this.evidenceValue.spawnedByColor[color] = (this.evidenceValue.spawnedByColor[color] ?? 0) + 1;
    }
  }

  /** 播放单只蚂蚁：出洞→目标格→回洞，并回调清除/完成。 */
  public async animate(
    color: GameColor,
    cellId: string,
    slotWorldPosition: Readonly<Vec3>,
    route: readonly RoutePoint[],
    generationCurrent: () => boolean,
    clearCell: (cellId: string) => Promise<void>,
    complete: (cellId: string) => void,
  ): Promise<void> {
    const geometry = this.geometry;
    if (!geometry) return;
    const slotPosition = this.root.getComponent(UITransform)?.convertToNodeSpaceAR(slotWorldPosition) ?? Vec3.ZERO;
    const worker = this.factory.acquire(
      this.workerPool,
      `ant-${color}`,
      slotPosition.x,
      slotPosition.y + 18,
      34,
      51,
      this.root,
    );
    const sprite = worker.getComponent(Sprite) ?? worker.addComponent(Sprite);
    sprite.sizeMode = Sprite.SizeMode.CUSTOM;
    sprite.color = colonyColor(color);
    sprite.spriteFrame = this.antFrame;
    this.workerStarted(color);

    const epoch = this.epoch;
    const current = (): boolean => epoch === this.epoch && generationCurrent() && worker.isValid;
    const compressedRoute = this.compress(route);
    const positions = compressedRoute.map((point) => {
      const position = geometry.toPosition(point.row, point.column);
      return this.boardToTransport(new Vec3(position.x, position.y, 0));
    });
    const entry = geometry.entryPosition(compressedRoute[0]!.column);
    await this.move(worker, [this.boardToTransport(new Vec3(entry.x, entry.y, 0))], 280);
    if (!current()) return;
    await this.move(worker, positions.slice(1), 360);
    if (!current()) return;
    this.evidenceValue.outboundCrawls += 1;
    await clearCell(cellId);
    if (!current()) return;
    if (generationCurrent()) complete(cellId);
    this.addCargo(worker, color, cellId);
    await this.move(worker, [...positions].reverse().slice(1), 330);
    if (!current()) return;
    await this.move(worker, [new Vec3(0, BACKGROUND_HOLE_Y, 0)], 330);
    if (!current()) return;
    await this.fade(worker);
    if (!current()) return;
    this.evidenceValue.returnsToHole += 1;
    this.workerFinished(color);
    for (const child of [...worker.children]) this.cargoPool.put(child);
    const opacity = worker.getComponent(UIOpacity);
    if (opacity) opacity.opacity = 255;
    this.workerPool.put(worker);
  }

  /** 当前搬运证据快照。 */
  public get evidence(): Readonly<TransportEvidence> {
    return {
      ...this.evidenceValue,
      movementScale: this.movementScale,
      boostMultiplier: this.boostMultiplier,
      movingWorkers: this.movementTweens.size,
      spawnedByColor: { ...this.evidenceValue.spawnedByColor },
    };
  }

  /** 运输根下活跃节点数。 */
  public get pooledCount(): number {
    return this.root.children.length;
  }

  /** 工人开始：更新并发颜色证据。 */
  private workerStarted(color: GameColor): void {
    this.evidenceValue.activeWorkers += 1;
    this.activeByColor[color] = (this.activeByColor[color] ?? 0) + 1;
    const activeColors = Object.values(this.activeByColor).filter((count) => (count ?? 0) > 0).length;
    this.evidenceValue.maxConcurrentColors = Math.max(this.evidenceValue.maxConcurrentColors, activeColors);
  }

  /** 工人结束：回退活跃计数。 */
  private workerFinished(color: GameColor): void {
    this.evidenceValue.activeWorkers = Math.max(0, this.evidenceValue.activeWorkers - 1);
    this.activeByColor[color] = Math.max(0, (this.activeByColor[color] ?? 1) - 1);
  }

  /** 在蚂蚁身上挂载携带食物节点。 */
  private addCargo(worker: Node, color: GameColor, cellId: string): void {
    const size = this.geometry?.cellSize ?? 28;
    const cargo = this.factory.acquire(this.cargoPool, 'carried-food', 0, size * 0.65, size, size, worker);
    const picture = this.resolveCargoFrame?.(cellId);
    this.factory.token(cargo, picture ? Color.WHITE : colonyColor(color), this.squareTile ?? picture ?? this.cellFrame);
  }

  /** 棋盘本地坐标转换到运输根本地坐标。 */
  private boardToTransport(position: Vec3): Vec3 {
    const world = this.boardRoot.getComponent(UITransform)?.convertToWorldSpaceAR(position) ?? position;
    return this.root.getComponent(UITransform)?.convertToNodeSpaceAR(world) ?? position;
  }

  /** 压缩共线路径点，减少缓动段数。 */
  private compress(route: readonly RoutePoint[]): readonly RoutePoint[] {
    if (route.length <= 2) return route;
    const result = [route[0]!];
    for (let index = 1; index < route.length - 1; index += 1) {
      const previous = route[index - 1]!;
      const current = route[index]!;
      const next = route[index + 1]!;
      const before = { row: current.row - previous.row, column: current.column - previous.column };
      const after = { row: next.row - current.row, column: next.column - current.column };
      if (before.row !== after.row || before.column !== after.column) result.push(current);
    }
    result.push(route.at(-1)!);
    return result;
  }

  /** 按速度沿点列移动并朝向目标。 */
  private async move(worker: Node, points: readonly Vec3[], speed: number): Promise<void> {
    const epoch = this.epoch;
    for (const point of points) {
      if (epoch !== this.epoch) return;
      const distance = Vec3.distance(worker.position, point);
      if (distance < 1) continue;
      const angle = Math.atan2(point.y - worker.position.y, point.x - worker.position.x) * 180 / Math.PI;
      worker.setRotationFromEuler(0, 0, angle - 90);
      await new Promise<void>((resolve) => {
        const finish = (): void => { this.waits.delete(finish); this.movementTweens.delete(movement); resolve(); };
        const movement = tween(worker).to(Math.max(0.07, distance / speed) / this.movementScale, { position: point }).call(() => {
          finish();
        });
        this.waits.add(finish);
        this.movementTweens.add(movement);
        movement.timeScale(this.boostMultiplier).start();
      });
    }
  }

  /** 回洞后淡出蚂蚁。 */
  private async fade(worker: Node): Promise<void> {
    const opacity = worker.getComponent(UIOpacity) ?? worker.addComponent(UIOpacity);
    await new Promise<void>((resolve) => {
      const finish = (): void => { this.waits.delete(finish); resolve(); };
      this.waits.add(finish); tween(opacity).to(0.12, { opacity: 0 }).call(finish).start();
    });
  }

  /** 空证据初值。 */
  private emptyEvidence(): TransportEvidence {
    return {
      movementScale: 1,
      boostMultiplier: 1,
      movingWorkers: 0,
      outboundCrawls: 0,
      returnsToHole: 0,
      activeWorkers: 0,
      maxConcurrentColors: 0,
      spawnedByColor: {},
    };
  }
}

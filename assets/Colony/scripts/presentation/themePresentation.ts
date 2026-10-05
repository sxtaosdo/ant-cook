import { SpriteFrame } from 'cc';
import mk from 'mk';
import type { ColonyReadModel } from '../application/contracts';
import type { themeForLevel } from '../application/operationalLevels';
import type { ColonySceneBootstrap } from '../bootstrap/colonySceneBootstrap';
import type { BoardPresentation } from './boardPresentation';
import type { TransportPresentation } from './transportPresentation';

export function refreshThemeCollection(session: ColonySceneBootstrap, read: ColonyReadModel, target: ReturnType<typeof themeForLevel>): void {
  if (!target || !session.progress) return;
  const items = session.progress.themeBasketProgress()[target.themeIndex]!.items;
  session.hudView!.setTheme(read.currentLevel, target.item.name, target.item.id, items);
}

async function showThemeHud(session: ColonySceneBootstrap, read: ColonyReadModel, target: ReturnType<typeof themeForLevel>, isCurrent: () => boolean): Promise<void> {
  const hud = session.hudView!;
  if (target && session.progress) {
    refreshThemeCollection(session, read, target);
    await hud.showLevelRail(read.currentLevel, target.item.name, target.theme.id, read.snapshot.board.length, read.snapshot.remainingCells, isCurrent);
    if (!isCurrent()) return;
  } else {
    hud.clearTheme();
    await hud.showLevelRail(read.currentLevel, '', 'tropical-fruit', read.snapshot.board.length, read.snapshot.remainingCells, isCurrent, true);
  }
  hud.setFirstLevelSkin(true, read.currentLevel);
  if (session.round?.mode === 'daily') hud.setDailyChallenge(read.snapshot.board.length, read.snapshot.remainingCells);
  hud.setResources(session.progress?.snapshot().coins ?? 0, session.progress?.snapshot().diamonds ?? 0);
  hud.setFeedback(session.round?.mode === 'daily' ? '每日挑战 · 免费无限重试'
    : '');
}

/** Every main and daily board uses the approved first-level presentation. */
async function showThemeLevel(
  session: ColonySceneBootstrap,
  board: BoardPresentation,
  transport: TransportPresentation,
  isCurrent: () => boolean,
  level: number,
): Promise<void> {
  const boardView = session.boardView!;
  const hudView = session.hudView!;
  const span = session.round?.mode === 'main' && [2, 6, 7].includes(level) ? 520 : 560;
  const loadFrame = async (path: string): Promise<SpriteFrame> => {
    const frame = await mk.asset.get(`db://${path}`, SpriteFrame, boardView.node);
    if (!isCurrent()) throw new Error('Theme presentation superseded');
    if (!frame) throw new Error(`Missing theme image: ${path}`);
    return frame;
  };
  try {
    const [cellFrame, backgroundFrame, slotFrame, cardFrame] = await Promise.all([
      loadFrame('assets/Colony/art/toy-market/ui/r04/gameplay/cargo-cell.png'),
      loadFrame('assets/Colony/art/toy-market/ui/r04/gameplay/scene-bg-750x1667.png'),
      loadFrame('assets/Colony/art/toy-market/ui/r04/gameplay/empty-slot.png'),
      loadFrame('assets/Colony/art/toy-market/ui/r07/number-card-neutral.png'),
    ]);
    if (!isCurrent()) return;
    board.setSquareTile(cellFrame, span);
    transport.setSquareTile(cellFrame);
    boardView.setFirstLevelSkin(backgroundFrame);
    session.slotView!.setFirstLevelSkin(slotFrame);
    session.toolBarView!.setFirstLevelSkin(true);
    board.setStackTile(cardFrame);
    board.setStackChain(session.stackChainFrame);
    hudView.setThemeCollected(null);
  } catch (error) {
    if (!isCurrent()) return;
    console.error('Failed to load gameplay art; using serialized cell visuals', error);
    board.setSquareTile(session.cellFrame!, span);
    transport.setSquareTile(session.cellFrame!);
    boardView.setThemeLayers(null);
    hudView.setThemeCollected(null);
  }
}

/** Complete a page's resource projection only while it still owns these presentations. */
export async function prepareThemePresentation(
  session: ColonySceneBootstrap,
  board: BoardPresentation,
  transport: TransportPresentation,
  read: ColonyReadModel,
  target: ReturnType<typeof themeForLevel>,
  ownsPresentations: () => boolean,
): Promise<void> {
  const generation = session.generation;
  const boardView = session.boardView!;
  const hudView = session.hudView!;
  const slotView = session.slotView!;
  const toolBarView = session.toolBarView!;
  const playRoot = session.playRoot!;
  const stackRoot = session.stackRoot!;
  const transportRoot = session.transportRoot!;
  const isCurrent = (): boolean => !session.destroyed && session.generation === generation && ownsPresentations()
    && session.isValid && session.node.isValid
    && session.boardView === boardView && session.hudView === hudView
    && session.slotView === slotView && session.toolBarView === toolBarView
    && [boardView, hudView, slotView, toolBarView].every(component => component.isValid && component.node.isValid)
    && session.playRoot === playRoot && session.stackRoot === stackRoot && session.transportRoot === transportRoot
    && [playRoot, stackRoot, transportRoot].every(node => node.isValid);
  if (!isCurrent()) return;
  await showThemeHud(session, read, target, isCurrent);
  if (!isCurrent()) return;
  await showThemeLevel(session, board, transport, isCurrent, read.currentLevel);
  if (!isCurrent()) return;
  board.reset(read);
  const geometry = board.geometry;
  if (geometry) transport.setBoardGeometry(geometry);
  session.inputLocked = false;
}

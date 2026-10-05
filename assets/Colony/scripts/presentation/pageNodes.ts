import { instantiate, Node, Prefab, view, Widget } from 'cc';
import mk from 'mk';
import type { ColonySceneBootstrap } from '../bootstrap/colonySceneBootstrap';
import { ColonyUtil } from '../colonyUtil';
import { ColonyBoardView } from '../views/boardView';
import { ColonySlotView } from '../views/slotView';
import { ColonyHudView } from '../views/hudView';
import { ColonyToolBarView } from '../views/toolBarView';
import { ColonyLoadingView } from '../views/loadingView';
import { ColonyConstructionView } from '../views/constructionView';

/** The actual page owns its prefab lease, including late-load cancellation. */
export async function mountPage(session: ColonySceneBootstrap, page: 'loading' | 'playRoot' | 'construction', current: () => boolean): Promise<Node | null> {
  const prefab = await mk.asset.get(`db://assets/Colony/ui/${page}.prefab`, Prefab, null);
  if (session.destroyed || !session.node.isValid || !current()) {
    if (prefab) await mk.Release.release(prefab);
    return null;
  }
  if (!prefab) throw new Error(`页面加载失败：${page}`);
  let node: Node;
  try { node = instantiate(prefab); } catch (cause) { await mk.Release.release(prefab); throw cause; }
  mk.Release.followRelease(node, prefab);
  ColonyUtil.applyUiLayer(node);
  node.active = true; node.parent = session.node;
  node.setSiblingIndex(session.popupRoot!.getSiblingIndex());
  if (page === 'playRoot') {
    session.playRoot = node;
    session.boardView = node.getComponentInChildren(ColonyBoardView);
    session.slotView = node.getComponentInChildren(ColonySlotView);
    session.hudView = node.getComponentInChildren(ColonyHudView);
    session.toolBarView = node.getComponentInChildren(ColonyToolBarView);
    session.stackRoot = node.getChildByName('StackRoot');
    session.transportRoot = node.getChildByName('TransportRoot');
    if (!session.boardView || !session.slotView || !session.hudView || !session.toolBarView || !session.stackRoot || !session.transportRoot) {
      unmountPlay(session); throw new Error('PlayRoot Prefab 缺少页面绑定');
    }
  } else if (page === 'loading') {
    const view = node.getComponent(ColonyLoadingView);
    if (!view) { node.destroy(); throw new Error('Loading Prefab 缺少页面绑定'); }
    session.loadingView = view;
  } else {
    const view = node.getComponent(ColonyConstructionView);
    if (!view) { node.destroy(); throw new Error('Construction Prefab 缺少页面绑定'); }
    session.constructionView = view;
  }
  return node;
}

export function unmountPlay(session: ColonySceneBootstrap): void {
  session.playRoot?.destroy(); session.playRoot = null;
  session.boardView = null; session.slotView = null; session.hudView = null;
  session.toolBarView = null; session.stackRoot = null; session.transportRoot = null;
}

export function layoutPlay(session: ColonySceneBootstrap): void {
  const extra = Math.max(0, (view.getVisibleSize().height - 1334) / 2);
  const move = (node: Node, y: number): void => {
    const widget = node.getComponent(Widget);
    if (widget?.isAlignVerticalCenter) widget.verticalCenter = y;
    node.setPosition(node.position.x, y, node.position.z);
  };
  const compact = Math.min(40, Math.max(0, 1600 - view.getVisibleSize().height) * 0.47);
  const slotCompact = Math.min(70, Math.max(0, 1600 - view.getVisibleSize().height) * 0.82);
  move(session.boardView!.node, 146 + extra);
  move(session.slotView!.node, -15 - extra - slotCompact);
  move(session.stackRoot!, -160 - extra - compact);
  move(session.toolBarView!.node, -535 - extra);
  move(session.hudView!.node, 555 + extra);
}

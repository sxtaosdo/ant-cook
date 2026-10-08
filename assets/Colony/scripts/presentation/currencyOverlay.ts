import { instantiate, Prefab } from 'cc';
import mk from 'mk';
import type { ColonySceneBootstrap } from '../bootstrap/colonySceneBootstrap';
import { ColonyUtil } from '../colonyUtil';
import { ColonyCurrencyOverlayView } from '../views/currencyOverlayView';
import { ProgressPresentation } from './progressPresentation';
import { COLONY_BUILD_VERSION } from '../application/buildInfo';

export async function mountCurrencyOverlay(session: ColonySceneBootstrap): Promise<void> {
  if (session.currencyView) return;
  const prefab = await mk.asset.get('db://assets/Colony/ui/currencyOverlay.prefab', Prefab, null);
  if (!prefab) throw new Error('货币栏资源未加载');
  if (session.destroyed) { await mk.Release.release(prefab); return; }
  let node;
  try { node = instantiate(prefab); } catch (cause) { await mk.Release.release(prefab); throw cause; }
  mk.Release.followRelease(node, prefab);
  ColonyUtil.applyUiLayer(node);
  const overlay = node.getComponent(ColonyCurrencyOverlayView);
  if (!overlay) { node.destroy(); throw new Error('货币栏 Prefab 缺少绑定'); }
  try {
    overlay.bind(session.popupRoot!, () => session.destroyed ? null : session.progress?.wallet() ?? null,
      () => { void ProgressPresentation.open(session, 'shop'); });
    const profile = session.profile?.snapshot();
    if (profile) overlay.setProfile(profile.nickname, COLONY_BUILD_VERSION);
    node.parent = session.node;
    session.currencyView = overlay;
  } catch (cause) { node.destroy(); throw cause; }
}

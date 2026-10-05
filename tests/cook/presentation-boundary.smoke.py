#!/usr/bin/env python3
"""Static boundaries for the P0002-backed Cocos composition and presentation."""

from pathlib import Path
import json


PROJECT = Path(__file__).resolve().parents[1]
GAME = PROJECT / "assets/bundles/game"
root = (GAME / "GameRoot.ts").read_text(encoding="utf-8")
presentation = (GAME / "presentation/P10CookPresentation.ts").read_text(encoding="utf-8")
storage = (GAME / "infrastructure/CocosLocalStorageAdapter.ts").read_text(encoding="utf-8")

for symbol in ("CocosAdapter", "CocosComponentLifecycleHost", "P10CookApplication", "IntentInputPort", "P10CookPresentation"):
    assert symbol in root, f"GameRoot composition is missing {symbol}"

for lifecycle in ("this.lifecycle.onLoad()", "this.lifecycle?.update(deltaTime)", "this.lifecycle?.onDestroy()"):
    assert lifecycle in root, f"P0002 lifecycle delegation is missing: {lifecycle}"

assert "implements CocosPresentationPort<P10ReadModel>" in presentation
assert "private readModel" in presentation
assert "this.intents.publish(intent)" in presentation
assert "P10GameCore" not in presentation and "KitchenRun" not in presentation
assert "from '../core'" not in presentation, "presentation must consume catalog through P10ReadModel"
assert "sys.localStorage" not in presentation and "sys.localStorage" not in root
assert "sys.localStorage" in storage, "localStorage belongs only to the infrastructure adapter"

for component in ("MapFlowScreenGroup", "KitchenFlowScreenGroup", "ProgressionScreenGroup", "SettingsFlowScreenGroup"):
    groups = (GAME / f"presentation/{component}.ts").read_text(encoding="utf-8")
    assert f"@ccclass('{component}')" in groups
    assert f"addComponent({component})" in presentation

assert "bundle.loadDir('prefabs', Prefab" in presentation
assert "instantiate(prefab)" in presentation
for prefab_name in ("MapFlowGroup", "KitchenFlowGroup", "ProgressionGroup", "SettingsFlowGroup"):
    prefab_path = GAME / "prefabs" / f"{prefab_name}.prefab"
    meta_path = prefab_path.with_suffix(".prefab.meta")
    prefab = json.loads(prefab_path.read_text(encoding="utf-8"))
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    assert prefab[0]["__type__"] == "cc.Prefab" and prefab[1]["_name"] == prefab_name
    assert meta["importer"] == "prefab" and meta["userData"]["syncNodeName"] == prefab_name

assert "requestToken !== this.artRequestToken" in presentation
assert "isValid(this.node, true)" in presentation
assert "settings.reducedMotion" in presentation
assert "Input.EventType.TOUCH_END" in presentation
assert "Input.EventType.MOUSE_UP" not in presentation, "one pointer action must not dispatch twice"

print("P10 presentation boundary smoke: PASS")

#!/usr/bin/env python3
"""Static smoke for P10-Cook visual runtime layout and async art safety."""

from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
GAME = PROJECT / "assets/bundles/game"
composition = (GAME / "GameRoot.ts").read_text(encoding="utf-8")
root = (GAME / "presentation/P10CookPresentation.ts").read_text(encoding="utf-8")
manifest = (GAME / "ui/ScreenArtManifest.ts").read_text(encoding="utf-8")
viewport = (GAME / "ui/ViewportLayout.ts").read_text(encoding="utf-8")

for layer in ("BackgroundRoot", "ContentRoot", "SafeAreaRoot", "ModalRoot"):
    assert f"this.layer('{layer}'" in root, f"missing runtime layer: {layer}"

assert "PANEL_FRAME_PATH = 'resources/ui/solid/spriteFrame'" in root, "runtime panels need a real imported sprite asset"
assert "bundle.load(PANEL_FRAME_PATH, SpriteFrame" in root, "panel sprite must load before the first screen is built"
assert "this.panelFrame.packable = false" in root, "panel sprite must bypass dynamic-atlas copying"
assert "sprite.type = Sprite.Type.SIMPLE" in root, "solid runtime panels must use drawable SIMPLE sprite geometry"
assert "Graphics" not in root and "builtinResMgr" not in root, "runtime panels must not depend on unavailable cropped engine exports"
assert root.index("sprite.spriteFrame = this.panelFrame") < root.index("transform.setContentSize(width, height)"), "sprite-frame assignment must not reset the final panel dimensions"
for panel in ("TopHeader", "MapSectionHeader", "MapNavigation", "LockedOverlay", "ResultSummary"):
    assert f"'{panel}'" in root, f"missing text-protection panel: {panel}"
assert "this.neonBorder(card, 310, 210, unlocked ? color : C.muted)" in root, "restaurant cards need explicit unlocked and locked borders"
assert "this.box('OrderCard', this.node, 0, 232, 610, 220, C.panel2)" in root, "kitchen order copy must sit on the expanded order panel"

assert "setContentSize(720, 1536)" not in root, "legacy non-proportional 720x1536 art stretch remains"
assert "Math.max(this.viewport.width" in root, "background must use proportional cover scale"
assert "source.width * scale, source.height * scale" in root, "cover dimensions must preserve source aspect"

token_guard = "requestToken !== this.artRequestToken"
assert token_guard in root, "art callback must reject stale requests"
assert root.index(token_guard) < root.index("sprite.spriteFrame = frame"), "token guard must precede sprite assignment"
assert "isValid(this.node, true)" in root and "isValid(sprite, true)" in root, "art callback needs lifecycle guards"
assert "tween(" not in root, "Web Preview must not depend on the unavailable cc.tween export"
assert "this.updateArtTransition(deltaTime)" in root, "transition fade must advance from Component.update"
assert "this.transitionFadeElapsed / 0.16" in root, "normal motion must retain the short 0.16s fade"
assert "settings.reducedMotion" in root and "transition.active = false" in root, "reduced motion must hide the transition immediately"

assert "ResolutionPolicy.FIXED_WIDTH" in viewport, "viewport must preserve 720 logical width"
assert "width * windowSize.height" in viewport, "logical height must follow device aspect ratio"
assert "sys.getSafeAreaRect(false)" in viewport, "viewport must use the Creator 3.8.8 safe-area API"
assert "view.getVisibleSize()" in viewport, "safe-area insets must use design-resolution coordinates"
assert "safeTop - 24" in viewport and "safeBottom + 24" in viewport, "safe anchors must include 24px inset"

screens = ("map", "level", "kitchen", "pause", "result", "upgrade", "decor", "story", "unlock", "settings", "recovery")
for screen in screens:
    assert manifest.count(f"    {screen}:") == 1, f"screen must have exactly one manifest entry: {screen}"

backgrounds = ("map", "level", "kitchen", "result_success", "result_failure", "upgrade", "renovation", "story", "recovery", "unlock")
for background in backgrounds:
    assert f"background('{background}')" in manifest, f"missing art_v2 background mapping: {background}"

assert "pause: { path: background('kitchen')" in manifest, "pause must reuse only the clean kitchen scene"
assert "settings: { path: background('recovery')" in manifest, "settings must reuse only the clean recovery scene"
assert "resources/art_v2/backgrounds/" in manifest, "manifest must use the art_v2 shipping path"
assert "resources/art/" not in root + manifest, "runtime still references legacy baked-UI art"

assert "new P10CookApplication" in composition, "GameRoot must compose the product application"
assert "new CocosAdapter" in composition, "GameRoot must compose the P0002 Cocos adapter"
assert "new CocosComponentLifecycleHost" in composition, "GameRoot must delegate Creator lifecycle"
assert "sys.localStorage" not in composition + root, "UI and composition root must not access saves"
assert "P10GameCore" not in composition + root, "UI must consume application read models only"

print("P10 visual runtime smoke: PASS")

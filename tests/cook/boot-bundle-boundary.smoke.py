#!/usr/bin/env python3
"""Keep the boot package independent from product-bundle implementation modules."""

from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
boot_root = (PROJECT / "assets/boot/BootRoot.ts").read_text(encoding="utf-8")
loader = (PROJECT / "assets/boot/BundleLoaderPort.ts").read_text(encoding="utf-8")
mk_loader = (PROJECT / "assets/boot/MkBundleLoader.ts").read_text(encoding="utf-8")

assert "globalThis" not in boot_root, "BootRoot must not register a global runtime trampoline"
assert "P10Runtime" not in boot_root, "BootRoot must not know the product runtime entry"
assert "bundles/game" not in boot_root + loader + mk_loader, "boot package must not statically import business code"
assert "interface BundleLoaderPort" in loader, "boot must cross the bundle boundary through a typed port"
assert "this.bundle ??=" in loader, "bundle loading must be idempotent"
assert "must be loaded before scene start" in loader, "scene start must reject an unloaded bundle"
assert "new MkBundleLoader('game', 'Game')" in boot_root
assert "mk.bundle.loadScene" in mk_loader, "business scene load must go through mk.bundle"
assert "loadCode: async () => this.requireBundleLoader().load()" in boot_root
assert "startBusiness: async () => this.requireBundleLoader().start()" in boot_root

print("P10 boot bundle boundary smoke: PASS")

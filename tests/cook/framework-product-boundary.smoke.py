#!/usr/bin/env python3
"""Static product boundaries for the P0002 public package integration."""

import json
from pathlib import Path


PROJECT = Path(__file__).resolve().parents[1]
GAME = PROJECT / "assets/bundles/game"
CORE = GAME / "core"
APPLICATION = GAME / "application"
SAVE = GAME / "infrastructure/save"

package = json.loads((PROJECT / "package.json").read_text(encoding="utf-8"))
assert "@shidai3/composable-game-framework" not in package.get("dependencies", {})
assert (PROJECT / "extensions/shidai3/assets/index.ts").is_file()

for path in CORE.rglob("*.ts"):
    source = path.read_text(encoding="utf-8")
    assert "from 'cc'" not in source and 'from "cc"' not in source, f"core imports cc: {path}"
    assert "db://shidai3" not in source, f"product gameplay leaked into framework: {path}"

for path in [*APPLICATION.rglob("*.ts"), *SAVE.rglob("*.ts")]:
    source = path.read_text(encoding="utf-8")
    assert "/P0002/" not in source and "P0002/src" not in source, f"framework internal import: {path}"
    for line in source.splitlines():
        if "db://shidai3" in line:
            assert (
                "db://shidai3/index" in line
                or "db://shidai3/minigame/index" in line
            ), f"non-public framework import: {path}"

assert (PROJECT / "extensions/MKFramework/package.json").is_file(), "MKFramework extension missing"
assert package.get("MKFramework", {}).get("version") == "v1.1.5"

print("P10 framework/product boundary smoke: PASS")

#!/usr/bin/env python3
"""Guard the asynchronous boot sprite callback against scene teardown."""

from pathlib import Path


source = (Path(__file__).parents[1] / "assets/boot/BootRoot.ts").read_text(encoding="utf-8")
callback = source.split("resources.load('boot/startup/spriteFrame'", 1)[1].split("});", 1)[0]

assert "isValid," in source, "BootRoot must import Cocos isValid"
guard = "!isValid(this, true) || !isValid(sprite, true) || !isValid(background, true)"
assert guard in callback, "boot sprite callback must ignore destroyed scene objects"
assert callback.index(guard) < callback.index("sprite.spriteFrame = frame"), (
    "lifecycle guard must run before assigning the asynchronous sprite frame"
)
assert "retryNode && isValid(retryNode, true)" in source, (
    "BootRoot must validate the retry node before teardown"
)
assert "retryNode.off(Button.EventType.CLICK, this.retry, this)" in source, (
    "BootRoot must release its retry listener on teardown"
)

print("P10 BootRoot lifecycle smoke: PASS")

#!/bin/sh
set -eu

TEST_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$TEST_DIR")

cd "$PROJECT_DIR"
pnpm exec tsc --project tests/tsconfig.json --pretty false
pnpm exec tsc --project tests/tsconfig.application.json --pretty false
pnpm typecheck:creator
pnpm test
node tests/boot-flow.smoke.ts
node tests/presentation-input.smoke.ts
python3 tests/boot-root-lifecycle.smoke.py
python3 tests/boot-bundle-boundary.smoke.py
python3 tests/presentation-boundary.smoke.py
python3 tests/framework-product-boundary.smoke.py
python3 tests/visual-runtime.smoke.py

CORE_SMOKE_DIR=$(mktemp -d)
trap 'rm -rf "$CORE_SMOKE_DIR"' EXIT
tsc --strict --target ES2022 --module commonjs --moduleResolution node \
  --outDir "$CORE_SMOKE_DIR" \
  assets/bundles/game/core/index.ts \
  tests/game-core.smoke.ts
node "$CORE_SMOKE_DIR/tests/game-core.smoke.js"

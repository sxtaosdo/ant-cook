import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
function load(file, modules = {}) {
  const exports = {};
  const source = readFileSync(new URL('../../assets/Colony/scripts/' + file + '.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, useDefineForClassFields: false } }).outputText;
  runInNewContext(code, { exports, require: name => modules[name] ?? {} });
  return exports;
}
class Widget {}
class UITransform {}
class Sprite {}
const cc = { Widget, UITransform, Sprite, Vec3: null, Node: class {}, _decorator: { ccclass: () => Type => Type, property: () => () => {} } };
class Vec3 { constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); } }
function fixture(height) {
  cc.Vec3 = Vec3;
  const node = () => ({ position: new Vec3(7, 0, 3), widget: { isAlignVerticalCenter: true, verticalCenter: 0 },
    getComponent(Type) { return Type === Widget ? this.widget : null; },
    setPosition(x, y, z) { this.position = new Vec3(x, y, z); } });
  const boardNode = node(); const content = node(); content.position.y = -90; content.widget.verticalCenter = -90;
  const frame = node(); const background = node(); background.position.y = -90;
  boardNode.getChildByName = name => ({ BoardFrame: frame, BackgroundArt: background })[name] ?? null;
  const { ColonyBoardView } = load('views/boardView', { cc, mk: { default: { StaticViewBase: class {} } } });
  const board = new ColonyBoardView(); board.node = boardNode; board.contentRoot = content;
  // Clone is the engine boundary; all position selection and offset application remain real.
  for (const n of [boardNode, content, frame, background]) n.position.clone = function() { return new Vec3(this.x, this.y, this.z); };
  board.onLoad();
  const context = { boardView: board, slotView: { node: node() }, stackRoot: node(), toolBarView: { node: node() }, hudView: { node: node(), fitSafeArea() {} } };
  const { layoutPlay } = load('presentation/pageNodes', { cc: { Widget, view: { getVisibleSize: () => ({ height }) } } });
  layoutPlay(context); layoutPlay(context);
  // Creator WidgetManager reapplies centering after a resize.
  content.setPosition(content.position.x, content.widget.verticalCenter, content.position.z);
  context.frame = frame; context.background = background; return context;
}
for (const height of [1334, 1600, 1800]) test(`board moves up30 design pixels and other play UI stays fixed at height${height}`, () => {
  const f = fixture(height); const extra = Math.max(0, (height - 1334) / 2);
  const compact = Math.min(40, Math.max(0, 1600 - height) * 0.47);
  const slotCompact = Math.min(70, Math.max(0, 1600 - height) * 0.82);
  assert.equal(f.boardView.node.position.y, 146 + extra);
  assert.equal(f.boardView.node.widget.verticalCenter, 146 + extra);
  assert.equal(f.boardView.content.position.y, -60);
  assert.equal(f.frame.position.y, 30);
  assert.equal(f.background.position.y, -90); // Fullscreen scenery has no extra shift.
  assert.equal(f.boardView.node.position.y + f.background.position.y, 56 + extra);
  assert.equal(f.slotView.node.position.y, -15 - extra - slotCompact);
  assert.equal(f.stackRoot.position.y, -160 - extra - compact);
  assert.equal(f.toolBarView.node.position.y, -535 - extra);
  assert.equal(f.hudView.node.position.y, 555 + extra);
  assert.equal(f.boardView.node.position.x, 7); assert.equal(f.boardView.node.position.z, 3);
});
test('board world coordinates and actual transport route conversion follow the same30pixel shift', () => {
  const f = fixture(1334); const point = new Vec3(31, -14, 0);
  const { TransportPresentation } = load('presentation/transportPresentation', { cc: { UITransform, Vec3 } });
  const transport = Object.create(TransportPresentation.prototype);
  const content = { getComponent: () => ({ convertToWorldSpaceAR: local => new Vec3(local.x + 7, local.y + f.boardView.node.position.y + f.boardView.content.position.y, local.z),
    convertToNodeSpaceAR: world => new Vec3(world.x - 7, world.y - f.boardView.node.position.y - f.boardView.content.position.y, world.z) }) };
  transport.boardRoot = content; transport.root = { getComponent: () => ({ convertToNodeSpaceAR: world => world }) };
  const world = content.getComponent(UITransform).convertToWorldSpaceAR(point);
  const target = transport.boardToTransport(point);
  assert.deepEqual(target, world); assert.equal(target.y - (-14 + 146 - 90), 30);
  const hitLocal = content.getComponent(UITransform).convertToNodeSpaceAR(world);
  assert.deepEqual(hitLocal, point);
});

test('board offset changes parent translation rather than first-level scale', () => { const f = fixture(1334); f.boardView.content.scale = new Vec3(0.925, 0.925, 1); f.boardView.setBoardVerticalOffset(30); assert.equal(f.boardView.content.position.y, -60); assert.equal(f.boardView.content.scale.y, 0.925); assert.equal(f.frame.position.y, 30); });

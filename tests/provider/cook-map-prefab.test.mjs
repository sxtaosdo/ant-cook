import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

// Read Creator's saved asset; this does not replace native Preview validation.
const readJson = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const objects = readJson('../../assets/bundles/game/prefabs/MapFlowGroup.prefab');
const resolve = ref => objects[ref?.__id__];
const root = resolve(objects[0].data);
const nodes = objects.filter(value => value.__type__ === 'cc.Node');
const components = node => node._components.map(resolve);
const component = (node, type) => components(node).find(value => value.__type__ === type);
const controller = components(root).find(value => value.mapRoot);
const fixed = resolve(controller.mapRoot);
const owner = value => value.__type__ === 'cc.Node' ? value : resolve(value.node);
const size = node => component(node, 'cc.UITransform')._contentSize;
const isInFixed = node => node === fixed || Boolean(node?._parent && isInFixed(resolve(node._parent)));
const frameUuid = path => Object.values(readJson(path).subMetas).find(value => value.importer === 'sprite-frame').uuid;

test('saved Map tree stays on the existing UI layer without another camera or input route', () => {
  assert.equal(root._layer, 33554432);
  assert.equal(resolve(fixed._parent), root);
  for (const node of nodes) {
    assert.equal(node._layer, root._layer, node._name);
    assert.ok(component(node, 'cc.UITransform'), node._name);
    assert.equal(component(node, 'cc.Button'), undefined);
  }
  assert.equal(objects.some(value => ['cc.Canvas', 'cc.Camera'].includes(value.__type__)), false);
  const rootSize = size(root);
  assert.deepEqual([rootSize.width, rootSize.height], [750, 1334]);
});

test('saved Map controller has all typed bindings within its own fixed root', () => {
  const singles = ['mapRoot', 'headerRoot', 'navigationRoot', 'background', 'transition', 'currencyLabel',
    'upgradeButton', 'decorButton', 'storyButton', 'settingsButton'];
  for (const key of singles) assert.ok(isInFixed(owner(resolve(controller[key]))), key);
  for (const [key, type, count] of [
    ['restaurantCards', 'cc.Node', 6], ['restaurantIcons', 'cc.Label', 6],
    ['restaurantNames', 'cc.Label', 6], ['restaurantCities', 'cc.Label', 6],
    ['restaurantProgress', 'cc.Label', 6], ['restaurantLocks', 'cc.Node', 6],
    ['restaurantEdges', 'cc.Sprite', 6], ['restaurantBorders', 'cc.Sprite', 24],
  ]) {
    const values = controller[key].map(resolve);
    assert.equal(values.length, count, key);
    assert.equal(new Set(values).size, count, key);
    for (const value of values) {
      assert.equal(value.__type__, type, key);
      assert.ok(isInFixed(owner(value)), key);
    }
  }
});

test('saved six-card slots, lock overlays and border strips preserve restaurant order', () => {
  const cards = controller.restaurantCards.map(resolve);
  cards.forEach((card, index) => {
    assert.equal(card._name, 'Restaurant' + index);
    assert.deepEqual([card._lpos.x, card._lpos.y], [index % 2 ? 174 : -174, 330 - Math.floor(index / 2) * 252]);
    assert.deepEqual([size(card).width, size(card).height], [310, 210]);
    for (const key of ['restaurantIcons', 'restaurantNames', 'restaurantCities', 'restaurantProgress', 'restaurantLocks', 'restaurantEdges']) {
      const node = owner(resolve(controller[key][index]));
      assert.equal(resolve(node._parent), card, key + index);
    }
    const lock = resolve(controller.restaurantLocks[index]);
    assert.equal(lock._active, index !== 0);
    const borders = controller.restaurantBorders.slice(index * 4, index * 4 + 4).map(resolve).map(owner);
    assert.deepEqual(borders.map(node => node._name), ['NeonTop', 'NeonBottom', 'NeonLeft', 'NeonRight']);
    borders.forEach(node => assert.equal(resolve(node._parent), card));
  });
});

test('saved viewport layers, four navigation targets and static frames are ready before runtime', () => {
  const layers = fixed._children.map(resolve);
  assert.deepEqual(layers.map(node => node._name), ['BackgroundRoot', 'ContentRoot', 'SafeAreaRoot', 'ModalRoot']);
  const transition = resolve(controller.transition);
  for (const node of [fixed, ...layers, transition]) {
    const widget = component(node, 'cc.Widget');
    assert.equal(widget._alignFlags, 45, node._name);
    assert.deepEqual([widget._top, widget._bottom, widget._left, widget._right], [0, 0, 0, 0]);
  }
  assert.equal(resolve(transition._parent), layers[3]);
  assert.equal(transition._active, false);
  assert.equal(component(transition, 'cc.UIOpacity')._opacity, 0);
  const header = resolve(controller.headerRoot), navigation = resolve(controller.navigationRoot);
  assert.deepEqual([header._lpos.y, navigation._lpos.y], [595, -605]);
  ['upgradeButton', 'decorButton', 'storyButton', 'settingsButton'].forEach((key, index) => {
    const node = resolve(controller[key]);
    assert.equal(resolve(node._parent), navigation);
    assert.deepEqual([node._lpos.x, node._lpos.y], [-228 + index * 152, 0]);
    assert.deepEqual([size(node).width, size(node).height], [132, 66]);
  });
  const background = resolve(controller.background);
  assert.equal(background._spriteFrame.__uuid__, frameUuid('../../assets/bundles/game/resources/art_v2/backgrounds/map.jpg.meta'));
  const backgroundNode = owner(background);
  assert.equal(component(backgroundNode, 'cc.Widget'), undefined);
  assert.deepEqual([size(backgroundNode).width, size(backgroundNode).height], [750.375, 1334]);
  const solid = frameUuid('../../assets/bundles/game/resources/ui/solid.png.meta');
  for (const sprite of objects.filter(value => value.__type__ === 'cc.Sprite' && value !== background))
    assert.equal(sprite._spriteFrame?.__uuid__, solid, owner(sprite)._name);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveResultPopupAction } from '../../assets/Colony/popups/resultPopupNav.ts';

type SerializedEntry = {
  __type__?: string;
  _name?: string;
  _children?: Array<{ __id__: number }>;
  _components?: Array<{ __id__: number }>;
  _contentSize?: { __type__: string; width: number; height: number };
  _prefab?: { __id__: number };
  asset?: { __uuid__: string };
};

function readPrefab(path: string): SerializedEntry[] {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as SerializedEntry[];
}

test('daily success retries without a next level and home remains explicit', () => {
  assert.equal(resolveResultPopupAction('success', 'primary', false, true), 'continue');
  assert.equal(resolveResultPopupAction('success', 'home', false, true), 'home');
});

test('success primary continues only when a next level exists', () => {
  assert.equal(resolveResultPopupAction('success', 'primary', true), 'continue');
  assert.equal(resolveResultPopupAction('success', 'primary', false), 'home');
});

test('fail primary always continues for retry', () => {
  assert.equal(resolveResultPopupAction('fail', 'primary', true), 'continue');
  assert.equal(resolveResultPopupAction('fail', 'primary', false), 'continue');
});

test('home always navigates home for either result popup', () => {
  assert.equal(resolveResultPopupAction('success', 'home', true), 'home');
  assert.equal(resolveResultPopupAction('success', 'home', false), 'home');
  assert.equal(resolveResultPopupAction('fail', 'home', true), 'home');
  assert.equal(resolveResultPopupAction('fail', 'home', false), 'home');
});

for (const [kind, path] of [
  ['success', '../../assets/Colony/popups/resultSuccess/prefab/resultSuccess.prefab'],
  ['fail', '../../assets/Colony/popups/resultFail/prefab/resultFail.prefab'],
] as const) {
  test(`${kind} result popup uses the MK full-screen modal mask`, () => {
    const prefab = readPrefab(path);
    const root = prefab[1]!;
    const children = root._children!.map(({ __id__ }) => prefab[__id__]!);
    const components = root._components!.map(({ __id__ }) => prefab[__id__]!);
    const transform = components.find((component) => component.__type__ === 'cc.UITransform');
    const maskPrefab = prefab[children[0]!._prefab!.__id__]!;

    assert.equal(maskPrefab.asset?.__uuid__, '33ccdb11-a481-4d54-aea8-916957e57d68');
    assert.ok(children.some((child) => child._name === 'ResultPanel'));
    assert.deepEqual(transform?._contentSize, { __type__: 'cc.Size', width: 750, height: 1334 });
    assert.ok(components.some((component) => component.__type__ === 'cc.BlockInputEvents'));
  });
}

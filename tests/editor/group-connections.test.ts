import assert from 'node:assert/strict';
import test from 'node:test';
import { connectionRoutes, connectionStyle, mountGroupConnections, type AnchorRect, type ConnectionGroup } from '../../scripts/board-editor/groupConnections.js';
import { DraftHistory } from '../../scripts/board-editor/groupsCore.js';
import { basicExample, createLinkGroup, dissolveLinkGroup, linkGroupsFor, removeBlock, toggleLinkMember } from '../../scripts/board-editor/groupsView.js';

const viewport = {left: 100, right: 500, top: 200, bottom: 600, width: 400, height: 400};
const anchors = new Map<string, AnchorRect>([['a', {left:110,right:190,top:280,bottom:380}], ['b', {left:230,right:310,top:400,bottom:500}]]);
const groups: ConnectionGroup[] = [{id:'pair',number:1,members:['a','b']}];
test('routes meet card edges in local coordinates and follow scrolling and scaled containers', () => {
  const route = connectionRoutes(groups, anchors, viewport)[0]!;
  assert.deepEqual(route.anchors, [{x:90,y:130},{x:210,y:250}]);
  const scaled = new Map([...anchors].map(([id,r]) => [id,{left:r.left*2,right:r.right*2,top:r.top*2,bottom:r.bottom*2}]));
  assert.deepEqual(connectionRoutes(groups, scaled, {...viewport,left:200,right:1000,top:400,bottom:1200})[0], route);
  const scrolled = new Map([...anchors].map(([id,r]) => [id,{...r,left:r.left-50,right:r.right-50,top:r.top-30,bottom:r.bottom-30}]));
  assert.deepEqual(connectionRoutes(groups, scrolled, viewport)[0]!.anchors, [{x:40,y:100},{x:160,y:220}]);
  assert.notEqual(connectionRoutes(groups, scrolled, viewport)[0]!.path, route.path);
});
test('all groups retain stable numbers and styles; missing, duplicate and hidden anchors do not leave fake connections', () => {
  const linked = [{...groups[0]!,number:7},{id:'other',number:2,members:['a','b']}];
  assert.deepEqual(connectionRoutes(linked, anchors, viewport).map(route => route.number), [7,2]);
  assert.notDeepEqual(connectionStyle(1), connectionStyle(7));
  assert.notDeepEqual(connectionStyle(1), connectionStyle(2));
  assert.deepEqual(connectionRoutes([{id:'one',number:1,members:['a','a','missing']}], anchors, viewport), []);
  assert.deepEqual(connectionRoutes(groups, anchors, {...viewport,width:0}), []);
  assert.deepEqual(connectionRoutes(groups, new Map([['a', {...anchors.get('a')!,right:NaN}]]), viewport), []);
});
test('delete, dissolve and undo derive connections from the current draft without changing stored state', () => {
  const created = createLinkGroup(basicExample());
  let draft = toggleLinkMember(created.draft,created.id,'group-1'); draft = toggleLinkMember(draft,created.id,'group-2');
  const history = new DraftHistory(draft), rects = new Map([['group-1',anchors.get('a')!],['group-2',anchors.get('b')!]]);
  const read = () => connectionRoutes(linkGroupsFor(history.current).map(group => ({...group,members:group.members.map(member => member.id)})),rects,viewport);
  const snapshot = JSON.stringify(history.current); assert.equal(read().length,1); assert.equal(JSON.stringify(history.current),snapshot);
  history.commit(removeBlock(history.current,'group-1')); assert.equal(read().length,0);
  history.undo(); assert.equal(read().length,1); history.redo(); assert.equal(read().length,0); history.undo();
  history.commit(dissolveLinkGroup(history.current,created.id)); assert.equal(read().length,0); history.undo(); assert.equal(read().length,1);
});
test('stable numbers 1 and 7 in the same columns get separate buses and readable labels after other groups dissolve', () => {
  const rects = new Map([...anchors, ['c',{...anchors.get('a')!,top:400,bottom:500}], ['d',{...anchors.get('b')!,top:520,bottom:620}]]);
  const routes = connectionRoutes([{id:'empty',number:3,members:[]},groups[0]!,{id:'later',number:7,members:['c','d']}],rects,viewport);
  assert.deepEqual(routes.map(route => route.number),[1,7]);
  assert.equal(routes[0]!.label.x,routes[1]!.label.x);
  assert.equal(routes[1]!.label.y-routes[0]!.label.y,16);
  assert.notEqual(routes[0]!.path.split(' H ')[0],routes[1]!.path.split(' H ')[0]);
});

class FakeNode {
  attrs = new Map<string,string>(); children: FakeNode[] = []; textContent = ''; removed = false;
  classList = {add: (_name: string) => {}};
  setAttribute(name: string,value: string) { this.attrs.set(name,value); }
  append(...nodes: FakeNode[]) { this.children.push(...nodes); }
  replaceChildren() { this.children = []; }
  remove() { this.removed = true; }
}
test('view refreshes after layout and captured scroll, clears old members immediately, and disposes pending work', () => {
  const listeners = new Map<string,Set<() => void>>(), frames = new Map<number,() => void>(); let nextFrame = 0;
  const events = {
    addEventListener(name: string, fn: () => void) { if (!listeners.has(name)) listeners.set(name,new Set()); listeners.get(name)!.add(fn); },
    removeEventListener(name: string, fn: () => void) { listeners.get(name)?.delete(fn); },
  };
  const view = {...events,requestAnimationFrame(fn: () => void) {frames.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame(id: number) {frames.delete(id);},visualViewport:null};
  const doc = {defaultView:view,createElementNS:() => new FakeNode()};
  const stage = Object.assign(new FakeNode(),{ownerDocument:doc,clientWidth:400,clientHeight:400,getBoundingClientRect:() => viewport});
  let currentAnchors = anchors;
  const list = {style:{paddingTop:''},querySelectorAll:() => [...currentAnchors].map(([id,r]) => ({dataset:{blockId:id},getBoundingClientRect:() => r}))};
  const flush = () => {const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());};
  const original = globalThis.ResizeObserver; let resize: (() => void) | undefined, disconnected = false;
  globalThis.ResizeObserver = class { constructor(callback: () => void) {resize=callback;} observe() {} disconnect() {disconnected=true;} } as unknown as typeof ResizeObserver;
  try {
    const controller = mountGroupConnections(stage as unknown as HTMLElement,list as unknown as HTMLElement), svg = stage.children[0]!;
    assert.equal(svg.attrs.get('pointer-events'),'none'); assert.equal(svg.attrs.get('aria-hidden'),'true');
    controller.update(groups,null); assert.equal(list.style.paddingTop,'24px'); flush();
    const originalPath = svg.children[0]!.attrs.get('d'); assert.ok(originalPath); assert.equal(svg.children.at(-1)!.textContent,'1');
    currentAnchors = new Map([...anchors].map(([id,r]) => [id,{...r,left:r.left-40,right:r.right-40}]));
    listeners.get('scroll')!.forEach(fn=>fn()); resize!(); assert.equal(frames.size,1); flush(); assert.notEqual(svg.children[0]!.attrs.get('d'),originalPath);
    controller.update([{...groups[0]!,members:['a']}],null); assert.equal(svg.children.length,0); flush(); assert.equal(svg.children.length,0);
    controller.update(groups,'pair'); flush(); assert.equal(svg.children[0]!.attrs.get('stroke-width'),'3');
    controller.update(groups,null); controller.dispose(); assert.equal(frames.size,0); assert.equal(svg.removed,true); assert.equal(disconnected,true);
    assert.equal([...listeners.values()].every(set=>set.size===0),true); controller.update(groups,null); assert.equal(frames.size,0);
  } finally {globalThis.ResizeObserver=original;}
});

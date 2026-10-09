import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { stackPileHeads, stackPilePosition } from '../../assets/Colony/scripts/presentation/boardGeometry.ts';

/** Execute the actual two projection methods with native-node IO doubles; this is not a Creator playtest. */
test('repeated projection and pool reuse keep the count label separate from link/lock badges and mystery contents', () => {
  const source = readFileSync('assets/Colony/scripts/presentation/boardPresentation.ts','utf8');
  const syntax = ts.createSourceFile('boardPresentation.ts',source,ts.ScriptTarget.Latest,true);
  const owner = syntax.statements.find(node=>ts.isClassDeclaration(node)&&node.name?.text==='BoardPresentation') as ts.ClassDeclaration;
  const methods = owner.members.filter(node=>ts.isMethodDeclaration(node)&&['createStacks','renderStacks'].includes(node.name.getText(syntax))).map(node=>node.getText(syntax)).join('\n');
  const compiled=ts.transpileModule(`class Projection {${methods}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
  class Label {static Overflow={SHRINK:1};node!:NativeNode;string='';color:unknown;overflow=0;}
  class Button {static Transition={SCALE:1,NONE:0};interactable=true;transition=0;}
  class Sprite {color:unknown;}
  class UITransform {setContentSize(..._:unknown[]):void {}}
  class Color {static WHITE=new Color('white');constructor(public value:unknown){}}
  class Vec3 {static ONE=new Vec3(1,1,1);constructor(public x:number,public y:number,public z:number){}}
  class NativeNode {
    children:NativeNode[]=[];name:string;layer=1;active=true;position=new Vec3(0,0,0);angle=0;
    components=new Map<unknown,unknown>();private parentNode:NativeNode|null=null;
    constructor(name='node'){this.name=name;}
    set parent(value:NativeNode){this.parentNode=value;value.children.push(this);}
    getChildByName(name:string){return this.children.find(child=>child.name===name);}
    getComponent<T>(type:{new():T}):T|null{return (this.components.get(type) as T)??null;}
    getComponentInChildren<T>(type:{new():T}):T|null{return this.getComponent(type)??this.children.map(child=>child.getComponentInChildren(type)).find(Boolean)??null;}
    addComponent<T>(type:{new():T}):T{const component=new type();this.components.set(type,component);if(component instanceof Label)component.node=this;return component;}
    setPosition(x:number|Vec3,y=0){this.position=x instanceof Vec3?x:new Vec3(x,y,0);}
    setScale(_:unknown):void{}
    setSiblingIndex(index:number){if(!this.parentNode)return;const siblings=this.parentNode.children;siblings.splice(siblings.indexOf(this),1);siblings.splice(index,0,this);}
  }
  const Projection=new Function('Node','Label','Color','Vec3','Sprite','Button','UITransform','stackPileHeads','stackPilePosition','colonyColor',`${compiled};return Projection;`)(NativeNode,Label,Color,Vec3,Sprite,Button,UITransform,stackPileHeads,stackPilePosition,(value:string)=>new Color(value));
  const projected=new Projection(), node=new NativeNode(); node.addComponent(Sprite);node.addComponent(Button);
  Object.assign(projected,{stackNodes:new Map(),moving:new Set(),queueOffset:0,stackTile:{},stackChain:{},stackPool:{},stackRoot:new NativeNode(),bindQueueScroll:()=>{},suppressQueueClickUntil:0,
    factory:{acquire:()=>node,token:()=>{},bindButton:()=>{},label:(text:string,parent:NativeNode)=>{const child=new NativeNode('unnamed-label');child.parent=parent;const label=child.addComponent(Label);label.string=text;return label;}}});
  const stack={id:'special',color:'berry',count:78,pile:0,depth:0,selected:false,accessible:false,mystery:true,linkId:'pair',lockId:'door',locked:true, revealed:false};
  const read={snapshot:{stacks:[stack],queueColumns:3}};projected.createStacks(read);
  const count=node.getChildByName('StackCountLabel')!.getComponent(Label)!;
  assert.equal(count.string,'?');assert.equal(count.overflow,Label.Overflow.SHRINK);
  stack.revealed=true;stack.locked=false;stack.accessible=true;projected.renderStacks(read);projected.renderStacks(read);
  assert.equal(count.string,'78');assert.equal(node.getChildByName('LinkBadge')!.getComponent(Label)!.string,'连');assert.equal(node.getChildByName('LockBadge')!.getComponent(Label)!.string,'锁');assert.equal(node.getChildByName('LockBadge')!.active,false);
  projected.stackNodes.clear();const ordinary={...stack,id:'ordinary',count:4096,mystery:undefined,linkId:undefined,lockId:undefined};
  projected.createStacks({snapshot:{stacks:[ordinary],queueColumns:5}});
  assert.equal(node.children.filter(child=>child.name==='StackCountLabel').length,1);assert.equal(count.string,'4096');assert.equal(node.getChildByName('LinkBadge')!.active,false);
});

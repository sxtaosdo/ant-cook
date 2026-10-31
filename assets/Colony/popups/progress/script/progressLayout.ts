import { _decorator, Component, Label, Node, Sprite, SpriteFrame } from 'cc';
import { VirtualScrollView } from '../../../vendor/vscrollview/VScrollView';
const { ccclass, property } = _decorator;
/** One preassembled summary/tabs layout, selected only by projection shape. */
@ccclass('ColonyProgressLayout')
export class ColonyProgressLayout extends Component {
  @property(Label) public title: Label | null = null;
  @property(Label) public summary: Label | null = null;
  @property(Label) public feedback: Label | null = null;
  @property(Node) public closeButton: Node | null = null;
  @property(Node) public backButton: Node | null = null;
  @property(Node) public tabs: Node | null = null;
  @property([Node]) public tabButtons: Node[] = [];
  @property([Label]) public tabLabels: Label[] = [];
  @property([Sprite]) public tabPlates: Sprite[] = [];
  @property(SpriteFrame) public selectedTabFrame: SpriteFrame | null = null;
  @property(SpriteFrame) public normalTabFrame: SpriteFrame | null = null;
  @property(VirtualScrollView) public list: VirtualScrollView | null = null;
}

//*//
import { __private, assert, BaseRenderData, BitmapFont, cclegacy, Color, Component, Director, director, Game, game, gfx, Label, Material, MotionStreak, murmurhash2_32_gc, Node, renderer, resources, Sprite, SpriteFrame, StencilManager, TiledLayer, TiledRenderData, UIRenderer, VERSION } from 'cc';
import { DEBUG, EDITOR, JSB } from 'cc/env';

const VER = "3.0.9";

//最大纹理,固定8张
const MAX_TEX = 8

//原生开关,根据需要开启或关闭
const SUPPORT_NATIVE = true;

//label被动优化
//如果开启，label位置显示变更时更新，减少了顶点更新的性能开销
//(注意：如果开启，不能在透明为0的node下变更label内容，以防数据没有更新，改用active控制label显示隐藏)
const Label_Passive_ptimization = false; 

//@ts-ignore
gfx.Texture.prototype.texID = -1; //当前纹理id
//@ts-ignore
Material.prototype.isMult = false; //多纹理材质的标记
//@ts-ignore
Component.prototype.useMult = false; //组件多纹理开关(如想排除组件不参与多纹理，请自行设置属性false)


// 多纹理合批全局开关，网络开关也可在此设置
export const enableMultTextures = function () {

    if (EDITOR || MultBatch2D.native) return false;

    let ver = VERSION.slice();
    let numbers = ver.split('.');
    let n = parseInt(numbers.join(''));
    if (JSB && !(n >= 380 && n <= 388)) {
        //目前支持387 到 380，后续添加其他版本
        MultBatch2D.native = false;
        return false; //版本不匹配
    }

    return true;
}

//游戏启动前，务必加载多纹理材质
game.once(Game.EVENT_GAME_INITED, () => {
    if (!enableMultTextures()) return; //|| JSB
    loadMultTextures();
});



export const MultBatch2D: any = {
    native: !SUPPORT_NATIVE && JSB,
    enable: false,
    parent: null,
    incID: 0,
    count: 0,
    hash: 0,
    reset: function () {
        this.incID += this.count;
        this.count = 0;
    }
};

//预加载多纹理材质
const loadMultTextures = function () {
    MultBatch2D.enable = false;
    resources.load("multTextures/Mult-material", Material, (err, material) => {
        if (!err) {
            let mat = cclegacy.builtinResMgr.get('ui-sprite-material');
            if (mat) {
                mat._hash = MultBatch2D.hash = Material.getHash(mat);
                MultBatch2D.parent = material;
                MultBatch2D.enable = true;
                //@ts-ignore
                material.isMult = true;
                material.addRef();
                // console.log(VER);
            }
        }
    });
}


//多纹理材质缓存队列
let _cacheUseCount: number = 0;
let _cacheMaterials: Array<Material> = [];
const getMultMaterial = function (oldMat: any, rd: any = null) {

    let MB = MultBatch2D;
    MB.reset();
    if (!MB.enable || !oldMat || !rd || !rd.isMult) {
        return oldMat;
    }

    if (!MB.parent || !MB.parent.isValid) {
        loadMultTextures();
        return oldMat;
    }

    let newMat: any = _cacheMaterials[_cacheUseCount++];
    if (!newMat || !newMat.isValid) {
        let material = { parent: MB.parent };
        newMat = new renderer.MaterialInstance(material);
        _cacheMaterials[_cacheUseCount - 1] = newMat;
        newMat['cacheTextures'] = [];
        newMat['isMult'] = true;
        newMat.addRef();
    }

    return newMat;
}


// game.on(Game.EVENT_RESTART,()=>{
//     if (!enableMultTextures()) return; //|| JSB
//     _cacheMaterials.length = 0;
//     _cacheUseCount = 0;
//     loadMultTextures();
// });


///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// 多纹理合批，sprite , label , renderdata ，等其他组件的重写和监听
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const inject_Renderdata = function () {

    const RenderData = cclegacy.UI.RenderData.prototype;

    RenderData.texID = -1;
    RenderData.isMult = false;
    RenderData.matDirty = true;
    RenderData.texDirty = true;
    RenderData.dataDirty = 0x0;

    //兼容多纹理hash计算
    RenderData.updateHash = function () {

        if (this.isMult && MultBatch2D.enable) {
            const bid = this.chunk ? this.chunk.bufferId : -1;
            const hashString = `${bid}${this.layer}` + '98k';
            this.dataHash = murmurhash2_32_gc(hashString, 666);
            this.hashDirty = false;
        } else {
            const bid = this.chunk ? this.chunk.bufferId : -1;
            const hashString = `${bid}${this.layer} ${this.textureHash}`;
            this.dataHash = murmurhash2_32_gc(hashString, 666);
            this.hashDirty = false;
        }

        this.matDirty = false;
    }

    //监听纹理的变更
    Object.defineProperty(RenderData, "textureDirty", {
        get: function () {
            return this.texDirty;
        },
        set: function (val: boolean) {
            this.texDirty = val;
            if (val === true) {
                this.texID = -1;
            }
        }
    });


    Object.defineProperty(RenderData, "material", {
        get: function (): Material | null {
            if (JSB && this.isMult) {
                return MultBatch2D.parent;
            }
            return this._material!;
        },
        set: function (val: Material | null) {
            this._material = val;
            if (this._renderDrawInfo) {
                let mat = this.isMult ? MultBatch2D.parent : val!;
                this._renderDrawInfo.setMaterial(mat);
            }
        }
    });


    //检测是否支持多纹理合批
    const isMultTextures = function (rd: any, uir: UIRenderer) {

        let b = rd.isMult;

        rd.isMult = false;
        let material: any = uir.getRenderMaterial(0)!
        if (!material || !MultBatch2D.enable) {
            if (b && !rd.isMult) {
                //@ts-ignore
                uir._updateColor();
            }
            return;
        }

        //@ts-ignore
        //组件控制开关 useMult: 可以开启自定义组件参与多纹理
        if (uir.useMult && !rd._isMeshBuffer) {
            if (!material.hash || rd.passDirty || JSB) {
                material._hash = Material.getHash(material);
            }
            rd.isMult = (MultBatch2D.hash == material._hash);
        }

        if (b && !rd.isMult) {
            //@ts-ignore
            uir._updateColor();
        }
    }

    //监听pass变更，检测是否多纹理支持
    const updatePass = RenderData.updatePass;
    RenderData.updatePass = function (comp: UIRenderer): void {
        isMultTextures(this, comp);
        updatePass.call(this, comp);
    }

    //监听pass变更，检测是否多纹理支持
    const updateRenderData = RenderData.updateRenderData;
    RenderData.updateRenderData = function (comp: UIRenderer, frame: any): void {
        isMultTextures(this, comp);
        updateRenderData.call(this, comp, frame);
        if (JSB) {
            if (this.isMult) {
                this.renderDrawInfo.setMaterial(MultBatch2D.parent);
            } else {
                this.renderDrawInfo.setMaterial(this.material);
            }
        }
    }


}




const inject_UIRender = function () {

    const render: any = UIRenderer.prototype;
    const updateMaterial = render.updateMaterial;
    render.updateMaterial = function () {
        updateMaterial.call(this);
        if (this._assembler) {
            if (this._assembler.updateColor) {
                this._updateColor();
            }
        }
    }

    //重写 _updateColor 方法
    render._updateColor = function () {
        this.node._uiProps.colorDirty = true;
        this.setEntityColorDirty(true);
        this.setEntityColor(this._color);
        this.setEntityOpacity(this.node._uiProps.localOpacity);

        const assembler = this._assembler;
        if (assembler) {
            //修复updateColor不存在
            if (assembler.updateColor) {
                assembler.updateColor(this);
            }
            // Need update rendFlag when opacity changes from 0 to !0 or 0 to !0
            const renderFlag = this._renderFlag;
            this._renderFlag = this._canRender();
            this.setEntityEnabled(this._renderFlag);
            if (renderFlag !== this._renderFlag) {
                const renderData = this.renderData;
                if (renderData) {
                    renderData.vertDirty = true;
                }
            }
        }
    }
}


const fillMeshVertices3D = function (node: Node, renderer: any, cmp: any, color: Color): void {

    const renderData = cmp.renderData!
    const chunk = renderData.chunk;
    const dataList = renderData.data;
    const vData = chunk.vb;
    const vertexCount = renderData.vertexCount;


    if (node.hasChangedFlags || renderData.dataDirty === 1) {

        renderData.dataDirty = 1;
        let m = node.worldMatrix; // node.getWorldMatrix(m);
        let m00 = m.m00, m01 = m.m01, m02 = m.m02, m03 = m.m03,
            m04 = m.m04, m05 = m.m05, m06 = m.m06, m07 = m.m07,
            m12 = m.m12, m13 = m.m13, m14 = m.m14, m15 = m.m15;

        let r = color.r / 255.0;
        let g = color.g / 255.0;
        let b = color.b / 255.0;
        let a = color.a / 255.0;

        let vertexOffset = 0;
        for (let i = 0; i < vertexCount; i++) {
            const vert = dataList[i];
            const x = vert.x;
            const y = vert.y;
            let rhw = m03 * x + m07 * y + m15;
            rhw = rhw ? 1 / rhw : 1;
            vData[vertexOffset + 0] = (m00 * x + m04 * y + m12) * rhw;
            vData[vertexOffset + 1] = (m01 * x + m05 * y + m13) * rhw;
            vData[vertexOffset + 2] = (m02 * x + m06 * y + m14) * rhw;
            //Color.toArray(vData, color, vertexOffset + 5);
            //const scale = (a instanceof Color || a.a > 1) ? 1 / 255 : 1;
            vData[vertexOffset + 5] = r;
            vData[vertexOffset + 6] = g;
            vData[vertexOffset + 7] = b;
            vData[vertexOffset + 8] = a;

            vertexOffset += 9;
        }

    }

    // fill index data
    const bid = chunk.bufferId;
    const vid = chunk.vertexOffset;
    const meshBuffer = chunk.meshBuffer;
    const ib = chunk.meshBuffer.iData;
    let indexOffset = meshBuffer.indexOffset;

    for (let i = 0, count = vertexCount / 4; i < count; i++) {
        const start = vid + i * 4;
        ib[indexOffset++] = start;
        ib[indexOffset++] = start + 1;
        ib[indexOffset++] = start + 2;
        ib[indexOffset++] = start + 1;
        ib[indexOffset++] = start + 3;
        ib[indexOffset++] = start + 2;
    }
    meshBuffer.setDirty();
    meshBuffer.indexOffset += renderData.indexCount;

}

const inject_Label = function () {

    const tempColor0 = new Color(255, 255, 255, 255);
    const tempColor1 = new Color(255, 255, 255, 255);
    const bmfillBuffers = function (comp: Label, renderer: any) {
        if (!comp.renderData) {
            return;
        }
        const node = comp.node;
        tempColor0.set(comp.color);
        tempColor0.a = node._uiProps.opacity * 255;
        // Fill All
        fillMeshVertices3D(node, renderer, comp, tempColor0);
    };
    const lefillBuffers = function (comp: Label, renderer: any): void {
        if (!comp.renderData) {
            return;
        }
        const node = comp.node;
        tempColor1.a = node._uiProps.opacity * 255;
        // Fill All
        fillMeshVertices3D(node, renderer, comp, tempColor1);
    };

    //@ts-ignore
    Label.prototype.useMult = true;
    //监听 Label 的 uv 变更
    const label = Label.Assembler;
    if (label) {
        const getAssembler = label.getAssembler;
        label.getAssembler = function (comp: Label) {
            const assembler: any = getAssembler.call(this, comp);
            if (assembler.changeColor == undefined) {
                assembler.changeColor = function (s: any) {
                    let rd = s.renderData;
                    if (rd && rd.chunk) {
                        rd.dataDirty = 1;
                    }
                };

                const flag = comp.font instanceof BitmapFont || comp.cacheMode === Label.CacheMode.CHAR;

                const updateColor = assembler.updateColor;
                assembler.updateColor = function (comp: Label) {
                    updateColor.call(this, comp);
                    const renderData = comp.renderData;
                    if (renderData && !JSB) {
                        this.changeColor(comp);
                        if (!flag) {
                            const vData = renderData.chunk.vb;
                            for (let i = vData.length, j = 5; j < i; j += 9) {
                                vData[j] = vData[j + 1] = vData[j + 2] = vData[j + 3] = 1;
                            }
                        }
                    }
                }


                if (flag) {
                    // const updateUVs = assembler.updateUVs;
                    // assembler.updateUVs = function (comp: Label) {
                    //     updateUVs.call(this, comp);
                    //     this.changeColor(comp);
                    // }

                    if(Label_Passive_ptimization){
                        const updateUVs = assembler.updateUVs;
                        assembler.updateUVs = function (comp: Label) {
                            updateUVs.call(this, comp);
                            this.changeColor(comp);
                        }

                        if (comp.font instanceof BitmapFont) {
                            assembler.fillBuffers = bmfillBuffers;
                        } else {
                            assembler.fillBuffers = lefillBuffers;
                        }
                        
                    }else{
                        const fillBuffers = assembler.fillBuffers;
                        assembler.fillBuffers = function (comp: Label, renderer: any) {
                            fillBuffers.call(this, comp, renderer);
                            this.changeColor(comp);
                        }
                    }
                }
            }

            return assembler;
        }

    }

}

const inject_Sprite = function () {
    //@ts-ignore
    Sprite.prototype.useMult = true;
    //监听 sprite 的 uv 变更
    const sprite = Sprite.Assembler;
    if (sprite) {
        const getAssembler: any = sprite.getAssembler;
        sprite.getAssembler = function (comp: Sprite) {
            const assembler = getAssembler.call(this, comp);
            if (assembler.changeColor == undefined) {
                assembler.changeColor = function (s: any) {
                    let rd = s.renderData;
                    if (rd && rd.chunk) {
                        rd.dataDirty = 1;
                    }
                };

                const updateColorLate = assembler.updateColorLate;
                if (updateColorLate) {
                    assembler.updateColorLate = function (comp: Sprite) {
                        updateColorLate.call(this, comp);
                        this.changeColor(comp);
                    }
                } else {
                    const updateColor = assembler.updateColor;
                    if (updateColor) {
                        assembler.updateColor = function (comp: Sprite) {
                            updateColor.call(this, comp);
                            this.changeColor(comp);
                        }
                    }
                }
            }

            return assembler;
        }
    }
}


const inject_MotionStreak = function () {
    if (MotionStreak) {

        const motionStreak: any = MotionStreak.prototype;
        motionStreak.useMult = true; //参与多纹理合批

        const lateUpdate = motionStreak.lateUpdate;
        motionStreak.lateUpdate = function (dt: number) {
            lateUpdate.call(this, dt);
            if (this._assembler) {
                if (this.points.length >= 2) {
                    let rd = this.renderData;
                    //全局标记刷新纹理uv
                    rd && (rd.dataDirty = 1);
                }
            }
        }
    }
}


const inject_TiledLayer = function () {
    if (TiledLayer && !JSB) {

        const Tiled: any = TiledLayer.prototype;;
        Tiled.useMult = true; //参与多纹理合批
        Tiled.dataDirty = false; //全局标记刷新纹理uv

        const setUserNodeDirty = Tiled.setUserNodeDirty
        Tiled.setUserNodeDirty = function (dirty: boolean) {
            setUserNodeDirty.call(this, dirty);
            if (!dirty) {
                //全局标记刷新纹理uv
                this.dataDirty = true;
            }
        }

        Tiled._render = function (ui: any): void {
            const layer = this.node.layer;
            for (let i = 0, j = 0; i < this._tiledDataArray.length; i++) {
                this._tiledDataArrayIdx = i;
                const m = this._tiledDataArray[i];
                const info = this._drawInfoList[j];
                if (m.subNodes) {
                    // 提前处理 User Nodes
                    m.subNodes.forEach((c: any) => {
                        if (c) {
                            ui.walk(c.node);
                            j++;
                        }
                    });
                } else {
                    const td = m as TiledRenderData;
                    if (td.texture) {

                        let isDirty = false;
                        let rd: any = td.renderData!;
                        rd.material = this.getRenderMaterial(0);
                        if (rd.texture !== td.texture) {
                            rd.texture = td.texture;
                            // isDirty = true;
                        }

                        if (rd.layer !== layer) {
                            rd.layer = layer;
                            isDirty = true;
                        }

                        rd.isMult = true; //强制参与多纹理

                        // if (JSB) rd._renderDrawInfo = info;

                        //更新renderdata hash
                        isDirty && rd.updateHash();

                        if (this.dataDirty) rd.dataDirty = 1;

                        // NOTE: 由于 commitComp 只支持单张纹理, 故分多次提交
                        ui.commitComp(this, td.renderData, td.texture, this._assembler, null);

                        j++;

                    }
                }
            }

            this.dataDirty = false;
            this.node._static = true;
        }
    }
}




game.once(Game.EVENT_ENGINE_INITED, () => {

    if (!enableMultTextures()) return;

    inject_Label();
    inject_Sprite();
    //inject_UIRender();
    inject_Renderdata();
    inject_TiledLayer();
    inject_MotionStreak();

    director.on(Director.EVENT_AFTER_DRAW, (dt) => {
        MultBatch2D.reset();
        _cacheUseCount = 0;
    });

    if (JSB) return;

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    // 多纹理合批，合批核心过程修改
    ///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

    const Batcher2D: any = cclegacy.internal.Batcher2D.prototype;

    Batcher2D.isMult = false; //多纹理标记
    Batcher2D.isNative = JSB; //原生的开关
    Batcher2D.cacheTextures = []; //纹理缓存数据
    Batcher2D.currMaterial = null;//当前指定材质
    Object.defineProperty(Batcher2D, "_currMaterial", {
        get: function () {
            return this.currMaterial;
        },
        set: function (material: any) {
            // if (this.currMaterial === material) return;
            //检测多纹理材质，接替 _currMaterial
            let rd = this._currRenderData; //重置检测
            if (material == this._emptyMaterial) rd = null;
            this.currMaterial = getMultMaterial(material, rd);
            this.isMult = false;
            if (MultBatch2D.enable) {
                if (this.currMaterial && this.currMaterial.isMult) {
                    this.cacheTextures = this.currMaterial.cacheTextures;
                    this.isMult = true; //当前 batcher 多纹理标记
                }
            }
        }
    });


    const Stage_ENTER_LEVEL = 2;
    const Stage_ENTER_LEVEL_INVERTED = 6;
    //@ts-ignore
    type TextureBase = __private._cocos_asset_assets_texture_base__TextureBase;
    Batcher2D.commitComp = function (comp: UIRenderer, renderData: BaseRenderData | null, frame: TextureBase | SpriteFrame | null, assembler: any, transform: Node | null) {


        let dataHash = 0;
        let mat: any = null;
        let bufferID = -1;

        if (renderData && renderData.chunk) {
            if (!renderData.isValid()) return;
            dataHash = renderData.dataHash;
            mat = renderData.material;
            bufferID = renderData.chunk.bufferId;
        }

        // Notice: A little hack, if it is for mask, not need update here, while control by stencilManger
        if (comp.stencilStage === Stage_ENTER_LEVEL || comp.stencilStage === Stage_ENTER_LEVEL_INVERTED) {
            this._insertMaskBatch(comp);
        } else {
            comp.stencilStage = StencilManager.sharedManager!.stage;
        }
        const depthStencilStateStage = comp.stencilStage;



        let texID = -1;
        let texture = null;
        let MB = MultBatch2D;
        let flushBatch = false;
        //@ts-ignore
        if (MB.enable && renderData && renderData.isMult) {
            if (frame && frame.isValid)
                texture = frame.getGFXTexture();

            if (texture) {

                //@ts-ignore
                if (texture.texID === undefined) texture.texID = -1;

                //@ts-ignore
                texID = texture.texID - MB.incID;
                flushBatch = texID < 0 && MB.count >= MAX_TEX;
                if (this.isMult) mat = this._currMaterial;
            }
        }

        if (flushBatch
            || this._currHash !== dataHash || dataHash === 0 || this._currMaterial !== mat
            || this._currDepthStencilStateStage !== depthStencilStateStage) {
            // Merge all previous data to a render batch, and update buffer for next render data
            this.autoMergeBatches(this._currComponent!);

            if (renderData && !renderData._isMeshBuffer) {
                this.updateBuffer(renderData.vertexFormat, bufferID);
            }


            this._currRenderData = renderData;
            this._currHash = renderData ? renderData.dataHash : 0;
            this._currComponent = comp;
            this._currTransform = transform;
            this._currMaterial = comp.getRenderMaterial(0)!;
            this._currDepthStencilStateStage = depthStencilStateStage;
            this._currLayer = comp.node.layer;
            if (frame) {
                if (DEBUG) {
                    assert(frame.isValid, 'frame should not be invalid, it may have been released');
                }
                this._currTexture = frame.getGFXTexture();
                this._currSampler = frame.getGFXSampler();
                this._currTextureHash = frame.getHash();
                this._currSamplerHash = this._currSampler.hash;
            } else {
                this._currTexture = null;
                this._currSampler = null;
                this._currTextureHash = 0;
                this._currSamplerHash = 0;
            }
        }

        if (assembler.fillBuffers) assembler.fillBuffers(comp, this);


        if (texture && this.isMult) {

            if (texID < 0 || MB.count === 0) {

                texID = MB.count++;
                //@ts-ignore
                //let id = texture.objectID;
                //@ts-ignore
                texture.texID = texID + MB.incID;

                let caches = this.cacheTextures;
                if (caches[texID] !== texture) {
                    caches[texID] = texture;
                    //@ts-ignore
                    texture = frame.texture;
                    if (!texture) texture = frame;
                    this._currMaterial.setProperty("texture" + texID, texture);

                }
            }

            this.fillTextureID(renderData, texID);
        }

    }

    //填充多纹理 id 到顶点数据 , 压缩到color.a个位
    Batcher2D.fillTextureID = function (renderData: any, texID: number) {

        // if (!renderData) return;
        let vbuf = renderData.chunk.vb;
        let uvX = 0, length = vbuf.length;
        if (renderData.dataDirty === 1) { //3
            for (let i = 0; i < length; i += 9) {
                uvX = ~~(vbuf[i + 5] * 100000);
                vbuf[i + 5] = uvX * 10 + texID;
            }

        } else {
            if (renderData.texID !== texID) {
                for (let i = 0; i < length; i += 9) {
                    uvX = ~~(vbuf[i + 5] * 0.1);
                    vbuf[i + 5] = uvX * 10 + texID;
                }
            }
        }
        renderData.dataDirty = 0;
        renderData.texID = texID;
    };
});

//*/

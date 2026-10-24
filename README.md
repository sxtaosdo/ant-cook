# 4060（Ant Cook）联合产品

**当前版本：`v0.3.0.124`**

状态: Draft

2026-10-20 蚂蚁棋盘程序入场动画（源码本地检查点 v0.3.0.110 `add00a2`，未发布）：主线与每日新棋盘由中心向外逐格升起、短暂停留、错峰回落并轻微压缩回弹，搭配浅投影、淡金涟漪及暂存槽/数字队列淡入，总时长1.18秒。所有表现复用现有棋盘格与Cocos绘图，不增加美术文件；落定后恢复精确位置和暴露格缩放，退出/重建取消动画并结清等待，期间保留选块输入门。Node22 strict、新增7项及标准410/410测试通过，独立只读复审和OCR宿主审阅无确定缺陷。Creator3.8.8最终源码导入/编译与标准刷新通过，GM隔离档中28/28原生步骤覆盖结算预览实际触摸3→4→5、升起/回落/落定帧、第16关大棋盘及已解锁每日挑战，四类运行诊断0；5张750×1334 PNG中设备画布实际为393×852，不能当作750×1334设计画布或真机性能验收。保留首次测试档未解锁每日的失败回执。采集基于v109及本次源码/受保护Owner工作树，尚无干净发布构建或正式产物关联；未配置独立远端，本地检查点不代表发布。证据：`C:/Users/33272/AppData/Local/Temp/4060-ant-board-entrance-20261020/`。

2026-10-19 Cook Pause离线源码准备完成：从余7页选择现有三按钮暂停页作为最小切片，源码检查点 v0.3.0.108 `807f008df82da0c79356ca508e40f37e9a658cd4` 增加9项可选类型化绑定、只读余额/冻结进度投影及固定根保护；继续使用原继续营业、重新开始、退出关卡意图和双重输入门。未绑定时保留旧动态页，缺失/跨树/重复/损坏绑定明确失败；Kitchen/Pause/Result往返清除旧触摸目标与HUD引用。Node22.23.3源码strict、新增5/5暂停页VM回归及6文件Cook Provider 36/36通过，cc/MK绘图与IO为替身；独立四文件只读复审无确定P1/P2，硬隔离未核验。组测首轮漏带既有TS loader且Map静态测试错误遍历Level背景的失败回执保留；已修正运行命令，并将纯色断言限定Map子树，不改资源或放宽Map内部检查。本轮按授权未调用Creator/Preview/共享daemon或桌面，Prefab/Scene/Meta和71份保护文件保持，真实存档未操作。下一次拟仅经Creator为 `KitchenFlowGroup.prefab` 制作沿用当前 `showPause/frame` 布局的暂停树并落实9绑定；39新节点方案仅作待协调候选，未执行或批准该具体事务。未找到独立完整11页清单，不据此新增设计；页面本地验收仍 **4/11**，正式关联仍 **UNCONFIRMED**。交接与候选范围：`C:/Users/33272/AppData/Local/Temp/4060-next-fixed-ui-offline-20261019-073202Z/`。

2026-10-19 Cook Level固定UI本地切片完成：源码检查点 v0.3.0.104 `35d93883ed446e12e9020dfe75695be0e5f77607` 增加15项可选绑定及六格只读投影，沿用原布局、素材、分页、0–3星与绝对关卡索引；共享Map/Level/Story保留固定根，未绑定Level根时兼容原动态页面，损坏绑定明确失败。Node22.23.3已有6/6实际View/Presentation隔离VM回归及源码strict通过，cc渲染/资源为替身；本轮不重复执行这些测试。

用户批准82节点/15绑定后，经Creator 3.8.8标准事务 `afd7130b-4212-47f9-ab66-1d2fefb710f8` 保存，关闭复开后revision `rev-fd9c9ef8`；MapFlowGroup共199节点且全部UI_2D，原Map的354项节点/组件内容不变，三个槽位数组各6项，原level.jpg静态引用保持。资源检查点 v0.3.0.106 `ae3bbe2f01c396493302c95c73bb00a535856086` 只包含该Prefab及Hook版本镜像。OCR资源1/1宿主审阅及独立只读复审无确定P1/P2，硬隔离未核验；额外保存曾给Bootstrap写入三个默认字段，已仅回滚该次意外改动并标准刷新，最终71份保护文件逐字节保持。

750×1334 fresh isolated原生操作 `f13bab64-b0e9-4c41-95d0-61b4ef242142` 查得SUCCEEDED，58/58步骤、四类运行诊断0。14张PNG均核对尺寸，8种独立画面已直接查看；锁定格/首末页越界/末页隐藏格点击后图像字节一致，分页、返回地图、共享Story往返、重入复位和首关开局正常。原生仅覆盖默认首餐厅/首关解锁，0–3星和其他餐厅索引仍以离线回归为据。采集基线为v105加该资源及受保护Owner工作树，不是v106或后续文档版本的干净构建；0样本Profiler不作性能证明，正式产物关联仍 **UNCONFIRMED**。Cook固定UI本地进度现为4/11。Creator及7457已关闭、心跳结束、fence39正常RELEASED；共享daemon仍有原nativeUncertain=2和NATIVE_OUTCOME_UNCONFIRMED，未清除或冒称全局排空。真实存档未操作，既有55步与三包不重跑；证据：`C:/Users/33272/AppData/Local/Temp/4060-level-approved-20261019-064520Z/`。

2026-10-17 Cook Map本地切片已完成保存、复开与750×1334画面/触摸核对：v102 `287e2f23818c7cedaad12dd8aa4fbf6d9be5ad91` 的 `MapFlowGroup.prefab` 保留117节点、18项类型化绑定和原六卡/四入口布局；116个新增节点的图层修复后，全树为UI_2D，复开revision为 `rev-ea33d134`。既有9/9存盘资产与View/Presentation回归、v101源码strict及21项Map/设置/Host结果保留，本次只审核现成证据，没有重跑测试或作者化。

原生操作 `8a9b3a62-27e1-425e-8270-d62ecd3acf6c` 查得SUCCEEDED，55/55步成功、无跳过；isolated浏览器未复用浏览器或页面，四类原始诊断均为0。17张PNG逐项核对均为750×1334，共6种独立画面已直接查看：首卡进入“煎饼早餐”关卡页，四入口进入工位升级、餐厅装修、剧情档案、设置与无障碍；五张锁定卡触摸后仍在Map，五次返回与最终Map均与初始Map的PNG字节一致。六卡、标题/货币栏与底部入口可见，Map/level/story共享View往返没有残留页面。这里只覆盖默认首卡解锁、其余五卡锁定的状态，不把入口页计为固定UI作者化完成。Cook固定UI本地切片验证现为3/11；正式Creator产物关联仍为 **UNCONFIRMED**，不等同服务端正式验收通过。

本轮授权窗口沿11:23:35 UTC原起点计时；首次因漏补编译/刷新前置被拒后，先查询原操作FAILED并停机，再补标准前置继续，未重置计时。第二次完成后于11:26:45 UTC关闭，含中间诊断等待累计约190秒；Creator/7456已关闭，fence35已释放，71份保护文件保持。审核时再次确认Creator及7456为空；本次未重开端口、重放原生操作、运行模型或上传。原失败回执保留。作者化证据在 `C:/Users/33272/AppData/Local/Temp/4060-map-prefab-native-20261017-104927Z/`；本轮原生回执、17图清单与逐项审核在 `C:/Users/33272/AppData/Local/Temp/4060-map-native-preflight-20261017-111814Z/prerequisites-resume/` 的 `native-result.json`、`timed-native-result.json`、`screenshot-manifest.json` 与 `visual-review.json`。

2026-10-17 离线验收补缺：修复 `tests/cook/cook-level-session.test.ts` 的迁移后路径，提供独立内存 save scope，并按现行业务读模型验证厨房、结算、重试、下一关、退出与重置，不再读取已移交 PageState 的 `screen`。三项会话测试加入标准 `test`，另有 `test:cook-session` 同时检查测试 strict 与执行。Node 22.23.3 下标准测试从380项增至383项，383/383通过、无skip；现行源码与会话测试 strict 均通过。旧 Cook application/save/boot 验证入口仍有历史路径及旧API假设，本次没有把它们计为通过，也未改业务、资源、真实存档或平台配置。完整日志与剩余项见 `C:/Users/33272/AppData/Local/Temp/4060-v99-offline-remaining-20261017-101201Z/`。

三包构建仍以 v99 `d17fbebd2e8969e0cf6dd2210ac34ffba76d6b43` 的独立回执为准：Ant/Cook/Both 3/3、六次启动与三组隔离运行通过，证据为 `C:/Users/33272/AppData/Local/Temp/4060-v99-independent-build-20261016-084816Z/`。Level完成后，Cook固定UI还余7页（kitchen、pause、result、upgrade、decor、story、unlock）；MapFlowGroup已有Map/Level固定树，story仍走原动态页面，另两组Prefab尚待作者化。第7关全程Profiler及真实设备温度/GC仍未完成。此次文档检查点不重跑构建，旧UNKNOWN Build和正式Creator Preview关联UNCONFIRMED分别保留。

2026-10-16 每日挑战提示布局窄修：仅在 `ColonyHudView.setDailyChallenge` 中将既有 `FeedbackLabel` 居中移回 HUD 提示行（局部坐标 `0, -42`），避免“每日挑战 · 免费无限重试”覆盖棋盘顶行；沿用原文字、字号和颜色，主线仍由原皮肤布局恢复坐标，不修改 Prefab、玩法或弹窗样式。修复前后截图及 750×1334 隔离 Preview 回执保存在 `C:/Users/33272/AppData/Local/Temp/4060-daily-feedback-layout-20261016-0407Z/`，实际结果以该目录回执为准。原 UNKNOWN Build 保持原记录，本轮不 Build；正式 Preview 产物关联仍为 UNCONFIRMED。

项目代号为 4060；物理目录仍为 `ant-cook`，存档 namespace 和两个玩法名称保持现有合同。

本目录是两玩法联合工程的未交付实现。Creator 3.8.8；Owner 已确认初始版本基线 0.3.0.0，正常版本 Hook 为本地检查点递增第四段；尚未配置独立远端或发布。

共享入口代码位于 `assets/shell/`。Ant 继续使用 `Colony / ColonyGame`，Cook 继续使用 `game / Game`，各自持有玩法状态和经济。新数据分别写入 `p4000.ant-cook.dev1.ant.*`、`cook.*` 和 `shell.*`，不读取、改写或清除两个旧工程的真实存档。

P0002 以 `extensions/shidai3` Git submodule 消费。当前实际依赖为 `39f168e7abdac9215d0ea21f2a5a3585262e9970`（v2.7.0），产品 gitlink 与消费测试已精确提交为 `v0.3.0.78 / ae80d6ccc12458c60a9e1214bafc315f939286ca`，文档单独形成检查点。4060 与 P1060 的依赖物理 checkout 已核实独立；通过正常本地 Git fetch／checkout 消费已批准提交，框架 tracked／staged 文件保持干净，31 份既有未跟踪 Creator Meta 原样保留。ProductBootstrap 实际导入公共 `LoginFacade` 与 observability，Shell 独占一个默认关闭的 facade；启动仅创建并读取游客状态，不调用登录或等待认证。设置只收到状态／反馈／操作可用性的窄投影，玩家显式点击才请求登录，pending 可取消，active 可退出；缺配置显示“登录暂不可用，离线玩法可继续”。账号刷新与动作使用独立通道，不占资料保存 busy、不调用进度快照、不覆盖昵称／头像草稿或资料反馈；关闭设置释放视图订阅，Shell 销毁 dispose，旧 entry 和 generation 不允许派发命令或回填。账号不绑定本地资料、不迁移账户，也不改任何存档命名空间。遥测默认关闭和缺来源／构建元数据拒绝记录的规则保持。

2026-10-11 账号绑定兼容验证：旧 Settings Prefab 缺少 `accountStatusLabel`／`accountActionButton`／`accountActionLabel` 时，原设置仍可保存昵称、切换头像和关闭；空闲资料反馈区显示“登录界面暂不可用，离线玩法可继续”，每个视图生命周期仅记录一次 `SETTINGS_ACCOUNT_UI_UNAVAILABLE`，不派发账号动作、不误报登录可用。部分绑定同样禁用；资料反馈优先于不可用提示。实际读取 v67 `c9818cd67ab1f1845e84893e7d00982be1db0258` 的 270 对象 Prefab 与当前 Owner 的 256 对象 Prefab，分别结合新源码执行隔离 VM 测试：cc／资源生命周期为替身，不是原生运行验收。Node 22.23.3 strict 通过；最终账号 9 项、资料自动保存 11 项、实际 Bootstrap 2 项共 22 项唯一消费者覆盖及 36 项货币／弹窗／加速／商城回归通过。干净检出不含新账号行时，该 Owner 资产专属测试明确 skip，其余兼容覆盖照常执行。已从该源码提交和精确框架 pin 分别 Git archive 导出，逐字节核对产品 1275 文件和框架 185 文件：旧 270 对象 Prefab、无账号三绑定；strict 通过，定向 22 项中 21 通过／1 项 Owner 行专属 skip。验证依赖为现有 Node 22、三包只读副本、Creator 声明及固定旧提交的只读 Git 历史；首次 junction 被本机权限拒绝后保留失败回执，没有改权限。此结果证明干净源码不依赖未提交账号行，不表示原生 Creator 验收。

已有标准 Creator 3.8.8 证据：Settings 新增 3 个固定节点／3 个序列化绑定并保存、关闭、复开读回，Settings 与 Bootstrap 编译通过；750×1334 全新隔离 browser/context 配合既有 GM 内存夹具完成 20 步，未配置账号行、按钮点击、关闭复开及顶部货币显隐可观察，四类诊断均 0。此证据对应 v67 加兼容补丁前的已授权工作树，当前完整账号行路径保持；新增旧资产降级路径由上述源码／图夹具验证，未另做原生运行。工具步骤 PASSED，服务端产物关联仍为 UNCONFIRMED；这不是平台 SDK／真实后端或性能通过。短采样另有 PERF_BUDGET 提示，不能作为第 7 关性能结论。原图位于 `temp/creator-ai-bridge/screenshots/4060-account-disabled-settings-750x1334-1791702078193.png` 与同目录 `4060-account-disabled-settings-reopened-750x1334-1791702079819.png`，画面版本为 v67 加当时工作树；本轮 Library helper 在 prepare 阶段不可用，尚未取得这两张图片的附件 ID。

Settings 账号行资产仍未纳入提交。HEAD 的 270 对象、Owner 原基线的 236 对象和 Creator 保存后的 256 对象不能直接混用引用索引；只读图检查确认仅 SettingsRoot 追加子节点和 SettingsView 新增三引用，其余 Owner 属性保留，所有引用有效。本轮通过可选绑定解耦源码，既不脚本重排 Prefab，也不整份暂存 Owner 改动。干净检出保留旧设置与稳定不可用提示，不能称已包含新账号行。`C:/Users/33272/AppData/Local/Temp/4060-auth-consumption-20261011/settings-owner-recovery/` 保存逐字节前后备份、`owner-236-to-256.patch` 与 SHA256 manifest；该补丁只比较精确 Owner 236 对象基线与 256 对象结果，不适用于 HEAD 270 对象。后续恢复须核对基线哈希并沿标准 Creator 入口处理。现有 9 份 framework meta 字节未改，未手写新 meta；无 push、tag 或根父 pin 变更。

唯一 MK 能力提供者来自 v1.1.5；本副本局部修正场景取消、main 初始化等待、UI 注册身份、注销与失败清理、池迟到资源释放及 strict 类型，不能称为未修改的原版 MK。没有引入第二套 UI、资源、音频或池运行时。

验证使用 Node 22：`npm run typecheck` 与 `npm test`。执行集合为 `tests/unit`、`tests/provider` 及 `tests/ant/application/rewarded-ads.test.ts`；Provider 测试运行实际 MKUIManage、MKBundle、MKObjectPool、MKStatusTask 源码，但 cc、IO、Release/View/Event 辅助能力使用替身，不是 Cocos Runtime 验收。其余 `tests/ant` 和 `tests/cook` 是迁移时保留的来源测试材料，其中旧迁移断言不属于新产品兼容合同。Provider 的严格类型差异检查见 `P8000/dual-game-build/provider-typecheck.mjs`；仅证明相对字节核实的来源 baseline 无新增诊断，不表示 Provider 零诊断。

2026-10-16 广告适配器回归检查点 v0.3.0.95 `eb5d041102f5298fe7c072f33e402dcba2a5e0a8`：修正迁移测试的相对导入（原路径误指向不存在的 `tests/assets`），把原有12项测试纳入标准入口，未改断言或业务代码。修前实际报 `ERR_MODULE_NOT_FOUND`；修后 Node 22.23.3 定向12/12、零跳过，适配器及测试 strict 通过。覆盖完整观看、取消、失败、重复／迟到回调、并发、换局、销毁及原奖励保存失败重试；平台和存储回调为替身。本轮未重跑完整 `npm test` 或已收束的 Speed 验收，不代表真实 SDK、Creator 或真机通过。OCR 宿主审阅和独立 reviewer 均无确定发现；硬隔离未核验。

`P8000/dual-game-build/build-input.mjs` 在任务 Temp 目录创建独立 Creator 输入，支持 `ant`、`cook`、`both`，物理排除未选玩法。`SHARED_ASSETS.json` 记录通用遮罩纹理的构建期共享归属，纹理和 meta 保留原字节及 UUID；原目录不移动。工具拒绝没有 Creator 保存的 `assets/shell/Bootstrap.scene` 的正式输入。

Bootstrap.scene 已由 Creator 3.8.8 创建、绑定 ProductBootstrap、保存并回读；Bridge 0.3.118 已获批安装登记。Preview 已验证两个来源入口、双向往返、退出保存故障重试及持续就绪。蚂蚁界面调整通过 Creator 保存。正式构建使用工具生成的隔离输入，排除 P0002 的开发示例入口；运行、多尺寸和产物验收以对应源码 SHA 的本次任务回执为准，业务替身测试不能代替它们。广告单元、AppID和远程服务尚未配置。

2026-10-16 工具链核查：历史 Node22 不能启动当前 Companion 的原生 SQLite 依赖，隔离内存检查确认 ABI 127 与已编译模块 ABI 141 不符；未安装或重编依赖。随后宿主标准查询确认已有 Node25.2.1 Daemon、准确的4060工程、零 inflight 和 RELEASED 租约；未将其他执行产生的新实例归为本任务启动成功。Creator info／Preview status 均返回 Bridge `127.0.0.1:6525` 连接拒绝，因此未启动 Creator、刷新 Preview 或执行新试玩。实际运行入口 SHA 与磁盘一致，其生产产物关联仍默认 `unconfirmed`，不使用 test-only 开关提升验收。真实登录保持关闭、三个广告位为空、支付仍为不可用占位；正式产物关联、真实 SDK／后台和真机性能继续待验。回执目录：`C:/Users/33272/AppData/Local/Temp/4060-sdk-resume-20261016-010555/`。

同日后续 Preview 恢复（采集源码 v0.3.0.96 `b4af43606e69a360c1e5c3e50856162c80da70d1` 加保留的 Owner 工作树）：父任务确认 P1060 终态后，只读核实其 fence32 为 EXPIRED，未改称 RELEASED。正常取得4060 fence24，以现有 Node25.2.1 和稳定 operationId 经原 `creator_start`／Dashboard 入口启动独立 Creator PID17780；3.8.8、工程指纹及会话 `ba55e900-c0ad-4db7-af60-9494acd53e7c` 已读回。Bootstrap 文档 revision `rev-b93bd451`；真实编译返回 compiled／imported／componentRegistered、errors为空，Node22.23.3 项目 strict 通过。4060 Preview 在7457，P1060仍在7456；P1060 PID7216和Dashboard21728保留，前后URL／启动时间／会话不变。首次只读P1060连接数已为0，交接信息曾为1，不能声称保留了一条实际已核实在线连接；本任务未停止、刷新或关闭它。

750×1334 两次独立浏览器／上下文原生运行分别15/15、10/10，四类运行诊断均0，四张PNG冻结。通过公开测试桥打开／关闭设置并观察真实界面，未编辑资料或验证真实触摸／保存。首轮设置截图处于既有0.32秒币栏入场动画，保留上缘1397.6的过渡帧；600ms后补查及看图确认稳定币栏 `y=1269,height=65`、上缘1334、安全区偏移0，关闭后首轮亦已等待至隐藏。用于独立上下文的标准 profilerCapture 请求采样时长0，实际0样本，不构成性能通过。服务端 verificationId `55de8776-9553-4ca3-9aed-b6da3ed763b1` 的正式产物关联仍为 UNCONFIRMED：缺编译完成事件及页面可回传的产物标识。四个原操作均查询为SUCCEEDED，fence24正常RELEASED、心跳结束、inflight全0／unknown空；共享daemon未重启。71份保护文件、框架pin及既有Owner改动保持，无Prefab／Scene／Meta直接写入、真实SDK或新Build／Smoke。此证据不代表后续文档版本的干净构建。回执目录：`C:/Users/33272/AppData/Local/Temp/4060-preview-handoff-20261016-014548/`。

2026-10-16 主题收集行布局修正：当前列表使用 `progress.prefab` 内嵌 Row0，`progressView.renderRow` 的主题行分支把标题／进度向左移到摊位图标内。本次仅将两处文字横坐标恢复为既有带图标行的 -35，保留图标、按钮、字号、行尺寸和其他行布局；未接入或改写 Owner 未跟踪的独立行 Prefab。修改前逐字节恢复快照已保存，Node22 strict 已通过；修改后 Creator 导入及 750×1334 受影响页面在源码检查点后独立取证，结果记录于 `C:/Users/33272/AppData/Local/Temp/4060-theme-row-layout-20261016-103108/`，实际运行结果以该任务回执为准，正式编译产物与 Preview 关联仍待验证。前轮 GM 用例因误把调试菜单算作业务弹窗而失败，源码原本明确排除 GM；原 FAILED 回执保留，这是测试口径问题，不是本次修复的产品缺陷。

跨玩法推荐由业务模块提供可选的纯只读 `promotionReady()` 资格：Ant连续主线首通18关、永久引导完成或跳过且处于无弹窗安全首页；Cook首餐厅完成且成功保存、处于安全地图。Shell仅在双玩法构建、入口与恢复均就绪时展示现有原生选择面板，玩家主动选择才执行安全切换，不发放奖励。拒绝先保存到shell独立元数据，成功后同一来源方向7天内不提示；保存失败保留重试，同一会话每方向最多主动展示一次。两方向冷却独立，不保存永久停止标记；单玩法构建不展示推荐。

来源快照见 `MIGRATION_SOURCES.json`；功能状态见 `CHANGELOG.md`。

## 公共登录 Shell 接线

2026-10-11 源码检查点 v76 `e2bf0207bdce04054c07ad7c0a638602d336085b` 为 Shell 导航增加可选账号状态／动作绑定。View 只接收既有四字段 `ProductAccountProjection`，Bootstrap 持有唯一默认关闭的 `LoginFacade`；启动、渲染和切玩法不请求登录，玩家显式操作才沿 `requestLogin`／取消／退出进入公共会话。Ant／Cook 共用同一产品内存会话；账号 pending 不阻断继续玩法和重试本地记录，迟到凭据不发起新交换，销毁后不回写 UI。缺配置或可信交换时保持游客，并投影“登录未配置，可继续游客玩法”。

依赖消费检查点 v78 `ae80d6ccc12458c60a9e1214bafc315f939286ca` 已将产品 index／checkout 更新为 P0002 v2.7.0 `39f168e7abdac9215d0ea21f2a5a3585262e9970`，公开入口已提供 `DouyinCredentialAdapter`；v2.6.1 遥测边界修正与抖音登录 Port 随依赖消费。产品 `LoginFacade` 仍默认关闭，缺配置或可信交换时保持游客。本片只更新 4060 产品依赖与消费测试，不更新父仓 pin、不注入真实 credential／exchange、不接新 SDK，也不外发认证或遥测；真实存档与本地资料合同保持。

v76 在 P0002 v2.6.0 上通过 Node 22.23.3 strict 与受影响 Shell／切玩法／推荐生命周期 4 文件共 46 项离线测试（5 项新增及既有公共模块 2 项）。v78 在实际 v2.7.0 依赖上通过 strict 与公共模块／Shell 遥测 2 文件共 23 项消费测试（新增 2 项），验证启动和缺可信交换时零平台调用，以及显式操作后平台 code 仍须经可信交换才能激活会话。tt API／交换、cc、绘图及场景 IO 均为替身，未重跑无关全量套件。v78 的 gitlink 与测试 2/2 已经 OCR 选择并由宿主审阅，普通只读 reviewer 无确定 P1/P2，硬隔离未核验。v76／v78 检查时 ProductNavigation 尚无三项账号序列化绑定，两个历史源码片未修改 Prefab 或调用 Creator／Companion；2026-10-12 的绑定制作和最小 View 兼容修补见下述 v82 回执。**以上“新入口可见性、原生按钮触摸及生命周期仍待 750×1334 验收”是 v76／v78 记录时的状态；本轮仅完成默认游客路径验收。** v76 与 v78 证据分别位于 `C:/Users/33272/AppData/Local/Temp/4060-shell-login-20261011/` 和 `C:/Users/33272/AppData/Local/Temp/4060-framework-v27-consumption-20261011/`。

2026-10-13 v0.3.0.89 源码与受保护 Owner 工作树上的 750×1334 fresh isolated Edge 原生回执（operation `9eebff20-8352-44a6-b127-20c7a2ee6f52`）：66/66 步骤通过，四类运行诊断均为空。经 Ant 公开 `openProgress('settings')` 打开设置，再真实触摸“切换玩法”打开导航，验证游客／未配置状态、登录操作隐藏、继续当前玩法、切换 Cook 并进入地图设置、从 Cook 切换及返回 Ant；整页 reload 后再次打开导航，默认游客提示仍可见。三个阶段的 `playerId`、昵称、头像与注册时间逐项一致，15 张 PNG 已冻结。Node 22.23.3 strict 与公共模块／Shell／推荐生命周期定向测试 36/36 通过；71 个源码／Owner／既有 Meta 文件哈希保持，框架 32 份 Meta 与 pin 保留。此回执仅证明默认游客路径闭环；未注入认证 fakePort、未测真实 SDK／后端，pending／active／取消登录仍只有既有离线替身证据。该采集不是 v0.3.0.90 干净构建；正式 Creator 产物关联仍为 `UNCONFIRMED`，未做本轮新 Build／Smoke。短时 Profiler 的 `PERF_BUDGET` 提示保留（P95 16.8ms），不构成性能通过。Cook 固定 UI 第一切片现在为设置页，另外10页仍排队。证据见任务目录 `C:/Users/33272/.codex/visualizations/2026/10/13/01a133f1-2bf5-7e53-b874-df47dc8e19f0/p4060-shell-account/` 及其 `native-verification.json`。

## 加速弹窗、货币栏与设置的当前状态

2026-10-12 资源／源码检查点 v82 `1a397f27cd5d1091a2cb744df65315aaa1390ae5`：实际查看 Owner 原参考图后，经标准 Creator 事务保存倍速标题牌、两张信息卡、蓝色免费广告卡和底部返回区，保留原 7 Label／2 按钮绑定；ProductNavigation 新增 3 个固定账号节点并保存 3 项类型化引用，沿用现有 Graphics 底板例外。两份 Prefab 均关闭复开、按绑定角色回读通过。离线核对发现旧 View 拒绝新五底板且会覆盖保存的按钮坐标；最小修补精确兼容四／五底板，并首次缓存 Prefab 槽位，单 Cook、恢复双模式及重复 configure 不漂移。Node22.23.3 下实际保存导航资源消费测试 11/11、离线 strict 编译与序列化静态检查通过；引用、原节点标识、层级及 750×1334 静态边界有效。OCR 宿主审阅 4/4，普通独立只读复审确认两项缺陷关闭、无新增确定问题，硬隔离未核验。登录仍默认关闭，缺配置保持游客；Owner32／生产6／框架32份 Meta、保存的 Bootstrap 场景及 P0002 v2.7.0 pin 保持。Creator 已回到 Bootstrap，任务心跳结束、fence15 正常 RELEASED，窗口已交 P1060；此离线收束未调用 Creator／服务。v82／v83 记录时 Creator 编译桥、750×1334 原生可见性／交互、保存故障／免费倍速／倒计时和第7关失败重玩背景仍待下一窗口，不把替身或静态检查记为原生验收。资源阶段与离线证据分别位于 `C:/Users/33272/AppData/Local/Temp/4060-creator-authoring-20261012/` 和 `C:/Users/33272/AppData/Local/Temp/4060-creator-offline-final-20261012/`。

2026-10-12 v148 恢复后的原生阶段回执（截图采集为 v0.3.0.83 与受保护 Owner 工作树，不是后续文档版本的干净构建）：生产 daemon PID21252／epoch `a456eed2-6317-44b1-a416-99f72d7a94e2` 身份、4060 工程与旧租约 RELEASED 已经标准入口核实，新 fence16 实际取得。导航编译桥返回 imported／componentRegistered／errors[]；首次两步骤隔离试玩却在 wait_ready 确定失败，截图显示绑定不完整。只读检查发现预览 chunk 仍是旧四底板守卫；标准 AssetDB 精准刷新原导航源码后，导入哈希为 `cb7d03cfc1a93a85c6c67e6468b861210ee79cd6be59473ba9126059dd697f05`，预览 chunk 已包含四／五兼容和槽位缓存。重新标准核验、编译和刷新后，全新 operation 的 HOME 基线及倍速固定卡片截图各4步骤通过，逻辑／Canvas为750×1334、显示每日3分钟与免费广告2分钟，四类运行诊断均0。返回区真实 touch_tap 已派发且原 operation 查询为 SUCCEEDED，但未独立断言关闭完成；设置触摸截图仍在 HOME，不能算设置／账号入口验收通过。账号三绑定的原生显隐与动作、处理中／取消／重复点击／保存故障、免费收尾／倒计时及第7关失败重玩仍未验，不宣称整批通过或卡顿已解决。08:11断连通知后已查旧调用与租约，无未决写入或工具断连错误；心跳结束，fence16 经标准门正常 RELEASED，未强清、重启或处理 P1060 UNKNOWN。Owner32／生产6／框架32份Meta及真实存档保持，未改业务源码／Prefab／scene／meta或数值。原失败、更新前后chunk哈希、原operation终态、截图与报告见 `C:/Users/33272/AppData/Local/Temp/4060-native-resume-v148-20261012/`。

2026-10-12 当前源码检查点 v85 `2f793c02644b9a94e6f7429e837f9e6dba04f505`：修复业务弹窗前景资料条与首页／HUD 昵称、版本同时透出的重复显示。沿现有 View 切换有效 Label 的显隐，资料文字继续更新，退场完成或销毁后恢复；回调读取当前页面，覆盖迟建和替换。只修改四份业务脚本及一份定向测试，没有改 Prefab／scene／meta、货币数值或玩法。Node22.23.3 定向回归9/9、strict通过，OCR宿主审阅5/5和普通只读复审无确定P1/P2；硬隔离未核验。标准 AssetDB 精准刷新、编译及 Preview reload 后，已核对导入源码哈希与实际新 chunk。

本阶段原生采集版本为 v85 加受保护 Owner 工作树，不是后续文档版本的干净构建。750×1334 fresh browser/context 中，设置真实触摸链52/52通过：回车保存昵称、连续两次头像点击、实际关闭和重开、ID／注册时间保持、排行自我行与伙伴“我的资料”同步；速度页实际返回及设置两次关闭均解锁并隐藏货币栏。昵称／ID／日期／关闭按钮边界均在屏幕内，资源按既有自动保存合同没有保存按钮。28个业务直达入口两组各60步通过，另58步覆盖首页／玩法／建设／加载及Toast／GM排除、追踪回退、商城替换24帧不闪退与即时余额；对象详情由实际“详情”按钮进入。币栏稳定上缘1334、安全区偏移0，Speed截图只出现一组前景昵称／版本。

对象详情及Speed隔离端口链64/64通过：实际领取按钮等待时显示“处理中”，完整模拟视频仅增加120000ms且广告账本记一次；取消保持0、不可用按钮禁用，实际返回后解锁。v85记录时，奖励保存故障／重复等待点击及免费收尾／倒计时的当前原生复验仍待完成；后续本地闭环见下段，真实SDK仍未验。所有上述成功报告四类运行诊断均0；早期被新手引导或Shell推荐遮挡的设置探测仍保留FAILED，实际拒绝推荐后设置入口20/20通过，没有强制解锁或改推广规则。服务端 verificationId `a76ce524-fd2d-45a2-86cc-e7b0f9b78588` 的产物关联仍为 **UNCONFIRMED**，不以工具PASSED或刷新时间提升状态。主链及补充回执见 `C:/Users/33272/AppData/Local/Temp/4060-popup-closure-20261012-084708/primary-closure-evidence.json` 与 `remaining-native-evidence.json`；本阶段图片保存在项目screenshots目录，未复用旧Library文件ID冒称新上传。

2026-10-12 Speed续验：v87 `302483bb56824a590a3484e21018a017e8abfa70` 增加严格限定PREVIEW／GM激活／桥拥有的私有进度／testOnly端口的一次主奖励写故障，以及实际View按钮状态与模拟视频计数探针；原默认300ms完成时序、玩法和奖励规则保持。定向30项唯一覆盖由初轮29/30及新夹具初始化修正后4/4组成（既有26项未改），strict通过。v87真实倒计时观察到workers0时余额4000→3967ms，暴露与既有“仅搬运时消耗”合同不符的空闲扣时；v88 `81705b54b5ea51e55385fd396908c40cdf90652c` 仅将计时累计限定为实际活跃运输worker，保留预付lease、退款、跨日读取、免费收尾和耗尽弹窗守卫。新增回归修复前0≠1000明确失败，修复后计时22/22、strict通过；两片各OCR宿主2/2及普通只读复审无确定P1/P2，硬隔离未核验。

750×1334 fresh隔离原生：v87奖励链32/32通过，等待时真实领取／返回重复触摸被阻止，故障后余额和广告账本不变、同回执保留；重试与重复触摸仅获得120000ms和广告账本1，模拟load／show／close各1，私有Map重建仍保持。v88倒计时39/39通过：实际HUD进入2／3倍，空闲1秒500ms不变，Cocos hide／pause模拟1200ms余额不变，恢复后的实际运输耗尽至1倍／0并自动打开唯一Speed弹窗；实际关闭后不自行重开，显式空余额点击仍能再开并正常关闭。原1000ms样例在运输结束后剩67ms，未出现耗尽弹窗是正确行为，该终态FAILED探测保留，没有核销成通过。v88免费收尾30/30沿实际选堆／运输到最后合法delivery-14，不注入结果：先实际选择2倍保留1000ms预付，最后一堆触发freeFinish／3倍，有活跃worker；预算179000→180000完成退款，后续活跃500ms余额不减、boostMs和广告账本保持0，真实模型SUCCESS，退出及私有重载保持180000。API选堆与实际HUD／弹窗触摸分别记录，不冒称全局人工游玩。

这三份成功报告四类运行诊断均0，PNG已实际查看；采集为v87／v88加受保护Owner工作树，不是后续文档检查点的干净Runtime或正式构建。标准编译和实际chunk哈希已核对，服务端verificationId `d2ccf178-9f54-4209-b20c-de46588104b5` 的产物关联仍为 **UNCONFIRMED**。本地Speed故障／等待／倒计时／免费收尾闭环已完成；模拟视频不是平台SDK，Cocos暂停不是OS后台／真机验证，设备卡顿、发热及GC／分配调用栈仍开放。精确操作ID、报告SHA及图片索引见 `C:/Users/33272/AppData/Local/Temp/4060-speed-closure-20261012-103333/native-evidence.json`；前后失败和源码回执原样保留，Owner32／生产6／Meta／Bootstrap及P0002 pin保持，无真实档写入、push／tag或父pin更新。

2026-10-11 倍速弹窗新增布局参考：已按 Owner 明确提供的桌面文件实际看图（925×2048，359787 字节），确认独立标题牌、等宽横向卡片、蓝色免费视频卡和底部返回区。当前产品仍为每日赠送 3 分钟、广告领取 2 分钟，没有付费倍速 SKU；参考图的时长、价格和次数不进入业务合同。已准备固定 Prefab 的两张信息卡与一张免费广告卡布局，保留现有 7 个 Label、2 个按钮绑定及关闭/广告状态流程，详见 [布局准备方案](C:/Users/33272/AppData/Local/Temp/4060-speed-layout-reference-20261011/speed-layout-preflight.md)。v75 时仅完成看图和方案；2026-10-12 已按上述资源阶段回执完成标准 Creator 制作和复开读回，本阶段已完成 750×1334 原生布局截图，完整原生交互验收仍未完成，具体边界见上述阶段回执。

截至 2026-10-11，本轮实现已形成未发布本地源码检查点 v66 `f10e69c`。下述 Preview 截图采集时显示 v0.3.0.65，另含本轮已授权实现及保留的 Owner 工作区改动；它们不是 v66 干净检出或正式构建的验收。

2026-10-12 倍速弹窗交互源码检查点 v80 `8acf52a2fc58851ba2d0db629777f42b57760af4`：广告／奖励操作等待返回时，固定 View 同步显示“处理中”并禁用领取和关闭按钮；控制器沿用原有 busy 约束，取消／失败后恢复现有操作，打开复用 View 时重置局部等待状态。奖励保存失败继续显示“重试领取”，关闭仍保留原回执，重试不重复视频或已保存奖励；时长、余额、经济和存档规则不改。新增 5 项实际 View／Control／Presenter／奖励账本链路的隔离测试，cc、MK 资源生命周期、视频与存储端口为替身。Node 22.23.3 strict 通过；受影响 6 文件共 62 项唯一覆盖，首轮 36 项通过，26 项旧生命周期夹具因遗漏账号合同而在初始化失败，修改前 Control 已复现同错；补齐真实合同与独立 Settings 类型后仅复验这 26 项，全部通过，未放宽断言。OCR 宿主审阅 4/4，普通只读复审无确定 P1/P2，硬隔离未核验。v80 源码片未操作 Creator／daemon／租约或 Prefab／Meta；v82 已制作并保存上述参考布局，750×1334 按钮原生触摸仍待下一窗口。v80 证据位于 `C:/Users/33272/AppData/Local/Temp/4060-speed-interaction-20261012/`。

玩家点击既有加速入口打开专用固定弹窗。手动加速自然耗尽后回到 1 倍并请求该弹窗；其他业务弹窗或输入暂锁期间等待，导航、销毁、免费收尾、保存失败或余额恢复撤销过时提示。`SpeedBoostPresentation` 持有耗尽提示的会话归属，`ProgressPresentation` 负责命令、导航与只读投影。v64 的 `SpeedProgressPage` 约束 `layout: 'speed'`、时长与余额、唯一 `ad-speed` 操作和 `showBack: false`，不替代运行时验证。

`popups/speed/prefab/speed.prefab` 已经标准 Creator 创建、绑定、保存并读回，UUID `acab984e-fff8-4389-841d-b6dc52b3e19a`。v66 初版有 12 个固定节点；v82 当前有 17 个固定节点、113 个序列化对象，7 项 Label 和 2 项按钮 Node 引用保持并已核对，根及遮罩 Widget 为 750×1334，根阻挡输入；专用 View 已接入 MK 注册、路由、清理与货币识别。未以脚本直接修改序列化资产。

货币浮层挂在 Canvas，以保存的 Widget 与当前安全区放在屏幕顶部。玩法、首页、建设与加载页没有业务弹窗时隐藏；有本产品业务弹窗时显示，Toast 单独存在和 GM 不计业务弹窗。2026-10-11 的隔离 Preview 历史覆盖 31 个弹窗导航入口及成功／失败结算、页面与 Toast/GM 边界；稳定状态栏上缘为 1334，顶部安全区偏移为 0。收集对象详情通过实际“详情”按钮进入；非法直接进入且缺对象 ID 的探测回执保留为失败，没有核销成通过。这里只验证 Ant 的货币浮层和设计分辨率。

设置昵称和占位文本通过 Creator 居中，ID 明确显示 `ID：` 前缀。Cocos 3.8.8 EditBox 会重算子 Label 的坐标与宽度，因此最终资源仅保留两项水平对齐变化；相对冻结 Owner 文件仅两个字节改变，精准暂存也仅包含对应两个 Label，没有混入 Owner 布局。资料仍在编辑结束、回车、头像切换及关闭时按既有合同保存。真实触摸验证昵称与头像保存、关闭重开、ID／注册时间不变；实际排行自我行及伙伴“我的资料”的截图显示新昵称与头像颜色。通用 UI 探针会先选中 Community 父容器，此处不能以其空子视图结果代替截图。修复 MK 父子异步销毁期间 Cocos 清空字段后的重复监听清理异常，正常清理和重开绑定保持。

| 2026-10-11 历史范围 | 当时证据 | 限制 |
| --- | --- | --- |
| 专用 Speed 与自然耗尽 | 实际源码路由 19/19；标准 Preview 观察到耗尽后 1 倍、唯一专用弹窗；关闭和完整完成、取消、不可用广告端口样例已执行 | 广告是隔离端口模拟，未接真实 SDK；奖励保存故障重试的本轮 UI 触摸未补验 |
| 设置及货币栏 | 设置源码 11/11、币栏 7/7、Popup 生命周期 18/18，strict 通过；最终设置触摸 35 步、各页面坐标及截图诊断均为零 | 引擎替身源码测试与真实 Preview 观察分别记录；未扩大到其他分辨率或真机 |
| 服务端验收 | verificationId `8f832cfc-9998-4245-8826-0a79a7d166e9`；Creator 3.8.8、标准 session `759906ad-7423-42c3-acaf-75f0fe481a25` | 服务端产物关联为 **UNCONFIRMED**：无编译完成事件或页面可回传的产物标识。工具 PASSED 和刷新时间不能提升此状态 |
| 截图交付 | 四张真实 750×1334 PNG 已保存到 Library：Speed 耗尽、设置、排行、伙伴 | 原批量助手在任何上传会话建立前明确失败；主线程再次授权交付后，直接批量接口确认四项 succeeded，没有重复创建已有会话 |

Library 实际文件标识（均 version 0；采集版本为 v65 加授权工作区实现）：

| 图像 | library_file_id |
| --- | --- |
| Speed 自然耗尽 | `libfile_df39ef38006c81919f94a5e3edb058cf` |
| 设置保存后重开 | `libfile_51a23d67e5ac8191a7f47c2cb299326a` |
| 排行自我资料同步 | `libfile_9e98ea8ac2dc81919f117fbfb8b6377f` |
| 伙伴我的资料同步 | `libfile_f76a4819b06c8191b9653a69ccd67cad` |

本轮源码与资产完成 OCR Delegation 规则下的实际宿主审查及普通独立复审，未发现确定 P1/P2；不声称注册角色硬隔离或 Oracle 通过。主线程授权后的标准恢复已把旧 `4060-owner-ui-v125-20261009-9065bc84-speed-authoring-create` 追加为 `ABANDONED / AUTHORIZED_TERMINATED_DISPATCH_ABANDONMENT`，原 STARTED／UNKNOWN 的 outcome、effect 与 dispatch 历史保持，旧场景未重放或覆盖。Creator 实际由 Dashboard 启动，PID 26696、instance `810d6805-4e31-4ff7-a44c-d7628772fa8e`；CLI 使用已核实 Node v22.23.3，磁盘软件声明版本不作为已加载版本。

回执目录：`C:/Users/33272/AppData/Local/Temp/4060-speed-live-20261011`。真实图片位于本项目 `temp/creator-ai-bridge/screenshots`。当前 Owner／并行文件继续保留；新专用 Prefab 的临时制作场景也保留且未纳入本地提交。真实存档未改，不推送、打 tag 或更新父仓 pin。

### 原 13 项、商城与第 7 关后续

R01–R07、R11–R13 已有源码实现及历史记录，本阶段不重复核销为最新Runtime通过；R08/R09以上述v85设置及货币证据为准。R10当前商城46/46通过：实际点击铲子40金币、指南针60金币各自触发一次私有保存失败，余额／库存／交易记录不变；重试各保存一次，已购买按钮重复触摸不重复扣款，原两条交易凭据在私有Map重建后保持，最终20金币、库存各1，实际关闭解锁。这不是玩家磁盘存档故障测试。第7关当前54/54通过：实际选堆与运输产生模型FAIL（83格运输），实际“免费重试”回到同关PLAYING／0运输，背景Frame／Texture有效且750×1667覆盖设计屏幕，退出观察到worker为0；未证明全部池、timer或GC归零。旧runTrace(failure)探测实际仍PLAYING，保留原回执；离线FAIL轨迹148格与本阶段Runtime83格分别记录，未称等条件性能对照。真机卡顿、发热、GC／分配调用栈仍缺，本阶段1秒Profiler短采样不能作为性能通过。

2026-10-11（测试检查点 v72 `cd73cac0b4feae28f05c948ad2bf300d522ce842`；文档单独提交）连续关卡生命周期回归：新增 `tests/provider/ant-play-session-lifecycle.test.mjs` 六项，实际执行 PlayState 的退出／运输回调／读取方法、TransportPresentation、NodeFactory 和 MK 同步池；cc 节点、tween 与页面 IO 使用替身。移动、清格和淡出三个等待阶段分别覆盖主线 1→7，在同一个状态实例上挂起新局 worker 后释放旧任务及已排队回调，验证新旧模型与新 UI 不被旧任务改写，新任务不被旧 finally 删除；旧池、worker、等待和 tween 归零，再退出新局完成清理。实际主线目录按既有配置顺序在同一模型连续通过 1→7，另用数量正确的仓外内存棋盘产生合法 FAIL 并验证重置；这些不是玩家原生连续游玩或真实第 7 关失败。

背景的既有修复保持：只读当前 `board.prefab` 确认 BackgroundArt 没有启用的竞争 Widget，实际 BoardView 在三次新建视图中恢复同一首关背景帧及屏幕中心；视口替身固定 750×1334，不表示截图／像素覆盖或缓存资源的原生重玩验收。相关 23 项唯一回归中首轮 21／23，两个旧清理夹具漏注入已注册的 ColonySpeedView；补齐依赖、核对十项注销及已成功 Owner 不重复清理后，仅受影响五项复验 5／5。新增测试首轮的读取方法夹具遗漏及四关贪心策略失败也保留回执，分别修正依赖及沿用既有配置顺序，未据此修改业务规则。Node 22.23.3、Creator 源码 strict 通过；标准 Creator info 再确认工程 `04c4cde24ee76d83`、3.8.8 和原会话。32 份 Owner 文件和 6 份生产数据保持；不改资源、真实存档、Companion 或服务。本阶段未证明真机卡顿根因、GC／分配、发热、Cocos 延迟销毁或全体计时器归零。证据目录：`C:/Users/33272/AppData/Local/Temp/4060-level-lifecycle-20261011-0843`。

2026-10-11 后续标准 Creator 隔离 Preview（运行版本 v0.3.0.73，750×1334）取得原生报告：通过公开solveCurrent／nextLevel测试接口连续主线1→7及第7关重玩共39／39步成功；另首次执行真实第7关合法八次选堆，43／43步记录 FAIL、运输84格，随后公开测试接口重玩及回首页再进均为 PLAYING、运输0、五槽空。背景在失败、重玩和再进入时保持同一有效帧、中心(375,667)及750×1667尺寸，截图已核对；池节点678→586→678，再进入678，HOME未返回池计数字段，不能当作池清零。采样状态活动／移动worker为0；不代表全体引擎资源或计时器释放。43步夹具保留引导遮罩，重玩使用公开测试接口，尚未验证免费重试按钮触摸；39步SUCCESS状态观测boostMultiplier为3、重玩为1，不声称全程固定1×。两份报告四类原始诊断均为空。第7关重玩／再进入后的15秒采样均P95 18.1ms，属于空闲状态而非活动运输全程或真机性能证明；43步另有关于9个Mask的1条告警，不能据此确定卡顿根因。

运行报告成功与协调结果分别保留：39步客户端及operation记录仍为 FAILED／DAEMON_UNAVAILABLE，本地原生报告后续完成；43步返回 UNKNOWN_OUTCOME／HTTP_500（Request body is too large），operation记录仍STARTED。未重放、删字段或手工标记成功。当前同一daemon PID34328的inflight全为0、unknown为空；新fencing13租约已过期，正常release返回LEASE_EXPIRED，不声称释放成功。恢复证据：`C:/Users/33272/AppData/Local/Temp/4060-level-native-recovery-20261011`；原生报告分别为项目`temp/creator-ai-bridge/playtests/playtest-1791710995826.json`和`playtest-1791711731942.json`。仅v73首关启动截图已保存Library：`libfile_531d7bf9e1d88191b46c203835719526`，不代表全关卡或性能验收。32份Owner、6份生产数据和9份框架Meta哈希保持；源码／资源、真实存档及Companion／服务未改。

Cook 固定 UI 共11页：设置、恢复、Map与Level已完成本地切片验证（4/11），其余7页排队；正式Creator产物关联仍UNCONFIRMED，真机性能、广告／支付 SDK、AppID 与远程服务配置仍待后续。

2026-10-13 Cook 设置页固定 UI 第一切片：Creator 3.8.8 标准工程 `04c4cde24ee76d83` 保存操作 `22dcee75-1cac-45a0-9794-76412c3fb6de` 后关闭并复开读回 `SettingsFlowGroup.prefab`（revision `rev-6d3ff1db`）；65个固定节点、根节点16项类型化绑定、原 solid 与 `recovery.jpg` SpriteFrame 静态引用保持，无新增美术。同步父 View 与固定根的视口尺寸，避免长屏 Widget 将遮罩／渐隐重对齐至1334高；补丁后按新源码 SHA 重采三尺寸，前候选116步另存且不累计。设置／恢复页复用同类 View 清理、既有集中触摸目标与业务命令，并保留 save-pending 和 Shell 输入门。Node 22 strict 通过，新增6项真实 View／Presentation 替身覆盖与 Cook host 6项、save 6项共18/18通过、无 skip；源码／资产／测试 OCR 宿主审阅及注册 reviewer 均无确定 P1/P2。基于 v0.3.0.90 HEAD `db4f076` 加本轮限定变更和受保护 Owner 工作树，750×1334、390×844、360×800 三组 fresh isolated 原生运行分别76/76、20/20、20/20，共116步通过，四类原始运行诊断均为空，26张 PNG 已冻结。保留各组 `PERF_BUDGET` 提示（P95 16.9ms），不代表性能通过；真实保存故障仅有离线验证，正式 Creator 产物关联仍 `UNCONFIRMED`，三变体新 Build／Smoke 仍排队。既有账号默认游客及未接真实 SDK／后台边界不变。框架32份 Meta 与 P0002 pin `39f168e7abdac9215d0ea21f2a5a3585262e9970` 保持；本轮70个排除本轮代码、文档和版本镜像的基线文件未变。证据见 `C:/Users/33272/.codex/visualizations/2026/10/13/01a133f1-2bf5-7e53-b874-df47dc8e19f0/p4060-cook-settings/` 下 `creator-readback-verification.json`、`native-verification-final.json` 与 `screenshots-final/`。

2026-10-14 Cook 恢复页固定 UI 第二切片：Creator 3.8.8 Preview（7456）在 v0.3.0.92 HEAD `43835b0` 加本轮五个限定功能文件及受保护 Owner 工作树上验收，非后续 v0.3.0.93／文档 v0.3.0.94 的干净构建。标准 Creator 新会话保存并读回后，恢复页增加42个固定节点及11项类型化绑定；设置页原65节点／16绑定完整保留，合计107节点／27绑定，0个 cc.Button 二次路由。恢复继续沿用既有 resume／reset／navigation 事件及 Host／Application／Core 存档链；存档失败仅离线覆盖，本轮原生未注入失败。Node22 strict 与22项定向测试通过，无失败或跳过。三尺寸 fresh isolated 原生回执：750×1334 57/57、390×844 33/33、360×800 33/33，共123步；有效检查点恢复及三次重载由57步主运行覆盖，手机两组覆盖无检查点返回／重置／默认设置／重开，采集PNG尺寸不等于重载后Canvas有效像素尺寸。四类原始诊断均为空，29张 PNG 冻结。每组保留 PERF_BUDGET（P95依次16.8／16.8／16.9ms），不代表性能通过；正式 Creator 产物关联仍为 UNCONFIRMED，三变体新 Build／Smoke 累计排队，真实 SDK／后台未验。Cook固定UI共11页，设置与恢复两页完成（2/11），其余9页排队；默认游客账号边界保持。框架32份 Meta、P0002 pin `39f168e7abdac9215d0ea21f2a5a3585262e9970` 保持；原生采集前73个受保护基线文件未变，文档和版本镜像更新后最终核对70个排除本轮改动的文件。若后续核对需恢复资产状态，以 Creator readback revision 与本回执作核对基线，保留设置页原节点和绑定；证据见 `C:/Users/33272/.codex/visualizations/2026/10/13/01a133f1-2bf5-7e53-b874-df47dc8e19f0/p4060-cook-recovery/` 下三份回执及 `screenshots/`。

## 棋盘编辑器

Node 22 下，在本工程运行 `pnpm run editor:board`，打开 <http://127.0.0.1:7469>；无需 Creator，终端 Ctrl+C 停止。编辑器使用共享规则编辑棋盘与数字组；整份初始草稿可撤销，编译和确认导入只使用仓外隔离副本。

“保存到工程”现固定输出运行JSON，Creator自动导入完成后刷新游戏读取，使用与验收边界见[JSON保存与刷新说明](LEVEL_JSON.md)。草稿导出 JSON 保存到浏览器下载位置，不自动写入主题关卡。`pnpm run editor:levels preview ...` 可合并显式关卡规则，生成CSV/运行TS候选、差异与真实模型搬运见证；`apply`只写标记隔离副本。端口处理、Node22命令、完整样例和验收边界见 [棋盘编辑器使用说明](BOARD_EDITOR.md)。

2026-10-11 独立验收补齐（测试检查点 v70 `640e5c41114e270b468394b689bd924b3aa0102b`，文档单独提交）：新增 `tests/editor/group-export-chain.test.ts`，将两个一起出发分组、A/B/C/L 固定颜色与数量、整份草稿 JSON 保存重开、规则转换、候选编译和确认导入串成一条链路。3／4／5 列分别读取隔离副本实际生成的运行 TS，以真实 `ColonyFlowModel` 验证两次原子入槽、五个格子的完成回执及最终 `SUCCESS`；数量不符、错误确认和重复导入均被拒绝。五列是旧解析器默认值，测试按有效默认值断言，没有因此修改业务源码。Node 22.23.3 下编辑器完整测试 62／62 通过，两类 strict 类型检查通过，CSV 只读检查为 5 主题／60 关／40 收集物。

当前已存在的 7471 服务 PID 21192 经只读核对，13 个页面／模块资源与本轮源码及私有编译结果逐字节一致；同一服务的隔离 HTTP 链路 3／3 通过。版本基线为 v69 `787ca7d1e07dfeaf3b9264a1cf17fb55d3b85643`，不沿用旧服务版本回执。新增测试和文档不改变服务源码，也未重启服务。32 份既有 Owner 文件与 6 份生产配置／生成数据 SHA256 保持一致；未触碰 Owner 草稿、真实关卡或玩家存档。标准 Creator 只读 info 确认目标工程与既有 session，不表示编辑器画面验收；浏览器工具仍因缺 Windows 平台目录无法启动，750×1334 实际点击、连线显示及截图继续未验收。证据目录：`C:/Users/33272/AppData/Local/Temp/4060-editor-group-chain-20261011-0803`。

## Cook 复刻参考证据

- [旧截图观察与当前实现核对（2026-10-23）](docs/reference/cook-20230117-observations.md)：记录盘数目标、独立容量档位及证据边界；不将未知关号、等级或版本写成正式配置。

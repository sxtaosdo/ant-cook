# 4060（Ant Cook）联合产品

**当前版本：`v0.3.0.71`**

状态: Draft

项目代号为 4060；物理目录仍为 `ant-cook`，存档 namespace 和两个玩法名称保持现有合同。

本目录是两玩法联合工程的未交付实现。Creator 3.8.8；Owner 已确认初始版本基线 0.3.0.0，正常版本 Hook 为本地检查点递增第四段；尚未配置独立远端或发布。

共享入口代码位于 `assets/shell/`。Ant 继续使用 `Colony / ColonyGame`，Cook 继续使用 `game / Game`，各自持有玩法状态和经济。新数据分别写入 `p4000.ant-cook.dev1.ant.*`、`cook.*` 和 `shell.*`，不读取、改写或清除两个旧工程的真实存档。

P0002 以 `extensions/shidai3` Git submodule 消费。本轮按授权通过正常本地 Git fetch／checkout 消费 `e3165d370e1dee35367703df87849bae6dd7887c`（2.6.0），源码／测试及产品 gitlink 已精确提交为 `v0.3.0.68 / bfd76781f2fdda71d00d884edc85fac9b76141d1`，文档单独形成检查点。ProductBootstrap 实际导入公共 `LoginFacade` 与 observability，Shell 独占一个默认关闭的 facade；启动仅创建并读取游客状态，不调用登录或等待认证。设置只收到状态／反馈／操作可用性的窄投影，玩家显式点击才请求登录，pending 可取消，active 可退出；缺配置显示“登录暂不可用，离线玩法可继续”。账号刷新与动作使用独立通道，不占资料保存 busy、不调用进度快照、不覆盖昵称／头像草稿或资料反馈；关闭设置释放视图订阅，Shell 销毁 dispose，旧 entry 和 generation 不允许派发命令或回填。账号不绑定本地资料、不迁移账户，也不改任何存档命名空间。遥测默认关闭和缺来源／构建元数据拒绝记录的规则保持。

2026-10-11 账号绑定兼容验证：旧 Settings Prefab 缺少 `accountStatusLabel`／`accountActionButton`／`accountActionLabel` 时，原设置仍可保存昵称、切换头像和关闭；空闲资料反馈区显示“登录界面暂不可用，离线玩法可继续”，每个视图生命周期仅记录一次 `SETTINGS_ACCOUNT_UI_UNAVAILABLE`，不派发账号动作、不误报登录可用。部分绑定同样禁用；资料反馈优先于不可用提示。实际读取 v67 `c9818cd67ab1f1845e84893e7d00982be1db0258` 的 270 对象 Prefab 与当前 Owner 的 256 对象 Prefab，分别结合新源码执行隔离 VM 测试：cc／资源生命周期为替身，不是原生运行验收。Node 22.23.3 strict 通过；最终账号 9 项、资料自动保存 11 项、实际 Bootstrap 2 项共 22 项唯一消费者覆盖及 36 项货币／弹窗／加速／商城回归通过。干净检出不含新账号行时，该 Owner 资产专属测试明确 skip，其余兼容覆盖照常执行。已从该源码提交和精确框架 pin 分别 Git archive 导出，逐字节核对产品 1275 文件和框架 185 文件：旧 270 对象 Prefab、无账号三绑定；strict 通过，定向 22 项中 21 通过／1 项 Owner 行专属 skip。验证依赖为现有 Node 22、三包只读副本、Creator 声明及固定旧提交的只读 Git 历史；首次 junction 被本机权限拒绝后保留失败回执，没有改权限。此结果证明干净源码不依赖未提交账号行，不表示原生 Creator 验收。

已有标准 Creator 3.8.8 证据：Settings 新增 3 个固定节点／3 个序列化绑定并保存、关闭、复开读回，Settings 与 Bootstrap 编译通过；750×1334 全新隔离 browser/context 配合既有 GM 内存夹具完成 20 步，未配置账号行、按钮点击、关闭复开及顶部货币显隐可观察，四类诊断均 0。此证据对应 v67 加兼容补丁前的已授权工作树，当前完整账号行路径保持；新增旧资产降级路径由上述源码／图夹具验证，未另做原生运行。工具步骤 PASSED，服务端产物关联仍为 UNCONFIRMED；这不是平台 SDK／真实后端或性能通过。短采样另有 PERF_BUDGET 提示，不能作为第 7 关性能结论。原图位于 `temp/creator-ai-bridge/screenshots/4060-account-disabled-settings-750x1334-1791702078193.png` 与同目录 `4060-account-disabled-settings-reopened-750x1334-1791702079819.png`，画面版本为 v67 加当时工作树；本轮 Library helper 在 prepare 阶段不可用，尚未取得这两张图片的附件 ID。

Settings 账号行资产仍未纳入提交。HEAD 的 270 对象、Owner 原基线的 236 对象和 Creator 保存后的 256 对象不能直接混用引用索引；只读图检查确认仅 SettingsRoot 追加子节点和 SettingsView 新增三引用，其余 Owner 属性保留，所有引用有效。本轮通过可选绑定解耦源码，既不脚本重排 Prefab，也不整份暂存 Owner 改动。干净检出保留旧设置与稳定不可用提示，不能称已包含新账号行。`C:/Users/33272/AppData/Local/Temp/4060-auth-consumption-20261011/settings-owner-recovery/` 保存逐字节前后备份、`owner-236-to-256.patch` 与 SHA256 manifest；该补丁只比较精确 Owner 236 对象基线与 256 对象结果，不适用于 HEAD 270 对象。后续恢复须核对基线哈希并沿标准 Creator 入口处理。现有 9 份 framework meta 字节未改，未手写新 meta；无 push、tag 或根父 pin 变更。

唯一 MK 能力提供者来自 v1.1.5；本副本局部修正场景取消、main 初始化等待、UI 注册身份、注销与失败清理、池迟到资源释放及 strict 类型，不能称为未修改的原版 MK。没有引入第二套 UI、资源、音频或池运行时。

验证使用 Node 22：`npm run typecheck` 与 `npm test`。执行集合为 `tests/unit` 与 `tests/provider`；后者运行实际 MKUIManage、MKBundle、MKObjectPool、MKStatusTask 源码，但 cc、IO、Release/View/Event 辅助能力使用替身，不是 Cocos Runtime 验收。`tests/ant` 和 `tests/cook` 是迁移时保留的来源测试材料，其中旧迁移断言不属于新产品兼容合同。Provider 的严格类型差异检查见 `P8000/dual-game-build/provider-typecheck.mjs`；仅证明相对字节核实的来源 baseline 无新增诊断，不表示 Provider 零诊断。

`P8000/dual-game-build/build-input.mjs` 在任务 Temp 目录创建独立 Creator 输入，支持 `ant`、`cook`、`both`，物理排除未选玩法。`SHARED_ASSETS.json` 记录通用遮罩纹理的构建期共享归属，纹理和 meta 保留原字节及 UUID；原目录不移动。工具拒绝没有 Creator 保存的 `assets/shell/Bootstrap.scene` 的正式输入。

Bootstrap.scene 已由 Creator 3.8.8 创建、绑定 ProductBootstrap、保存并回读；Bridge 0.3.118 已获批安装登记。Preview 已验证两个来源入口、双向往返、退出保存故障重试及持续就绪。蚂蚁界面调整通过 Creator 保存。正式构建使用工具生成的隔离输入，排除 P0002 的开发示例入口；运行、多尺寸和产物验收以对应源码 SHA 的本次任务回执为准，业务替身测试不能代替它们。广告单元、AppID和远程服务尚未配置。

跨玩法推荐由业务模块提供可选的纯只读 `promotionReady()` 资格：Ant连续主线首通18关、永久引导完成或跳过且处于无弹窗安全首页；Cook首餐厅完成且成功保存、处于安全地图。Shell仅在双玩法构建、入口与恢复均就绪时展示现有原生选择面板，玩家主动选择才执行安全切换，不发放奖励。拒绝先保存到shell独立元数据，成功后同一来源方向7天内不提示；保存失败保留重试，同一会话每方向最多主动展示一次。两方向冷却独立，不保存永久停止标记；单玩法构建不展示推荐。

来源快照见 `MIGRATION_SOURCES.json`；功能状态见 `CHANGELOG.md`。

## 加速弹窗、货币栏与设置的当前状态

截至 2026-10-11，本轮实现已形成未发布本地源码检查点 v66 `f10e69c`。下述 Preview 截图采集时显示 v0.3.0.65，另含本轮已授权实现及保留的 Owner 工作区改动；它们不是 v66 干净检出或正式构建的验收。

玩家点击既有加速入口打开专用固定弹窗。手动加速自然耗尽后回到 1 倍并请求该弹窗；其他业务弹窗或输入暂锁期间等待，导航、销毁、免费收尾、保存失败或余额恢复撤销过时提示。`SpeedBoostPresentation` 持有耗尽提示的会话归属，`ProgressPresentation` 负责命令、导航与只读投影。v64 的 `SpeedProgressPage` 约束 `layout: 'speed'`、时长与余额、唯一 `ad-speed` 操作和 `showBack: false`，不替代运行时验证。

`popups/speed/prefab/speed.prefab` 已经标准 Creator 创建、绑定、保存并读回，UUID `acab984e-fff8-4389-841d-b6dc52b3e19a`。12 个固定节点、7 项 Label 和 2 项按钮 Node 引用已核对，根及遮罩 Widget 为 750×1334，根阻挡输入；专用 View 已接入 MK 注册、路由、清理与货币识别。未以脚本直接修改序列化资产。

货币浮层挂在 Canvas，以保存的 Widget 与当前安全区放在屏幕顶部。玩法、首页、建设与加载页没有业务弹窗时隐藏；有本产品业务弹窗时显示，Toast 单独存在和 GM 不计业务弹窗。本轮隔离 Preview 覆盖 31 个弹窗导航入口及成功／失败结算、页面与 Toast/GM 边界；稳定状态栏上缘为 1334，顶部安全区偏移为 0。收集对象详情通过实际“详情”按钮进入；非法直接进入且缺对象 ID 的探测回执保留为失败，没有核销成通过。这里只验证 Ant 的货币浮层和设计分辨率。

设置昵称和占位文本通过 Creator 居中，ID 明确显示 `ID：` 前缀。Cocos 3.8.8 EditBox 会重算子 Label 的坐标与宽度，因此最终资源仅保留两项水平对齐变化；相对冻结 Owner 文件仅两个字节改变，精准暂存也仅包含对应两个 Label，没有混入 Owner 布局。资料仍在编辑结束、回车、头像切换及关闭时按既有合同保存。真实触摸验证昵称与头像保存、关闭重开、ID／注册时间不变；实际排行自我行及伙伴“我的资料”的截图显示新昵称与头像颜色。通用 UI 探针会先选中 Community 父容器，此处不能以其空子视图结果代替截图。修复 MK 父子异步销毁期间 Cocos 清空字段后的重复监听清理异常，正常清理和重开绑定保持。

| 范围 | 当前证据 | 限制 |
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

R01–R07、R11–R13 已有源码实现及历史记录，本轮不重复核销为最新 Runtime 通过；R08/R09 使用上述最新设置与货币证据。R10 商城永久库存和余额／幂等凭据原子保存已经实现，铲子 40 金币、指南针 60 金币；购买、重载及故障重试有历史记录，本轮只补验商城浮层位置，没有重新验证交易。第 7 关既有优化和历史 P95 16.9ms 仅作线索，仍缺当前真机卡顿、发热、GC／分配调用栈及退出后池／计时器计数证明。本轮 1 秒隔离 Profiler 的短采样与告警不能作为第 7 关性能通过。

Cook 11 页固定 UI 迁移、当前真机性能，以及广告／支付 SDK、AppID 与远程服务配置仍为后续；本轮没有扩展到这些任务。

## 棋盘编辑器

Node 22 下，在本工程运行 `pnpm run editor:board`，打开 <http://127.0.0.1:7469>；无需 Creator，终端 Ctrl+C 停止。编辑器使用共享规则编辑棋盘与数字组；整份初始草稿可撤销，编译和确认导入只使用仓外隔离副本。

导出 JSON 保存到浏览器下载位置，不自动写入主题关卡。`pnpm run editor:levels preview ...` 可合并显式关卡规则，生成CSV/运行TS候选、差异与真实模型搬运见证；`apply`只写标记隔离副本。端口处理、Node22命令、完整样例和验收边界见 [棋盘编辑器使用说明](BOARD_EDITOR.md)。

2026-10-11 独立验收补齐（测试检查点 v70 `640e5c41114e270b468394b689bd924b3aa0102b`，文档单独提交）：新增 `tests/editor/group-export-chain.test.ts`，将两个一起出发分组、A/B/C/L 固定颜色与数量、整份草稿 JSON 保存重开、规则转换、候选编译和确认导入串成一条链路。3／4／5 列分别读取隔离副本实际生成的运行 TS，以真实 `ColonyFlowModel` 验证两次原子入槽、五个格子的完成回执及最终 `SUCCESS`；数量不符、错误确认和重复导入均被拒绝。五列是旧解析器默认值，测试按有效默认值断言，没有因此修改业务源码。Node 22.23.3 下编辑器完整测试 62／62 通过，两类 strict 类型检查通过，CSV 只读检查为 5 主题／60 关／40 收集物。

当前已存在的 7471 服务 PID 21192 经只读核对，13 个页面／模块资源与本轮源码及私有编译结果逐字节一致；同一服务的隔离 HTTP 链路 3／3 通过。版本基线为 v69 `787ca7d1e07dfeaf3b9264a1cf17fb55d3b85643`，不沿用旧服务版本回执。新增测试和文档不改变服务源码，也未重启服务。32 份既有 Owner 文件与 6 份生产配置／生成数据 SHA256 保持一致；未触碰 Owner 草稿、真实关卡或玩家存档。标准 Creator 只读 info 确认目标工程与既有 session，不表示编辑器画面验收；浏览器工具仍因缺 Windows 平台目录无法启动，750×1334 实际点击、连线显示及截图继续未验收。证据目录：`C:/Users/33272/AppData/Local/Temp/4060-editor-group-chain-20261011-0803`。

# 4060（Ant Cook）联合产品

**当前版本：`v0.3.0.66`**

状态: Draft

项目代号为 4060；物理目录仍为 `ant-cook`，存档 namespace 和两个玩法名称保持现有合同。

本目录是两玩法联合工程的未交付实现。Creator 3.8.8；Owner 已确认初始版本基线 0.3.0.0，正常版本 Hook 为本地检查点递增第四段；尚未配置独立远端或发布。

共享入口代码位于 `assets/shell/`。Ant 继续使用 `Colony / ColonyGame`，Cook 继续使用 `game / Game`，各自持有玩法状态和经济。新数据分别写入 `p4000.ant-cook.dev1.ant.*`、`cook.*` 和 `shell.*`，不读取、改写或清除两个旧工程的真实存档。

P0002 以 `extensions/shidai3` Git submodule 消费，固定 `895f28728ef2624e56faa3520d11b02310b20f18`（2.2.0）。ProductBootstrap 实际导入共享 auth／observability；本产品遥测三 TS 只作兼容重导出，与 P1060 使用同一份实现。默认 AuthSession 无凭证／交换 ports，guest／unavailable 不阻塞本地玩法；组件销毁时退出自身会话。遥测仍默认关闭，空来源／构建元数据拒绝记录，已有本地记录开关和 Shell 事实接线保留。新接线的实际源码 Headless 验证已完成；本轮未操作 Creator／Preview／Build／Runtime、平台 SDK、真实后端、云存档或外部接收。

唯一 MK 能力提供者来自 v1.1.5；本副本局部修正场景取消、main 初始化等待、UI 注册身份、注销与失败清理、池迟到资源释放及 strict 类型，不能称为未修改的原版 MK。没有引入第二套 UI、资源、音频或池运行时。

验证使用 Node 22：`npm run typecheck` 与 `npm test`。执行集合为 `tests/unit` 与 `tests/provider`；后者运行实际 MKUIManage、MKBundle、MKObjectPool、MKStatusTask 源码，但 cc、IO、Release/View/Event 辅助能力使用替身，不是 Cocos Runtime 验收。`tests/ant` 和 `tests/cook` 是迁移时保留的来源测试材料，其中旧迁移断言不属于新产品兼容合同。Provider 的严格类型差异检查见 `P8000/dual-game-build/provider-typecheck.mjs`；仅证明相对字节核实的来源 baseline 无新增诊断，不表示 Provider 零诊断。

`P8000/dual-game-build/build-input.mjs` 在任务 Temp 目录创建独立 Creator 输入，支持 `ant`、`cook`、`both`，物理排除未选玩法。`SHARED_ASSETS.json` 记录通用遮罩纹理的构建期共享归属，纹理和 meta 保留原字节及 UUID；原目录不移动。工具拒绝没有 Creator 保存的 `assets/shell/Bootstrap.scene` 的正式输入。

Bootstrap.scene 已由 Creator 3.8.8 创建、绑定 ProductBootstrap、保存并回读；Bridge 0.3.118 已获批安装登记。Preview 已验证两个来源入口、双向往返、退出保存故障重试及持续就绪。蚂蚁界面调整通过 Creator 保存。正式构建使用工具生成的隔离输入，排除 P0002 的开发示例入口；运行、多尺寸和产物验收以对应源码 SHA 的本次任务回执为准，业务替身测试不能代替它们。广告单元、AppID和远程服务尚未配置。

跨玩法推荐由业务模块提供可选的纯只读 `promotionReady()` 资格：Ant连续主线首通18关、永久引导完成或跳过且处于无弹窗安全首页；Cook首餐厅完成且成功保存、处于安全地图。Shell仅在双玩法构建、入口与恢复均就绪时展示现有原生选择面板，玩家主动选择才执行安全切换，不发放奖励。拒绝先保存到shell独立元数据，成功后同一来源方向7天内不提示；保存失败保留重试，同一会话每方向最多主动展示一次。两方向冷却独立，不保存永久停止标记；单玩法构建不展示推荐。

来源快照见 `MIGRATION_SOURCES.json`；功能状态见 `CHANGELOG.md`。

## 加速弹窗：契约、用法与验证状态

本节记录截至 2026-10-11 04:01 UTC 的实际状态。源码检查点不等于部署或 Cocos 实测；历史 Preview 回执不能代表新的加速弹窗。

玩家点击既有加速入口打开加速弹窗。v63 源码增加手动加速自然耗尽后的提示：回到 1 倍并请求既有弹窗；其他业务弹窗或输入暂锁期间等待，导航、销毁、免费收尾、保存失败或余额恢复后撤销过时提示。关闭、离页和迟到回调不得刷新新的页面或重复打开弹窗。视频操作的可用、播放中、待保存重试、其他奖励待保存和时钟回退状态仍来自现有奖励合同；广告 SDK 尚未接入，源码测试不表示真实视频到账已经验证。

表现层的 `SpeedBoostPresentation` 负责耗尽提示的会话归属，`ProgressPresentation` 负责导航、命令与只读投影，MK View 只展示投影。v64 的 `SpeedProgressPage` 强制 `layout: 'speed'`、`speed.durationText`／`remainingText`、恰好一个 action 为 `ad-speed` 的行及 `showBack: false`；实际页面投影用 `satisfies` 检查。它是编译时契约，不是运行时 schema，也不验证字符串格式或 Prefab 引用。该页保留关闭入口，不增加通用返回行。

当前实际路由仍使用既有通用弹窗。专用 speed View 候选尚未接入；固定 Prefab 的结构、七项 Label 和两项 Node 引用必须由标准 Creator 入口制作、绑定、保存及读回，不能以运行时创建固定 UI 或脚本直改 Prefab／scene／meta 代替。确认资源和绑定后才能切换专用路由。

| 项目 | 源码与本地检查点 | 部署／真实验证 |
| --- | --- | --- |
| 自然耗尽提示及异步归属 | v63 `63d803fa` 已实现；新增生命周期回归 21/21，默认源码回归 319/319、strict 编译通过 | 本次新行为尚未完成 Creator／Preview 实测 |
| 专用加速页面数据契约 | v64 `2367797b` 已实现；strict 编译、合法 1 项／非法 5 项契约样例通过，两份源码编译输出与 v63 完全一致 | 仅类型约束；未改变运行路由或部署。复用 v63 回归，不声称重新执行 |
| 固定 speed Prefab 与专用路由 | 待标准入口恢复后制作及接入 | 待 750×1334 隔离验收与真实截图；没有本轮 `library_file_id` |
| 货币栏贴屏幕顶部、设置资料／布局／保存关闭及排行伙伴同步 | 本轮未改 Owner 的相关 Prefab 或并行文件 | 仍需恢复入口后按 OwnerPrefab 权威核实，不以历史截图核销最新问题 |

两次源码切片均完成 OCR Delegation 规则下的实际宿主审查及普通独立复审，未发现确定 P1/P2；未把普通复审称为注册角色的硬隔离调用。真实存档未改，41 份保护文件及 v63 耗尽实现保持原字节。本项目仅保存独立本地 Git 检查点，不推送、打 tag 或修改父仓 pin。

### 标准入口恢复与后续验收

最新只读检查确认：旧 `4060-owner-ui-v125-20261009-9065bc84-speed-authoring-create` 仍为 `scene_create / STARTED`，dispatch 为 `UNKNOWN`、`recoverable: false`，原租约已过期；标准身份与 fresh 场景读取返回 `ECONNREFUSED 127.0.0.1:12029`。历史 Dashboard `COORDINATION_REQUIRED` 回执保留为历史，当前是否可推进以新的标准状态读取为准。

当前实际入口为 `P8000/cocos-mcp/mcp/dist/companion/creator-ai.js`，本项目源码检查使用已核实的 Node 22，路径为 `P8000/dual-game-build/node_modules/node/bin/node.exe`（均相对 shidai3 根目录）。只读检查命令为 `--json lease status --project 04c4cde24ee76d83`、`--json operation get --project 04c4cde24ee76d83 --operation-id <上述完整 operationId>`、`--json creator info --project 04c4cde24ee76d83` 与 `--json scene tree --project 04c4cde24ee76d83 --fresh true`。路径和运行状态应每次核实，不把磁盘声明版本当成已加载版本。

正常 `operation reconcile` 必须获得匹配原拥有者、租约、操作及输入摘要的真实 daemon 终态回执；当前没有这样的回执。公开 `ABANDON` 只支持没有 journaled dispatch 的特定旧 `prefab_open`；既有 `ADOPT_AUTHORIZED_4060` 只绑定已解决的旧设置页事件，均不能用于本次 `scene_create`。原进程不存在、场景文件存在或 daemon 当前无在途请求，都不能证明原操作成功／失败，也不能直接解锁。不得清除 UNKNOWN、复用旧授权或重放场景创建。

需要 Companion 提供限定到这一事件的标准受控恢复：服务器核对原 operation／dispatch 身份、排除迟到副作用及未保存编辑、保留当前资源，并保留原 outcome／effect 为 UNKNOWN 后追加具体授权的管理决策。当前业务 writer 只读核查，没有执行该恢复。恢复完成后按“新稳定 operationId 的租约 → Dashboard Creator 启动 → 实际项目／场景身份、fresh revision 与未保存状态 → 固定 Prefab 保存读回 → 专用路由 → 标准 Preview／playtest”继续；仅验设计分辨率 750×1334，使用隔离验证存档，再采集带实际源码／部署版本的真实截图。标准入口阻塞期间继续独立源码工作，不使用其他启动入口绕过协调。

## 棋盘编辑器

Node 22 下，在本工程运行 `pnpm run editor:board`，打开 <http://127.0.0.1:7469>；无需 Creator，终端 Ctrl+C 停止。编辑器使用共享规则编辑棋盘与数字组；整份初始草稿可撤销，编译和确认导入只使用仓外隔离副本。

导出 JSON 保存到浏览器下载位置，不自动写入主题关卡。`pnpm run editor:levels preview ...` 可合并显式关卡规则，生成CSV/运行TS候选、差异与真实模型搬运见证；`apply`只写标记隔离副本。端口处理、Node22命令、完整样例和验收边界见 [棋盘编辑器使用说明](BOARD_EDITOR.md)。

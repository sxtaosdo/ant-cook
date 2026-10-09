# 棋盘编辑器

状态：Accepted（开发期工具合同）

项目入口：[README → 棋盘编辑器](README.md#棋盘编辑器)。本文件集中维护编辑器的详细使用说明，README 只保留入口与快速启动。

这是 4060 的本地浏览器工具，用于制作棋盘图案；不进入 Cocos 游戏，也不改变现有第一关、底部方块和难度。Owner 已确认先选行列，再从空白绘制或用参考图片生成初稿，生成后继续逐格编辑。

## 启动与停止

使用 Node 22（>=22 <23）、pnpm 10（来源使用10.33.2）和本工程已有依赖，在 `D:/code/shidai3/P4000/ant-cook` 运行：

```bash
pnpm editor:board
```

若本机使用 pnpm 12，请使用明确的 `pnpm run editor:board`（该版本简写会触发安装流程）；验证使用 `pnpm run verify:editor`。

打开 <http://127.0.0.1:7468>。无需打开 Creator。首次安装依赖可运行 `pnpm install`；使用 Node 22 的终端运行以上命令。服务只监听本机；终端 Ctrl+C 停止。端口固定为 7468，没有自动换端口或 PORT 参数。若出现 EADDRINUSE，检查 `Get-NetTCPConnection -LocalPort 7468 -State Listen`，在旧编辑器终端按 Ctrl+C 停止后重启；不要结束不明进程。启动时编译编辑器 TypeScript，生成物在忽略的 `temp/board-editor/`。图片仅在浏览器内处理，不上传、不覆盖项目资源。

## 编辑流程

1. 行列分别支持1–64，默认32×32，提供20、32、48、64预设。点击“新建棋盘”应用尺寸；仅修改尺寸输入不会改变原棋盘。导入图片则使用输入的行列数。
2. 选择游戏现有12色，用鼠标点击或按住拖动填色；橡皮擦恢复空格。空格不参与搬运。中央棋盘支持缩放和滚动，右侧显示无网格图案及各颜色有效格数。
3. 导入不超过10MB的 PNG、JPG 或 WebP，先对照原图与填色预览，再点击“应用到棋盘”。取消或无效图片保留原棋盘。
4. 默认去除与图片边界连通的近白色背景，保留被图案包围的白色；可取消勾选保留白色背景。忽略透明部分，裁去外围空白，保持主体比例居中，行列均至少3时预留一格边距。每格按覆盖面积和透明度采样，再匹配最接近的游戏颜色；导入不是物体识别，复杂背景可能需要手动擦除。
   弹窗“颜色数量”默认自动，沿用现有转换；选择1–12时，初稿严格使用恰好对应种类的游戏颜色，空格不计入。切换后立即刷新预览并显示实际颜色种类数。多色图片保留占格最多的颜色并归并，少色图片按最小颜色误差补色，因此可能出现原图没有的颜色。有效格数不足时提示降低数量并禁用应用，原棋盘保持不变。同一页面保留上次选择，刷新后恢复自动；应用后仍可用全部12色手工修整。
5. 应用图片后可继续画、擦、清空。一次拖动是一条历史；新建、清空和图片填充也可整体撤销。保留最近50步，支持撤销/重做与 Ctrl/⌘ Z、Ctrl/⌘ Shift Z。当前页不自动存档，离开未导出的修改时提示；用导出配置保存工作。

调色板直接读取 `levelCatalog.ts` 的 `GAME_COLORS` 和 `colonyColors.ts` 的 `COLOR_HEX` 声明，不维护第二套游戏色表。颜色符号顺序沿用现行主题 CSV 的 A–L 顺序。调色板路径相对本工程 `scripts/board-editor/palette.mjs` 解析，因此只读取 ant-cook 的配置，不回读原工程。

## 配置输出

“导出配置”下载 `board-<行数>x<列数>.json` 到浏览器指定的下载目录（或弹出的保存位置），不会自动写入工程；“导入配置”读取同一格式恢复编辑。“复制棋盘CSV字段”输出 `rows,columns,boardCells` 三个字段及一行数据。空棋盘禁止导出；导入时校验格式版本、整数行列范围、矩阵尺寸和颜色符号，无效配置不改变棋盘。配置文件限制1MB。

```json
{
  "schema": "colony-board-v1",
  "rows": 3,
  "columns": 4,
  "boardCells": ".AB./.CJ./...."
}
```

`.` 为空格，`A–L` 为现有游戏色表顺序；`/` 分隔从上到下的行，每行从左到右排列。JSON 是棋盘中间配置，**不是可直接运行的完整关卡**，没有 `cellOrder`、底部数字组、难度或奖励。工具不自动修改主题CSV和生成目录；实际接入关卡流程见下节。

## 验证

在Node22下运行 `pnpm run verify:editor`，检查编辑器与关卡编译链类型、棋盘序列化、输入拒绝、画笔插值、撤销容量、裁边、颜色采样、CSV编译一致性、关卡规则和隔离导入。浏览器验收需实际完成新建、画/擦、撤销/重做、图片预览/取消/应用、应用后编辑、JSON下载/重导入、非法配置保留原棋盘及64×64滚动/缩放。

## 4060 主题关卡编译与隔离导入

浏览器仍导出棋盘图案。完整配置还需规则JSON和目标关号；命令行将这三项与当前主题元数据合并，生成候选CSV、运行TS、完整60关JSON、差异和搬运见证。目标限制为既有1–60关，只替换该行的 `rows,columns,boardCells,cellOrder,groups`，保留主题、稳定sourceId、奖励、收集身份、图标及背景层。运行入口仍为 `LoadingState → createOperationalCatalog → operationalThemeData.ts → ColonyFlowModel`。

规则文件如下，配套棋盘见 [合成样例](tests/editor/fixtures/synthetic-board.json)。`cellOrder` 用 `row.column|...` 完整覆盖有效格且无重复，顺序会保留；`groups` 用 `颜色字母:数量:列:深度|...`，每组数量2–50、列0–4、同列深度从0连续，各色总数必须匹配棋盘。`selectionOrder` 是明确的、从0开始的数字组点击顺序，须完整且无重复。

```json
{
  "schema": "colony-level-rules-v1",
  "cellOrder": "0.1|0.2|0.3|0.4|1.1|1.2|1.3|1.4",
  "groups": "A:2:0:0|B:2:1:0|C:2:2:0|J:2:3:0",
  "initialSlots": 5,
  "selectionOrder": [0, 1, 2, 3]
}
```

槽位由实际 `MAIN_SUPPLY_LEVELS` 决定：8、14、20关初始6槽，其他关5槽。`initialSlots` 可省略；提供时必须一致。编译器与编辑器共用实际12色表，不自动排序、生成数字组、重新设计难度或奖励。

本机已有Node22，无需安装。PowerShell在本工程执行以下命令；候选和隔离目录必须是工程外的新目录，请按任务更换名称：

```powershell
$node22 = 'D:/code/shidai3/P8000/dual-game-build/node_modules/node/bin/node.exe'
$levelWork = Join-Path $env:TEMP 'ant-level-example'
& $node22 --import tsx scripts/compileThemeCsv.mjs --check --assets
& $node22 --import tsx scripts/board-editor/compile-level.ts preview --board tests/editor/fixtures/synthetic-board.json --rules tests/editor/fixtures/synthetic-rules.json --level 7 --out "$levelWork/source-preview"
& $node22 --import tsx scripts/board-editor/compile-level.ts sandbox --out "$levelWork/sandbox"
& $node22 --import tsx scripts/board-editor/compile-level.ts preview --project "$levelWork/sandbox" --board tests/editor/fixtures/synthetic-board.json --rules tests/editor/fixtures/synthetic-rules.json --level 7 --out "$levelWork/import-preview"
```

先审阅 `import-preview/preview.diff`、`validation.json` 和 `plan.json`，然后使用该次preview输出的完整 `confirm` SHA256明确执行：

```powershell
& $node22 --import tsx scripts/board-editor/compile-level.ts apply --project "$levelWork/sandbox" --plan "$levelWork/import-preview/plan.json" --confirm '<本次已审阅plan的完整SHA256>'
```

`preview` 不写真实CSV/运行TS；编译器无参数和 `--check` 均只读。`apply` 只允许工具创建的工程外标记隔离副本，拒绝真实工程及其路径别名。它核对源数据、代码与候选指纹，重编译并回放后再次检查，才写入隔离副本的两个文件；第二次写入失败时尝试回滚。此操作应在隔离副本无其他writer时执行，不能替代操作系统事务。生产导入仍须在Owner明确释放的写入窗口按候选差异处理，本工具不开放生产写入开关。

见证使用实际 `ColonyFlowModel`，逐轮真实dispatch、路径检查与completeTransport，等该批次全部到达才继续点击；只有全清且 `SUCCESS` 才给出 `WITNESS_PASS_STABLE_BATCH`。这证明给定顺序在该策略下通关，不证明所有Runtime60ms调度/重叠到达顺序，也不是全局可解性搜索器。计数合法但给定顺序卡死会拒绝生成PASS；同一棋盘可能存在另一条合法顺序。候选生成和隔离模型加载不等于Creator画面验收。

## 待选区公开证据与后续提案（2026-10-09）

本节记录主线程公开研究回传的产品身份和画面观察；本线程未重新联网或重放这些来源。该次公开研究的连续视频未成功播放；截图只支持可见元素及所列状态对照，不采用攻略站对隐藏机制的解释。它不修改本页既有编译合同，也不替代原Food Hunt Owner录像及其Target Lock。

| 产品 | 回传身份 |
|---|---|
| Food Hunt | EVERFUN / FUNFINITY PTE LTD；Android包 `com.vigafun.funfinity.foodhunt`（[Google Play](https://play.google.com/store/apps/details?id=com.vigafun.funfinity.foodhunt)）。 |
| Colony Flow | Android：ABI GAMES PTE LTD，包 `com.abi.colony.flow`（[Google Play](https://play.google.com/store/apps/details?id=com.abi.colony.flow)）；iOS：ABI GLOBAL LTD，ID `6779167923`（[App Store](https://apps.apple.com/app/id6779167923)）。 |

| 产品/关卡 | 回传的可见内容 | 不能由此确认 |
|---|---|---|
| Food Hunt Lv32 | 3列；记录黑78与黑70状态；取走黑70后，本列紫12前移，其他列不变。 | 连续视频派发节奏、其他关卡列数及所有补位情况。 |
| Food Hunt Lv100 | 4列；问号牌面未显示颜色和数量数字；红黑连接杆在待选区及临时槽均出现；棕色上箭头节点显示2→1。 | 连接组是否一次同时占N槽、问号隐藏内容及揭示时机、箭头节点计数/触发语义。 |
| Colony Flow Lv1/9、Lv200、Lv179 | 分别记录3列、4列、5列；公开画面含60数量、问号、连接杆、钥匙与锁。 | 各元素在所有版本/关卡的覆盖范围、连接行为及钥匙解锁的精确条件。 |
| Colony Flow 槽区 | 5槽全占时仍可见搬运。 | 不能推导“只要满槽即失败”；准确无进展失败条件仍需完整操作证据。 |

原始画面链接保留为研究来源组，Food Hunt逐条观察尚未在本次交接中绑定到具体帧号；后续应补充逐帧定位，不猜测文件与动作的对应关系：

- Food Hunt：[截图1](https://cover.foodhuntlevel.com/answer_screenshots/20260826/de6b2bb6650adba8c301f441169b149e.webp)、[截图2](https://cover.foodhuntlevel.com/answer_screenshots/20260826/a3f6f89ed2fd19913107f7ad9ae76998.webp)。
- Colony Flow：[Lv179 frame23](https://www.colonyflowlevels.com/levels/179/frames/colony-flow-level-179-frame-23.png)、[frame45](https://www.colonyflowlevels.com/levels/179/frames/colony-flow-level-179-frame-45.png)、[Lv200 frame1](https://www.colonyflowlevels.com/levels/200/frames/colony-flow-level-200-frame-1.png)。

待选区是底部数字组 `groups`，不是顶端 `boardCells` 图案。当前浏览器只有棋盘画笔；规则JSON能配置组的颜色、数量、列及深度，遮挡/可点击状态由模型派生。当前五列、2–50数量是我方合同，不是两款竞品的通用限制；现模型也不是“满槽立即失败”，而是在无在途任务、所有槽占用且没有可派发目标时失败。

后续建议先做基础可视化groups面板和可配置列数；若调整列数或数量范围，须同步确认产品规则并使模型、解析器、CSV编译器、布局及回归一致，不能只放宽editor。问号、连接组、钥匙锁及箭头节点另列机制提案，待连续操作证据和Owner批准后再接入；本轮没有实现或放开这些能力。已批准的棋盘→完整候选→明确隔离导入→真实纯模型见证链已完成，生产导入和Creator画面验收仍按前述边界处理。

## 来源与本次验证

来源为 `P4000/colony-flow-food-hunt/scripts/board-editor/`（7 个文件）及 `Tests/editor/board-editor.test.ts`；逐文件 SHA256、来源提交与源说明文档 SHA 见 [SOURCE.json](scripts/board-editor/SOURCE.json)。工具与测试按原字节迁入，文档按 4060 路径改写；原工程未修改。使用现有 TypeScript/tsx 依赖，无新增运行依赖。

初次迁入范围为编辑器类型检查、14项定向测试、本地HTTP资源及真实浏览器绘制、JSON下载与重新导入。后续增加本页说明的编译、见证和隔离导入；没有自动搬运顺序、数字组生成器或全局求解器。

历史编辑器回执：Node22类型检查与14/14测试通过；HTTP资源200，Edge绘制、下载、清空与重导入32×32唯一A格，截图已回看，当次测试服务随后关闭；源码检查点 `5fcab3e`。这不是当前服务或当前浏览器状态的证明。

编译器来源为原仓 `scripts/compileThemeCsv.mjs`，迁入时SHA256 `1d3a5ab54c441412ffcf1b71aa6820096a4eb0189ff07cb9460cf1f4df9b2d72`。保留原CSV领域校验与逐字节生成格式，新增只读默认入口、候选源参数及共享色表。当前60关、5主题40种收集物与68个图片引用通过一致性检查；实际数据未改。新增回归覆盖合法/非法配置、5/6槽差异、封闭洞卡死与替代解、过期/篡改拒绝、明确隔离导入和失败回滚；本机沙箱禁止创建硬链接，该项单独跳过并保留未验证标记。

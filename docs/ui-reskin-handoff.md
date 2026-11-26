# P4060 全套 UI 换皮交接

更新于 2026-11-26（北京时间）。生产目标仍暂停，由 Owner 手动恢复。

## 目标与当前断点

先交齐**公共 UI 和 Ant**的整套审核包，Owner 审核后进入 **Cook**。两阶段都审核通过后，再经 Game Meta 接入 Creator 并做运行验收。第一阶段目前卡在 **3 张玩法中景原任务未确认、果蔬及其他候选的统一风格复审、图鉴派生**。候选已生成和通过尺寸、内容检查的进度，与整套通过审核分别记录。

## 已完成的工作

| 范围 | 最新已核实的结果 |
| --- | --- |
| 一期对账 | 11 月 25 日 22:55 的 Game Meta 工作台 v83 对账覆盖 **141 项**。其中一期原定 **79 项**新制或返工，**76 项**已有技术和内容通过的候选，**3 项**结果待确认。另有对账单列的 **2 项**补充制作通过同项检查，已有 **3 项**图鉴预览，另外 **23 项**等棋盘母图定版。按素材对账，以同一素材的最新有效候选为准。 [逐件清单](../../../.agent-execution/evidence/p4060-stage-one-live-owner-package/current-stage-one-reconciliation.html) · [原始数据](../../../.agent-execution/evidence/p4060-stage-one-live-owner-package/current-stage-one-reconciliation.json) |
| 已确认可沿用的样板 | Ant **160×160 透明槽盒**使用已正式复测通过的成品。棋盘椰子沿用 Owner 确认的**四凹点**候选。共享入口已备程序绘制的新样式，待整套审核。 [槽盒验收](../../../tasks/P4060/doing/20261117-qwen-turbo-native-alpha-ant/formal-verification.md) · [一期预览](../../../tasks/P4060/doing/20261120-ui-reskin-stage1/stage1-preview.html) |
| 果蔬风格 | 以 Owner 选定的 **P0001 穗灯 v0.2** 为主风格参考。苹果、土豆用这套方向复测，最新成品是 512×512 RGBA，已核对 48 px 可读性，技术、内容通过，**风格仍待 Owner 确认**。 [穗灯原图](../../../P0001/art/review/canteen-transport/owner-approved-v0.2.png) · [48 px 对照](../../../.agent-execution/evidence/p4060-stage-one-live-owner-package/p0001-suideng-produce-final-48px.png) · [候选审阅记录](../../../.agent-execution/evidence/p4060-stage-one-live-owner-package/produce-suideng-current-review.json) |
| 玩法背景 | 已通过 Game Meta 核对五个 Ant 主题各自的远景、中景、前景，共 15 个原有资源。根茎远景风格已获 Owner 确认。两张热带远景已用各自原图回收成 **750×1334 RGB**，技术和内容通过，风格并入一期审核。 [原有图层回读](../../../.agent-execution/evidence/p4060-stage-one-live-owner-package/runtime-theme-preview-readback.json) · [热带远景回收](../../../.agent-execution/evidence/p4060-stage-one-live-owner-package/tropical-pair-rgb-recovery-complete.json) |
| 设置与 Cook 底稿 | 音乐开关按 Owner 的要求只保留一套视觉控件，已有新版开关候选，待在设置页确认。Cook 已有地图、关卡和厨房三张历史回收背景，其中两张需要视觉返工。独立订单卡有 256×256 候选，待查实际用途。 [音乐需求回执](../../../.agent-execution/evidence/p4060-stage-one-live-owner-package/music-on-note-only-readback.json) · [Cook 背景回收](../../../tasks/P4060/doing/20261117-full-art-review/recovered-20261118/cook/recovery.json) · [Cook 候选总览](../../../tasks/P4060/doing/20261117-full-art-review/README.md) |

## 三张待确认的中景原任务

三张目标均为 **700×467**。11 月 26 日 09:55 核对时，原任务均为 `UNKNOWN / ART_RESULT_UNCONFIRMED`。ComfyUI 当前队列和历史没有这三个原任务，按原文件名前缀尝试下载返回 404。同目录一张已知原图可打开。SMB 访客认证失败，尚未从 Windows 实际输出目录确认是否产出。Game Meta 宿主当次回读有 3 条美术请求未决，停服阻塞仍在。

| 中景 | 原请求号 | ComfyUI Prompt ID |
| --- | --- | --- |
| 果园 | `artgen-23b9a30fa157caa9facc044764fdb6aa` | `849d14c6-d10e-4433-b162-c389a8d298fe` |
| 根茎 | `artgen-afa9f7decdf8c4d693471c2aae0c1c51` | `8590e20e-27f2-4881-8d59-460c45c6f66f` |
| 热带水果 | `artgen-7630635124d0b3422b687203bb56d558` | `a5c1a94a-6ce0-4bd5-9276-3315f943cf1a` |

Windows 登录后先查 ComfyUI 实际输出根下的 `Game Meta\AB\raw`，必要时查旧输出目录。找到原图后，用原回执、PNG 和哈希走 Game Meta 正式回收。若 Windows 查证无产出，保留证据并走正式终态登记。当前 Game Meta 支持读取 ComfyUI 明确失败或凭原图回收，凭缺图登记终态的入口仍缺失。原请求保持待核实，确认终止后才为缺件安排新请求。 [Windows 核查步骤](../../../.agent-execution/evidence/p4060-stage-one-live-owner-package/windows-pending-mid-output-check.md) · [三条请求核对证据](../../../.agent-execution/evidence/p4060-stage-one-live-owner-package/three-mid-originals-coordination-20261126.json)

## 恢复顺序

| 顺序 | 还要做什么 | 交付标准 |
| --- | --- | --- |
| 1. 一期补齐 | 按上表处理 3 张中景。其余候选可并行审阅。按实际画面复核背景的图层、留白及透明边缘，确认关卡轨道底的实际消费者。设置页核对音乐开关只出现一套，分别检查开启和关闭。 | 每件有审核文件、使用位置或明确的待核验原因。 |
| 2. 一期整套审阅 | 以穗灯样本对照苹果、土豆及同组果蔬，统一材质、体块和光照。检查全部候选的技术、内容和风格，三项通过的棋盘母图再派生相应图鉴。交公共 UI 和 Ant 的独立成品、逐项清单及按运行画面标注的前后对照。 | 补齐母图与图鉴配对，保留候选哈希和规范版本，Owner 审核一期整套。依赖逐项见[一期放行清单](../../../.agent-execution/evidence/p4060-stage-one-live-owner-package/stage-one-release-check.json)。 |
| 3. Cook 整套制作 | 一期审核后，用 Game Meta 对照地图、选关、厨房、暂停、结算和实际可达状态。先复审已有背景，再确认旧计划里的 **7 张背景缺口**及订单卡、按钮、计时、顾客和交互反馈各自是否需要独立贴图、程序绘制或直接复用。按当前运行引用确认最终张数。 | Cook 逐项对应原引用、目标规格、审核文件和回退点，整套交 Owner 审核。 |
| 4. 接入与运行验收 | 两阶段审核后通过 Game Meta 分批接入 Creator，兼容时沿用原 UUID，记录旧资源与引用以便回退。从 `Bootstrap` 确认共享入口、Ant 首局、Cook 首单及关键状态，验证 Ant、Cook、Both 三包启动和首轮操作。 | 交付可运行工程、构建产物、前后对照、运行回执和回退记录。 |

## 恢复执行时沿用的规则

- 在 Game Meta 回读当前发布规范和每件需求。旧素材约束元件身份、轮廓及布局，P0001 主风格约束画法、体块、材质和光照，P4060 项目参考用于配色和实机可读性。逐项冻结尺寸、规范和规格版本、工作流、实际入模图及哈希、原请求编号。
- 补图优先用已验证的 Qwen 工作流。经 **Routa → Codex CLI → Game Meta → 局域网 ComfyUI** 派工，卡内只发「调用 start_batch 一次，返回任务编号和受理状态。」Game Meta 保存原图、成品和审阅结果。透明元件在深浅底和实际显示尺寸检查边缘、品红、碎片和主体完整性。
- 本页为暂停点的本地快照。恢复时先回读工作台和原编号。Dify 授权环境本次缺少 `DIFY_DATASET_API_KEY`，实时检索未执行，本页依据现有项目文档、Game Meta 回执与 Windows 接口核对记录。

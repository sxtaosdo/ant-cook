# Ant Cook 联合产品

**当前版本：`v0.3.0.1`**

状态: Draft

本目录是两玩法联合工程的未交付实现。Creator 3.8.8；Owner 已确认初始版本基线 0.3.0.0，正常版本 Hook 为本地检查点递增第四段；尚未配置独立远端或发布。

共享入口代码位于 `assets/shell/`。Ant 继续使用 `Colony / ColonyGame`，Cook 继续使用 `game / Game`，各自持有玩法状态和经济。新数据分别写入 `p4000.ant-cook.dev1.ant.*`、`cook.*` 和 `shell.*`，不读取、改写或清除两个旧工程的真实存档。

P0002 以 `extensions/shidai3` Git submodule 消费，固定 `2384980aab0c2bb60559b22cbef88d2c1391d784`（候选 2.0.7）。唯一 MK 能力提供者来自 v1.1.5；本副本局部修正场景取消、main 初始化等待、UI 注册身份、注销与失败清理、池迟到资源释放及 strict 类型，不能称为未修改的原版 MK。没有引入第二套 UI、资源、音频或池运行时。

验证使用 Node 22：`npm run typecheck` 与 `npm test`。执行集合为 `tests/unit` 与 `tests/provider`；后者运行实际 MKUIManage、MKBundle、MKObjectPool、MKStatusTask 源码，但 cc、IO、Release/View/Event 辅助能力使用替身，不是 Cocos Runtime 验收。`tests/ant` 和 `tests/cook` 是迁移时保留的来源测试材料，其中旧迁移断言不属于新产品兼容合同。Provider 的严格类型差异检查见 `P8000/dual-game-build/provider-typecheck.mjs`；仅证明相对字节核实的来源 baseline 无新增诊断，不表示 Provider 零诊断。

`P8000/dual-game-build/build-input.mjs` 在任务 Temp 目录创建独立 Creator 输入，支持 `ant`、`cook`、`both`，物理排除未选玩法。`SHARED_ASSETS.json` 记录通用遮罩纹理的构建期共享归属，纹理和 meta 保留原字节及 UUID；原目录不移动。工具拒绝没有 Creator 保存的 `assets/shell/Bootstrap.scene` 的正式输入。

当前限制：Bootstrap.scene 已经 Creator 3.8.8 创建、绑定 ProductBootstrap、保存并回读；Bridge 0.3.118 已获批安装登记。蚂蚁入口已在 Preview 显示。双向切换、真实保存故障恢复、三种正式构建和多尺寸视觉仍待本轮验收，不能将隔离夹具和业务测试计作 Runtime 完成。广告单元、AppID、远程服务和推广阈值尚未配置。

来源快照见 `MIGRATION_SOURCES.json`；功能状态见 `CHANGELOG.md`。

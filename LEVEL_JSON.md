# 编辑关卡后保存 JSON 并刷新游戏

状态：实现及隔离验收完成；真实 Creator 导入/Preview 待验证。源码检查点`9a6fbf6 / v0.3.0.112`。2026-10-21。

## 使用

在当前蚂蚁工程的棋盘编辑器中完成棋盘和待选区，选“目标主线关”，点“保存到工程”。确认后只替换该关玩法；其他59关、目标身份和美术信息保留。原草稿下载、检查/试玩、隔离候选功能继续可用。

固定输出：`assets/Colony/config/runtime-levels.json`。游戏Loading直接用现有资源接口加载这个JSON，不再用CSV生成TS作为主线玩法来源；用户无需手动编译配置。Creator自动导入完成后整页刷新游戏，新会话加载新配置。新文件首次进入工程也需要Creator识别其资源索引。

在已有Node22环境下沿用`pnpm run editor:board`。本机明确Node22命令为：

```powershell
cd D:/code/shidai3/P4000/ant-cook
& D:/code/shidai3/P8000/dual-game-build/node_modules/node/bin/node.exe --import tsx scripts/board-editor/serve.mjs
```

默认7469；已有实例不要重复启动或杀进程。旧编辑器实例在启动时缓存页面/编译模块，只有下次按原方式启动才加载新入口；本轮未替换现有7469/7470/7471服务，不宣称用户当前编辑器已更新。

## 校验、缓存与错误

格式沿用`food-hunt-development-level-catalog-v1`，完整60关。游戏与保存器共用结构及玩法校验；主补给关8/14/20为6槽，其他关默认5槽。保存不擅自重新设计奖励、画风或通关顺序，不把结构合法等同可解；建议先试玩。

保存使用当前文件SHA检查、同目录原子替换及原字节备份；备份在`temp/board-editor-backups/<原SHA>.json`。有冲突、备份异常、路径别名/链接、无效草稿或无效JSON会拒绝保存；不让浏览器指定任意文件路径。正常同进程写入由锁串行，不能承诺抵御无视锁并在最终检查/替换间强行写文件的外部程序。

Preview只对该JSON重载设置`reloadAsset:true`、`cacheAsset:false`和HTTP no-cache重验证头；没有改全局下载器、网络权限或Creator设置。已按在机3.8.8引擎代码核实选项合同；真实导入后的请求新鲜度仍待Preview实测。

加载、解析或领域校验失败时Loading显示“关卡JSON…”错误，停止进入Gameplay；不会自动改读旧TS掩盖失败。刷新会重建游戏内存会话，真实玩家存档不由编辑器写入。

## 验收边界

- 初始JSON与现有60关玩法逐值等价；没有覆盖原CSV、生成TS或改变实际关卡值。
- 修复前编辑器全组81/81；修复默认列数残留后，受影响存储与真实LoadingState隔离测试23/23通过。包括3/4→5、5→3、旧钥匙/锁/问号清除。
- 三组严格类型检查通过；新存储已纳入原标准检查和测试入口。
- 独立浏览器10/10：临时工程真实点击保存、页面重载新SHA、共享解析器读到新关卡、其他59关与备份字节保持、跨源和自选路径拒绝。游戏资源接口为替身，不冒充真实Creator/游戏预览。
- OCR本任务10/10宿主检查及只读reviewer复审无剩余确定P1/P2；硬隔离未核验。33份任务前已有并行文件哈希保持。
- 证据：`C:/Users/33272/AppData/Local/Temp/ant-editor-json-20261021/`，含browser-result.json、final-targeted-tests.log、editor-tests.log、review-summary.json和本地截图。未上传截图。

## 打包与后续

发布包消费构建时导入的JSON。修改本机源JSON不会更新已经发布的包；发布更新仍需重新构建/部署。当前未增加远程配置、版本切换UI或GitHub推送。

真实闭环的最小剩余动作：确认4060独立Creator窗口无其他任务占用，按既有标准刷新本轮JSON/源码并等导入/编译，再用独立且不接真实存档的Preview验证新JSON被读取。若需要把测试关卡写到实际工程才能验收，将先明确目标与恢复保护，不覆盖用户实际关卡试错。

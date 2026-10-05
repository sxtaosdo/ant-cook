# VScrollView

来源：[soidaken/VScrollView](https://github.com/soidaken/VScrollView)，MKFramework 扩展组件文档推荐的虚拟列表。固定上游提交：`5e1c8c6cd5dacd42894f617217f2ccf847572894`。

仅引入 `VScrollView.ts` 和 `VScrollViewItem.ts`；Creator 注册组件名为 `VirtualScrollView`。建设弹窗使用固定尺寸、纵向虚拟列表，替代分页，不使用 Creator ScrollView。

本地兼容修改：补齐严格空值检查，移除无效的 TypeScript 忽略标记；固定尺寸初始化后销毁组件自行生成的临时模板，外部提供的节点不在此处销毁。

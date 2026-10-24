# 第九轮：ARTEX 选择性适配

版本 `0.1.33`。新增队内记录检索、证据浏览与单条复核、队长交接面板。选择依据及未实现部分见 [ARTEX 研究](../artex-study-2026-10-23.md)，产品行为见[版本说明](../../release-notes/v0.1.33.md)。

## 使用

让队长或成员先搜索已记录的方法，再展开相关记录：

```js
const hits = await tools.ctf_teams_search({action:'search', query:'连接超时', source:'experiment', limit:5});
// 从 hits.results 中选出实际需要的 record_ref；下一页使用 next_offset。
// await tools.ctf_teams_search({action:'get', record_ref:ref, content_limit:4000});
```

记录只是报告，可能包含错误结论或待审命令。关键结论需独立复现；检索不包含原始会话、私信或未登记的磁盘输出。

解题面板的“证据与结论”支持本地搜索、类型/状态筛选和分页。展开一条记录可看依赖、取代关系、证据与核验历史。“复核结论”仅队长可用，发送一次有界请求，是否完成以工具实际记录为准。队长交接卡区分保存笔记和当前状态，状态变化会明确标注。

## 验收范围

最终产物哈希、完整回归、真实宿主与本机安装证据将在验收后记录于 `validation.json` 和 `evidence/`。真实宿主测试使用确定性模型替身和隔离工作区；不等于真实模型遵守率或解题率验证。交互式 GUI、在线平台提交及其他操作系统仍未验证。

## 验收结果

完整 `pnpm verify` 通过。同一产物通过开发宿主 0.2.0-rc.2 的真实工具流程、Desktop 0.2.1-rc.1 的工具流程与冷恢复、Desktop 0.2.1-rc.2 共 12 个场景。新增搜索通过真实 Code Mode 调用，冷恢复读取保持队伍字节与未提交候选不变；新增面板交互使用编译客户端与实际路由实现测试，GUI 仍未验证。

产物 SHA-256：`37db755eb58f9e02b33cca7183d5e693227629e3dea613c79f4668e357b3f083`。详见 [validation.json](./validation.json) 及 `evidence/`。

本机交付改由包含这些功能的 0.1.34 统一安装，见[Flag 布局修复记录](../flag-board-layout-2026-10-24/README.md)。0.1.33 的独立 tarball 未安装到用户 profile。

# CTF2 实战反馈改进 — 2026-10-13

以连续解题 31 题的维护者反馈为输入，保留原有 DAG 调度、成员唤醒、空 sync 不创造工作、归档和 captain-only flag 判定边界。插件当前源码版本为 0.1.29；本次是源码与 Git 安装产物更新，不是 npm 发布或 Harness 版本升级。

## 改动与适用范围

| 反馈 | 实现 |
|---|---|
| P0 批量 plan 错误难定位 | 新增按实际结构检查的诊断；区分缺失/未声明/类型错误；回显键名与行数，避免长 description 淹没错误。支持成员 `executionPrompt`。 |
| P0 任务必填字段 | 源码已有 `required:true`，保留，并验证生成 JSON Schema 的 `required:[id,subject]`；补工具描述和中英文示例。 |
| P1 平台 wrapper 冲突 | 格式不匹配登记原文并警告；支持 regex、regex 数组、alternation、null。推断 wrapper 仅作提示，不修改候选。 |
| P1 幻觉与交叉验证 | `evidence_kind`、`confidence`、`evidence`；旧/新 finding 默认待验证。captain-only `verify_finding` 保存方法、结论、观察及历史，并发布新同步记录。 |
| P1 候选 ID 使用不稳 | 返回 `team_id` 与含看板代际的 `flag_ref`；支持按原文定位，双选择器必须一致；错误列当前候选。加入磁盘重载与同名重建的回归。 |
| P2 已有战队 | `replaceExisting:true` 明确开启另一题；先校验新计划再归档；默认仍提示继续现有队。 |
| P2 中文 | UTF-8 磁盘往返、真实工具调用、终端宽度、Web 渲染回归；外部 GBK 输出须由对应进程/终端配置 UTF-8。 |
| 轻量模式 | `create(mode:"solo")` 跳过默认阵容、任务与参考库同步；看板、平台判定、归档仍持久化。拒绝给 solo 添加成员/任务。 |
| 归档与环境 | `delete` 返回归档路径；`archive_summary` 导出全部 findings、核验、候选和任务结果；记录 `environment_id` 并在 delete/replace 提醒释放槽位。 |

额外修复：去重改为原文大小写敏感，避免将 `EaSyRe` 与 `easyre` 合并；平台实际接受值以 `verifiedFlag` 单独存储；flag 判定更新参与 round sync；撤销最后一个 verified 候选会清除 solved 状态。

修正 fork 遗留的验收前提：真实入口测试按产物声明的 CTF 工具清单核对权限，不再写死上游 14/4 的数量；固定单 worker 的调度测试显式关闭默认四人阵容。Web 验收使用本插件的 `/action` 接口，验证一次面板点击排入用户回合、队长只批准一次的实际语义。slash 和 preset 指令也允许 solo；profile 的任务通过 create_task 添加，避免要求 API 不支持的“profile 与 DAG 同时提交”。

没有复现反馈中的跨调用 `f1` 可见性故障，因此不将未知根因描述成已定位。新增的看板代际引用、按内容定位、候选列表错误和重载回归覆盖了容易误用的操作路径。旧记录不强制迁移，缺少新字段时保留兼容读法；本地 `f1` 仍可用于当前看板。

## 使用例子

```js
const team = await tools.ctf_teams_create({name:"easyre",mode:"solo"});
await tools.ctf_teams_set_challenge({title:"easyre",flag_format:null,environment_id:"env-123"});
const report = await tools.ctf_teams_report_finding({
  content:"成功分支输出 EaSyRe",evidence_kind:"raw_output",confidence:"high",
  evidence:"xxd attachment.bin；原始字节与独立反汇编"
});
// 只有实际执行独立检查后才录入核验结论。
await tools.ctf_teams_verify_finding({finding_id:report.finding_id,method:"独立检查成功分支输出",result:"confirmed",note:"字节与大小写一致"});
const flag = await tools.ctf_teams_submit_flag({flag:"CTF2{EaSyRe}",evidence:"平台原始返回"});
// 实际提交平台并检查成功响应之后：
await tools.ctf_teams_mark_flag({flag_id:flag.flag_ref,team_id:team.team_id,verdict:"verified",note:"平台接受"});
const archived = await tools.ctf_teams_delete({});
const summary = await tools.ctf_teams_archive_summary({team_id:team.team_id,archived:true});
```

## 验证

- `pnpm typecheck`、`pnpm build`、完整 `pnpm verify`。
- `pnpm verify:ctf`：新增针对反馈的结构诊断、wrapper、大小写、同步判定、核验历史、代际和 UTF-8 测试。
- lifecycle：实际注册工具执行反馈的建队、记账、按原文判定、替换、归档序列；验证成员不能自证。
- client/dashboard：构建后实际客户端模块的渲染与 HTTP/action 回归，包含待验证、证据、登记值/平台接受值、格式警告与环境提醒。
- `pnpm verify:ctf:harness`：Windows / Node 24.21.0 / 已安装 Harness 0.2.0-rc.2，检查 278 个 DSH 分包版本一致，隔离 profile 冷启动真实 CLI、Loader、Agent 与 Code Mode；仅 LLM 和“平台接受”响应使用确定性 fixture。
- 打包后可用 `node scripts/ctf2-harness-smoke.mjs --artifact <package.tgz>` 对 tarball 运行相同真实入口。
- 同一已安装 0.2.0-rc.2 依赖闭包还验收了自然语言/slash 六种入口、30 轮普通对话后的固定头、真实 HTTP 面板批准、队员唤醒/回报、冷恢复、实际上下文压缩和稳定性场景；确定性 LLM 不代表真实模型推理质量。
- CI 的所有既有精确宿主矩阵新增 `ctf2-regression` 场景，并将 fixture 哈希纳入产物证据。

本地验收不包含真实模型推理、CTF2 在线平台、交互浏览器、其他操作系统或其他宿主版本；不据此扩大兼容支持矩阵。环境清理只是提醒，容器的实时状态和销毁仍由平台负责。已有成员的角色权限、调度和归档行为由原有完整回归继续覆盖。

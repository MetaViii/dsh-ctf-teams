# 第五轮选择性改进（2026-10-15）

本轮针对 CTF2 实战建议第 30、31、33 节，优先修复错误数据进入解题链、任务准入无法修正，以及模型配置难以核对的问题。所有修改暂留本地；没有提交、推送、发布，也没有替换桌面中已安装的上一份 Windows shell 修复包。

## 已实现

| 问题 | 本轮行为 | 边界 |
| --- | --- | --- |
| §31.1 限流错误被当作题目 JSON | 共享协议层识别顶层业务错误；代理为 JSON 与多行 SSE 工具返回补 `isError: true`，保留原始 payload、重试提示及元数据。CLI 非零退出、成功输出为空；平台准入也拒绝这些结果。 | 只识别明确失败标记或已知错误码与错误信息组合；不递归扫描题目源码，不自动重试提交。未来新增平台错误码仍需补充识别。 |
| §30.2① 旧代理没有 `/health` 被判离线 | `/health` 未识别时，使用实际 `/mcp` 地址执行只读 `tools/list`，验证 JSON-RPC id 和 CTF2 工具目录；报告探测方式、URL、HTTP 状态及具体失败。 | 新代理健康端点只证明进程存活，OAuth 和目标状态需要实际 facts 检查。非 MCP 的 HTTP 200 不算在线。 |
| §30.2② preflight 设错只能重建任务 | `edit_plan.update_task` 支持完整替换 `preflight`，`[]` 清空；`preflight_finding_id: ""` 清除离线证据引用。省略字段保持原值。重新计算阻塞原因；整批校验失败不落盘。 | 仅限 pending、attempt 0、未进入交接的任务；不修改正在执行或已经结束的尝试。 |
| §30.2③ 队员无法刷新准入事实 | 有效队员可调用只读 `platform_check`；写入共享事实前在锁内复核成员身份。状态与阻塞原因包含 preflight key。 | 仅调用 whoami、题目读取和环境读取；不提供目标生命周期操作或自动提交。被替换、已移除的成员不能获得刷新权限。 |
| §33 队长换模型后队员仍用旧路由 | status 提供 `route_diagnostics`；面板显示 provider/model 与差异提示，悬停可查看保存路由、在线请求路由和队长路由。 | 异构队伍是正常场景；不自动切模型、不创建通知或模型轮次。在线请求头不可用时明确标未知，保存配置不算实际调用证据。 |

模型诊断优先读取宿主的请求配置，尚无请求头时读取在线 Agent options。它不证明供应商最终计费模型、未开始的下一轮模型或历史每轮模型。归档只显示历史保存配置，不套用今天的队长配置。

## 使用示例

```js
await tools.ctf_teams_edit_plan({operations:[{
  action:'update_task', task_id:'t15',
  preflight:['challenge_unsolved'], preflight_finding_id:''
}]});
// 明确取消原先误设的准入条件：preflight: []

await tools.ctf_teams_platform_check({
  practice_ground_id:'实际练习场 ID', challenge_id:'实际题目 ID'
});
const status = await tools.ctf_teams_status({});
// status.members[].route_diagnostics：saved_route / live_route / captain_route
```

CLI 写缓存前必须检查退出码。PowerShell 示例：

```powershell
$challengeJson = node scripts/ctf2-cli.mjs call ctf2_get_practice_challenge challenge_id=... practice_ground_id=...
if ($LASTEXITCODE -ne 0) { throw '读取题目失败，保留已有缓存' }
# 仅在成功之后原子替换已有缓存；不要先用 > 截断原文件。
```

具体 CLI 命令以 `node scripts/ctf2-cli.mjs --help` 为准。错误结果不会进入成功 stdout，但 shell 的重定向仍可能在启动 CLI 之前清空目标文件；插件不能阻止第三方脚本忽略退出码。

## 暂未采纳或只解决部分

| 建议 | 取舍 |
| --- | --- |
| §30 pending→failed 或新增 blocked_external | 暂不新增任务终态。preflight 原地修复与成员只读刷新解决当前死锁；跨任务、调度器、归档和面板的新状态需要独立设计。成员仍可通过消息/发现板报告阻塞，不应伪称任务已执行。 |
| §31.2 任意 shell 长任务自动续跑 | 沿用已有任务 checkpoint；没有为宿主 shell 进程承诺自动恢复。outcome unknown 需要检查真实进程与平台状态，不能自动重放有副作用命令。 |
| §31.3 Windows/WSL 全工具探测 | 上轮已修复双 shell；本轮没有把 Windows PATH 缺失认作 WSL 缺失，也没有实现完整多运行时探测。运行时、路径与实际自测仍需单独建模。 |
| §31.4 parked/skipped | 暂缓，原因同新任务状态。 |
| §31.5 自动 wrapper 试投 | 不采纳自动试投；保留原始候选和有限显式变体。平台写额度和惩罚规则不能猜。 |
| §31.7 目标池静默截断 | 修复了插件入口的业务错误传播，第四轮已有有限分页扫描；未重写实战目录里每份临时采集脚本，也没有恢复历史丢失数据。 |
| §31.8～31.14 编码、台账、双向对账及归档审计 | 暂未实现统一台账/对账工具。不按字符串命中、文件名或数量巧合生成“已找回 flag”的结论，不自动删除所谓可重建文件。 |
| §27 验证链、§28 契约矛盾 | 本轮不声称解决证据伪造或独立验证。现有任务契约修订继续可用；上游对文件内容及修复谱系的绑定列入后续专项。 |
| §33 自动跟随队长模型 | 不默认采用。现有队员可能有意使用独立模型；通过明确 `update_member` 保留检查点并切换，避免隐式增加模型费用。 |

## 上游与验收

已审阅 AgentTeams 固定提交 `1094b84add6f2fb19edf659367fe2fd5f7f14154`（v0.1.23），适配合入旧会话消息来源兼容，其他缺口及优先级见 [上游审查](./upstream-review.md)。这不代表整个上游版本已合并。

验收命令、产物与测试范围见 [validation.json](./validation.json)。测试使用真实 Harness Loader、确定性模型及本地平台响应样本；没有调用真实解题模型或线上平台写接口。历史格式分支由兼容函数回归覆盖，未新增八宿主全矩阵验收承诺。

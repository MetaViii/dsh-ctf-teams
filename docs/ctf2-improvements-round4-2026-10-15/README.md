# 第四轮选择性改进（本地待审核）

对应原始建议第 12 节。当前基线为 `18bf393`，本轮仅修改本地，不提交、不推送、不发布 npm。已核对当前代码；不能把旧安装或模式配置问题直接视为缺失能力。

## 逐项结论

| 建议 | 状态 | 判断与处理 |
| --- | --- | --- |
| 12.1 未解列表陈旧 | 已实现显式扫描 | CLI 新增 `scan-unsolved`，关闭服务端未解筛选，有限分页、按 ID 去重、只保留明确未解条目。重复页、未知状态、矛盾状态、变化的总页数、提前空页和达到上限均提示不完整。未验证线上过滤器一定存在此缺陷，不把扫描称为原子实时真值。 |
| 12.2 队长 idle 后无通知 | 已实现 | 保留既有回收边界；保存检查点后撤销旧尝试、返回成员池，并在队长邮箱记录 task id、旧 attempt、触发原因及停止外部操作提示。重复 idle 不重复通知，不额外唤醒队长；没有实现永久 hold_task。 |
| 12.3 缺 challenge_id | 纠正观察并增强展示 | 原有 schema 已支持该字段，批量模式也已要求必填。本轮在提交响应和主动通知中明确展示 ID。单题离线场景不强制平台 UUID，也不强制每条证据必须是 URL。 |
| 12.4 来源可靠性分级 | 部分采纳 | 新增 `source_kind` / `source_url`，保存提交者、证据与时间；相同候选的新来源追加记录并参与同步，面板标为未复核来源。没有根据少量样本给域名打分、自动封禁网站或推断来源可靠性。 |
| 12.5 自动生成并试投变体 | 部分采纳 | 已有有限候选工具增加 `2/Z`。原文仍为第一项，保留数量上限与截断提示；不默认展开候选、不自动试投，不假定平台无错误提交惩罚。 |
| 12.6 固定领域分工 | 调整后补充指引 | 队长集中协调、成员承担长 lane 是可用安排，但环境需要由真实资源需求决定，不能把所有 Misc/Crypto/Reverse 一律视为离线题。 |
| 12.7 单题结束语义 | 已有批量功能，本轮简化入口并修复输出 | 保留 `multi_challenge` 与显式收尾；新增 `create(challenge_mode:"batch")`，派发前持久化模式，与执行方式独立。真实 Code Mode 还发现未设预计题数时 status 包含 undefined 而被拒绝的问题，已修复并增加回归。成员提示也区分单题与批量。 |
| 12.8 首屏清单 | 选择性采纳 | 补充一次协调扫描、成员共用清单、逐题 ID、资源与接受回执。未采纳忽略 solved 横幅、每次强制 whoami、并发追加同一 TODO 和自动试投。 |
| 12.9 401 后删除重建/自动换路由 | 部分采纳 | 补全裸 401、invalid_api_key 等认证错误分类，暂停成员并保留进度、合并通知；沿用已有 `update_member` 原位修复，不自动改用队长路由，不要求删队。CTF whoami 不能验证 LLM Key。 |
| 12.10 省略 model 更稳定 | 未采纳通用结论 | 当前全局 memberModel 仍可能对 inline plan 生效，省略 model 不保证继承队长。文档说明实际优先级和显式修复方式，不从一次 Key 故障推断供应商稳定性。 |

## 使用

```js
await tools.ctf_teams_create({name:'batch-demo',challenge_mode:'batch'});
await tools.ctf_teams_set_challenge({expected_challenges:10});
await tools.ctf_teams_submit_flag({
  flag:'保留原始候选',challenge_id:'真实平台题目 ID',
  evidence:'赛事、年份、附件匹配依据及复现命令',
  source_kind:'writeup',source_url:'https://example.org/writeup'
});
```

`source_kind` 可为 `local_output`、`writeup`、`index`、`manual`、`unknown`；仅给 URL 时来源类型为 unknown。来源不是真实性判定，禁止在 URL 中嵌入凭据。

```bash
node scripts/ctf2-cli.mjs scan-unsolved practice_ground_id=... category=MISC limit=50 max_pages=100 > unsolved.json
```

扫描默认最多 100 页，可设置 1..500 页；每页默认 50、上限 100。只执行列表读取，没有隐式缓存和平台写操作。退出码 2 时 JSON 是诊断用的不完整结果，不能据空列表宣称该分类全部解完。某页请求失败时非零退出，避免把之前读取的部分数据当完整清单。

路由故障时，核对状态中的 provider/model 后使用 `update_member({member_name,provider,model,reason})`；原有显式 fallback 维持原规则。没有验证任何真实账号 Key，也不自动产生额外模型费用。

## 验证范围

记录见 [validation.json](./validation.json)。新增回归覆盖分页与去重、完整性边界、真实 CLI 参数与退出码、来源追加/重载/同步、认证故障的检查点与通知合并、队长回收通知、面板展示，以及真实 DSH Loader 中的批量建队与候选来源契约。

真实宿主验收采用 `0.2.0-rc.2` 的精确依赖闭包。模型响应和平台回执是固定样本，不能代替线上 CTF、平台分页一致性、真实供应商鉴权及费用的实测。

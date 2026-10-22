# 第七轮选择性迭代（2026-10-23）

本轮重新读取原始建议；文件最新条目仍为 10 月 18 日第 41 节，没有新的实战反馈。因此从此前明确暂缓的建议中选择共享假设与实验记录，推进插件的解题辅助能力。没有改动用户会话、队伍、宿主安装、权限或供应商配置。

| 建议 | 本轮处理 | 边界 |
| --- | --- | --- |
| §20.1 假设台账与重复尝试 | 按 `challenge_id` 保存假设、预测和追加实验；精确去重、并发版本保护、稳定重试 key、跨成员共享和分页查询。 | 不能判断语义相同的攻击，也不阻止有合理理由的重复实验。 |
| §27 证据与真实推导脱节 | 文件快照绑定实际 SHA-256、大小和时间；显式复查最新实验文件，归档保留原始快照。 | **部分完成**。匹配哈希不能识别伪造输出，不能证明外部材料来自当前题目；没有自动执行任意断言或证明整条推导。 |
| §29 测量反驳被过度解读 | 实验区分 construction、measurement、observation；测量型反驳必须补下一项证伪检查，矛盾报告不覆盖。 | 插件记录方法与争议，不替代领域判断或独立复现。 |
| §20.2 独立 parked 任务状态 | 暂缓。 | 现有 checkpoint、remaining_items、任务重派继续适用；本轮不更改任务状态机。 |

## 模型调用示例

在已创建战队的工具上下文中使用，普通用户可以直接要求“先查这题已尝试的假设，再安排实验”。`method` 只保存文本，不会被插件执行。

```javascript
const proposed = await tools.ctf_teams_hypothesis({
  action: 'propose', challenge_id: '实际题目 ID',
  statement: '模数 n 是完全平方数', prediction: 'isqrt(n) ** 2 == n'
});
// 用现有 shell 实际运行自己的脚本，再按真实观察登记；以下内容仅为合成示例。
await tools.ctf_teams_hypothesis({
  action: 'record_test', ledger_ref: proposed.ledger_ref,
  hypothesis_id: proposed.hypothesis_id, expected_revision: proposed.revision,
  test_key: 'square-check-1', method: 'python square.py --n 49',
  observation: 'isqrt(49) ** 2 = 49', outcome: 'supports', basis: 'construction',
  next_step: '核对当前附件中的 n，再检查平方根是否满足题目约束',
  evidence_files: ['square.py', 'square-output.txt']
});
await tools.ctf_teams_hypothesis({
  action: 'list', hypothesis_id: proposed.hypothesis_id, check_files: true
});
```

`record_test` 要求当前 `ledger_ref` 和 revision，防止同名战队重建及并发追加时误写。相同作者、相同 `test_key` 和内容精确重试返回原记录；内容变化需要新 key。附带文件在重试时重新读取，文件变化会拒绝作为同一次实验重试。

列表默认返回 10 条假设、最多 20 条，摘要截断会标明；指定 `hypothesis_id` 返回完整假设和默认 3 条、最多 10 条实验，使用 `offset/next_offset` 翻页。`check_files` 只检查所选假设的最新实验，不对全台账偷偷扫描磁盘。证据每次最多 8 个、每个最多 32 MiB，须为工作区内普通文件。

新增记录各发布一次未复核 finding；查询和重复写入不改状态或同步游标，不产生唤醒。暂停时补记也不会恢复团队。实验记录不能自动标记题目完成、验证 flag 或确认 finding。归档摘要完整保留实验历史；公开 WRITEUP 只引用独立复现过的步骤。

## 验证

实际验证记录见 [validation.json](./validation.json)。测试使用临时工作区、合成文件与脚本化模型，不访问用户的 CTF 平台，也不提交真实 flag。真实 Desktop 内核测试通过发布 tarball 的 Loader、工具和 Code Mode 执行；模型本身为确定性测试替身。

未验证：真实模型是否稳定遵守实验协议、实际刷题收益、GUI 操作、多操作系统、外部平台写入及用户数据迁移。本轮不宣称这些已经完成，也不宣称消除了伪造解题报告。

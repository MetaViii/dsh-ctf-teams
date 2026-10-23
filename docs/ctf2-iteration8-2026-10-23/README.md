# 第八轮选择性迭代：从共享记录到决策约束

本轮落实 [SapperLens 对照](../sapperlens-study-2026-10-23.md)提出的三项优先改进。代码版本为 0.1.32，继续保留旧队伍、原权限与模型路由。ARTEX 对照按维护者要求在本轮实现与验证后进行，另行记录，不能据此宣称已导入 ARTEX 的功能。

| 方向 | 已实现 | 范围 |
| --- | --- | --- |
| 错误前提传播 | 观察/解释/决策分类、题目身份、依赖引用、传递待复核、独立更正引用；相同裁决幂等。 | 记录的复核不等于执行器独立证明；不自动撤回已发出的命令。 |
| 队长交接 | 版本历史、由运行时生成的紧凑状态、模型笔记、文件快照、状态摘要与版本冲突检查。 | 原会话冷恢复；不自动跨会话接管，不覆盖任务或恢复暂停队伍。 |
| 有界增援 | 按 challenge_id 限制活跃任务 lane；原调度器在释放容量和成员空闲后派发等待任务。状态与协议提示先做低成本反证。 | 并行容量是硬准入；时间、token、全部子进程/原生子代理硬预算尚未实现，进展信号只供决策参考。 |

## 证据依赖

成员与队长可用 `report_finding` 的 `claim_type`、`challenge_id` 和 `depends_on` 登记关系。完整 `finding_ref` 绑定团队与代际，拒绝跨题目和旧代际误引用。`evidence` 默认每页 10 条，最多 20 条；返回最多最近 5 项复核和总数，历史完整保留在归档。

前提变为 refuted/inconclusive 后，依赖者即使之前有 confirmed 记录也显示 `needs_recheck`，不能用于 offline_verified。重新确认需要先复核依赖；前提恢复不自动消除派生结论的争议。更正必须另写独立来源，`superseded_by` 不可指向原记录自己、其依赖后继或形成环。旧引用保持历史身份，不被复用。

每次新裁决只追加一条合并看板审计；读取和相同裁决重试不改状态或产生进度。不承诺只通知某一位成员，也不通过此工具强制取消正在运行的攻击；成员按原同步协议处理新的待复核信号，暂停/完成静默规则保留。

## 交接快照

```javascript
const loaded = await tools.ctf_teams_checkpoint({action:'load'});
await tools.ctf_teams_checkpoint({
  action:'save', ledger_ref:loaded.ledger_ref,
  state_ref:loaded.current_state.state_ref,
  expected_revision:loaded.latest_revision,
  assessment:'当前解释仍待反证', disputes:['500 是否由返回多行触发'],
  next_steps:['改变一个输入条件，独立捕获响应'],
  evidence_files:['reproduce.py']
});
```

`load` 总是给出当前运行事实；saved 是过去的运行快照和队长笔记，stale 提示其是否过时。可指定历史 revision，显式 check_files 重算对应快照文件。运行时变化和版本竞争会拒绝新写入；遇到繁忙状态应有限协调，不要持续重试。相同内容的重试返回原版本。

紧凑状态显示最多 40 项开放任务、20 项待裁决候选引用、20 项待复核引用及截断标记；状态摘要覆盖全部行，包括未显示的条目。交接不会把笔记当成任务写回，也不会确认未读看板、提交 flag、恢复团队或改变所有权。

## 并行容量与反证

`set_challenge({max_parallel_lanes:2})` 将每个 challenge_id 的 claimed/in_progress 任务限制为两个，0 清除。未配置时保持原行为；不带 ID 的任务共同排队。同题重复任务仍要求 allow_duplicate_challenge。降低上限不会中止当前工作，新任务等待容量。共享靶机独占仍使用 resource_key，实例数和并行 lane 不是同一计数。

`status.ctf.planning_signals` 展示去重后的实验报告数、最近登记时间、待复核数和已记录的下一步证伪检查。普通 finding 不刷新这些实验指标。报告不自动成为有效进展，插件不据此自行增援、换供应商或销毁环境。

## 验证与交付

验证和同一候选包的哈希见 [validation.json](./validation.json)。新增用例覆盖传递失效、恢复后的逐层复核、同代/跨代引用、循环更正、查询与重试静默、版本竞争、被截断行的摘要、容量释放和原会话跨进程交接。模型为脚本化替身，运行时与工具为真实实现。

未验证真实模型收益、GUI 操作、多操作系统、在线平台提交或自动执行任意断言。安装记录区分文件/数据核对、预设与启动、用户 GUI 确认；维护者已表示本轮前的 GUI 验收暂时不方便，不把未确认项目标为通过。

## 本机交付

0.1.32 已通过 Desktop 自带 CLI 离线安装，148 个包文件与上述同一验收产物完全一致，profile 的 CTF 预设和工具宿主正常组合，DSH 已重新打开。安装前完成内容核对的独立备份，原会话、战队、配置、其他插件版本及文件元数据保持。未恢复暂停战队。维护者表示暂时不方便验证 GUI，本项保留未验证；见 [安装记录](./evidence/local-install.json)。

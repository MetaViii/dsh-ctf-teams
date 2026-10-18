# AgentTeams 上游差异审查

审查日期：2026-10-15。上游 main 固定为 [`1094b84add6f2fb19edf659367fe2fd5f7f14154`](https://github.com/NanmiCoder/dsh-agent-teams/commit/1094b84add6f2fb19edf659367fe2fd5f7f14154)，发布说明为 [v0.1.23](https://github.com/NanmiCoder/dsh-agent-teams/blob/1094b84add6f2fb19edf659367fe2fd5f7f14154/release-notes/v0.1.23.md)。本地基线是 `18bf393ce0e9209512c49ba6ce2e1d6bfdecbb47` 加当前未提交的 CTF 专项修复。

使用独立临时 clone 比较源码与相关提交，没有修改本仓库 remote、分支或 Git 历史。命名、业务目标、看板和 CTF 验证语义已有差异，因此按能力适配，不直接替换 src/lib。

## 本轮适配合入

**旧会话来源兼容（#160，关联 `38a84b9`）**。上游指出旧存储格式在升级迁移时用闭集校验消息来源，直接写插件自定义 kind 会导致旧记录无法迁移。适配 `harness-compat.ts` 的来源选择规则：session format 小于 3 或版本不可用时写入 `{kind:'plugin',plugin:'@nanmicoder/dsh-ctf-teams'}`，较新格式保留 CTF 自有来源。统一用于命令激活、队员启动/投递和队长报告。

保留的是 CTF 插件身份，不写 AgentTeams 包名。新增兼容分支测试；真实当前宿主验证现代分支。未批量改写用户历史会话；上游历史修复工具依赖 lineage 与备份格式，未直接搬入。

## 尚有缺口，按价值排序

| 上游能力 / 提交 | 本地现状与后续选择 |
| --- | --- |
| 内容绑定的 verdict、修复/复核谱系（#161/#174/#175/#183；`884d0a0`、`dd0f070`） | 本地已有 revision、quality loop 和契约修订，但没有上游完整 artifacts/snapshot/内容绑定链。建议列为下一项专项，优先防止旧结论覆盖变更后的证据；不能把“文件 hash 相同”当作解题真实性证明。暂未合并。 |
| warm/cold、多跳 fork 身份（#176；`38a84b9`、`ef83938`） | 本地主要按持久 captain/member session id 授权。上游 lineage 不是单个函数补丁，还关联恢复入口、写权限和成员唤醒。后续需做 captain fork、成员 fork、旧 session 撤权、冷恢复的真实宿主回归；暂未合并。 |
| owner 配置的工具策略（#59；`f21f37c`、`d5f4083`） | 本地有 CTF 队长/成员工具边界，没有可复用策略 ID。对侦察/复核分工有价值，但要连同配置、持久化、冷恢复、工具过滤一起适配；必须保留协调工具且不能放松 owner 的显式 deny。暂未合并；工具过滤也不能代替 OS sandbox。 |
| provider/model 配对（#189；`6a3e33f`） | 本地已有创建时显式路由解析、同路由 effort 继承及 update_member 原位修复；未采用上游根据模型目录寻找 provider 的完整方案。本轮增加路由诊断以暴露问题；不依据裸模型名猜 provider。 |
| settled 后的成员失败记录（#205；`278ea20`、`57bc082`） | 本地已有当前尝试失败归属与去重，未合入上游完整“尝试已结算但 turn 失败”记录策略。暂不把任意迟到错误重新打开成工作，需独立验证不增加空转轮次。 |
| finding 行号规范化（#188） | 上游针对代码审查 findings 的行号写入及历史规范化；本地另有 CTF findings/flag 证据。尚未适配这套字段契约，不能宣称已经覆盖。 |
| Unicode card / legacy event fold（#203） | 本地已是自有 CTF 面板、状态快照和事件渲染，现有回归覆盖中文题名。没有搬入上游整套 ActivityPanel；未独立复现其原始 card bug。 |

## 合并约束

下一项建议优先处理内容与验证结论的绑定，再做 fork 身份和策略配置。每一项均需保留 CTF 原始 flag、逐题 ID、独立平台裁决、批量模式以及完成/暂停后零重复唤醒的契约。上游测试通过是参考证据，不能代替本地 tarball 与真实宿主验收。本轮没有升级依赖或扩大宿主支持矩阵。

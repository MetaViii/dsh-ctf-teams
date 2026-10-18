# 完成后重复唤醒与空白轮次修复

日期：2026-10-15。范围：本地源码、构建产物与用户桌面安装，未提交、推送或发布。

## 诊断结论

已在插件调度器定位并复现无限唤醒。没有必要把这次故障归因于 DSH 的目标调度，也没有通过隐藏 UI 消除症状。

旧条件为 `delta.hasUpdates || delta.solved`。成功投递同步后，收件人的看板游标已追上最新序号，但 `solved` 会一直为真。队员结束进入 idle，调度器再次投递同一份同步，队员再发模型请求并结束，循环由此持续。

DSH 原生子智能体结束通知会唤醒队长。插件在 pre-step 阶段拦截已交付任务报告对应的冗余通知，因而部分队长轮次没有模型工作，仍保留 turn/start 和 turn/end。这解释了截图中的大量空白“已完成，用时 1 秒”。拦截通知仅减少队长请求，无法阻止队员端的循环。

实际运行的桌面宿主为 `0.2.0-rc.2`。桌面 profile 加载的是 `@nanmicoder/dsh-ctf-teams@0.1.29` 的独立安装副本，其编译后调度器仍包含旧条件；它不是当前仓库的目录链接。故障团队的存档显示 `challenge.solved=true`，没有 `halted=true`，因此目标停止不等于团队暂停。

## 会话证据与 token 范围

诊断阶段通过 DSH 自带 JSONL/Zstandard 解码器只读检查了用户指出的 CTF2 会话及该队四名队员，没有改写日志或团队状态。随后用户授权安装修复；安装阶段在宿主完全退出后备份存档，持久暂停该团队并保留未完成任务的检查点，没有改写历史会话日志。

| 指标 | 快照值 | 含义 |
| --- | ---: | --- |
| 队长 turn/start | 855 | 与用户反馈的最后轮次一致 |
| 队长无 step/start 且 reason=blocked 的轮次 | 595 | 请求前被阻止；这些空白轮次本身未执行模型步骤 |
| 四名队员包含 round sync 输入的轮次 | 883 / 88 / 640 / 34 | 说明重复同步实际发生在队员端；不能直接把这些全部算作无效工作 |

队员的连续日志包含“一次 round sync、一次模型回复、completed”的重复模式，结束消息包括 `Idle.` 与 `Empty sync. **Idle.**`。因此有真实模型消耗，不能因队长空白轮次被拦截就判断为零 token。这里只确认请求链路，不把整场比赛总用量当作故障损失，也未计算账单金额。日志快照不是付费记录审计。

## 已完成与未完成

- [x] 调度器只在 `delta.hasUpdates` 时唤醒无任务的队员。
- [x] 保留完成通知：单题 flag 验证会推进 flag 序号，显式批量完成会新增 completion finding，首次通知仍会投递。
- [x] 保留成功投递后才推进游标的逻辑；失败投递不消费更新。
- [x] 单题与批量模式各验证 50 次 idle 事件和状态读取，已消费的完成状态不再投递。
- [x] 完成后新增证据仍投递一次，消费后恢复安静。
- [x] 团队暂停后，即使看板有新证据，也不再调度。
- [x] 真实 DSH Loader 验证完成与暂停后的模型请求和队长 turn/start 均停止增长。
- [x] 更新 README 和外部改进建议，提供临时止损与生效步骤。
- [x] 用户授权后已更新桌面 profile 的安装副本，并重新打开 DSH；70 个 `lib/` 文件与验收产物逐字节一致。
- [x] 故障团队保持持久暂停；两个未完成任务转为 cancelled，并保留原 output/checkpoint；flags 与 findings 内容保持一致。
- [ ] 未删除历史空白轮次，未撤销或追回已经发生的模型消耗。
- [ ] 未用真实付费模型重跑线上题目；原生验收使用确定性模型。
- [ ] 未把“暂停目标”改成“暂停整队”。目标与团队是两个生命周期，未经需求确认不互相绑定。

## 临时止损与本地更新

当前用户桌面已完成本节更新，团队保持暂停；以下步骤供后续安装时参考。

1. 在 CTF 团队面板点击“暂停”，确认显示“已暂停”。只暂停目标或取消当前模型请求，不能持久阻止团队调度。
2. 构建并打包修复。已验证的候选包名为 `dsh-ctf-teams-idle-loop-fix-0.1.29.tgz`，与原来的安装包分开保留。该文件为本地候选，版本号不代表 npm 已发布修复。
3. 完全退出桌面 DSH，再更新其 `desktop` profile 中的插件并重新打开。不要在有其他题目进行时强杀整个进程树。

在本仓库目录中执行：

```powershell
pnpm build
pnpm pack --out ./dsh-ctf-teams-idle-loop-fix-0.1.29.tgz
& 'E:\DSH\desktop\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add --save-exact --offline --ignore-scripts E:/dsh-ctf-teams-main/dsh-ctf-teams-idle-loop-fix-0.1.29.tgz
```

这里使用当前安装自带的 Desktop CLI，沿用桌面的 DSH_HOME。全局 npm 安装的普通 `dsh` 会拒绝管理 `desktop` profile，不能替代该载体。其他安装位置应使用其实际 `resources/runtime/cli/bin/dsh.cmd` 路径。当前桌面 profile 位于 `C:/Users/MetaVi/.dsh/profiles/desktop`。先退出宿主，避免文件锁和进程仍持有旧模块。`--offline` 要求既有依赖缓存完整；本次实际安装成功。历史 855 轮不会因为安装修复自动消失。

2026-10-15 20:45（本地时间）已完成安装与重启；其他插件依赖声明与 Desktop bundles 均核对未变。配置、锁文件、原插件和团队存档备份位于 `C:/Users/MetaVi/AppData/Local/Temp/ctf-idle-install-20261015-204338`，其中 `installation-receipt.json` 记录安装包哈希和文件比对结果。未自动恢复刷题，后续仅在用户明确要求时恢复团队。

## 验证入口

```powershell
pnpm build
pnpm verify
node scripts/ctf2-harness-smoke.mjs --all-scenarios
node scripts/ctf2-harness-smoke.mjs --artifact ./dsh-ctf-teams-idle-loop-fix-0.1.29.tgz --all-scenarios
```

新增回归位于 `scripts/lifecycle-verify.mjs` 和 `scripts/fixtures/harness-runtime-stability.mjs`。真实宿主的稳定性场景断言完成同步仅一次、新证据同步仅一次；待最后一条原生通知处理后，观察 1 秒，模型请求和队长轮次均不增长。暂停场景会停止实际运行且有待消费指导的队员，再验证安静状态。测试时间窗有限，结合序号门禁和 50 次主动重触发回归验证，不作为任意时长线上压测的替代。

命令、宿主闭包与实际结果见 [validation.json](./validation.json)。

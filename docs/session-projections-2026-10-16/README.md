# sessionProjections 失效：确认、缓解与恢复（2026-10-16）

**后续进展：** 重启并关闭 HMR 后仍有 7 次新失败，故该缓解不足以解决。第二次排查已复现审批生命周期的清理缺陷，并为审计版本增加保留原审批的可选兼容入口；详见[后续调查与验证](./follow-up.md)，实际应用状态见其验收记录。下文保留第一轮处理经过。

## 确认结果

故障真实存在。首次只读解析 CTF2 会话 `session-9ed23aca-8b7f-4188-a858-b28547b2014f` 的 517 个独立 Zstd 帧，共 1012 条记录、173 次工具结果。其中 **18 次真实 tool/result** 返回 `sessionProjections` inactive context，影响 `ctf_teams_mark_flag`、`pwsh`、`ctf_teams_status`、`get_goal`、`write`，时间为 2026-10-15 23:17:30–23:23:59（北京时间）。不把用户引用或模型自述计入失败次数。退出后快照增加一条记录至 1013 条，工具结果与故障次数不变；evidence 保留退出后的诊断。

这是宿主服务访问故障。CTFTeams 没有直接访问 sessionProjections；宿主目标、权限和其他域依赖这个投影服务。Cordis 在必需服务所属的上下文已失活时抛出该错误。所有工具同时受影响，符合公共执行链失败的现象；不是上次 WinPS5 引导脚本的 PSModulePath 问题。

**尚未证明本机的准确触发条件。** 先前切换 provider/model 与故障的时间接近，并不足以证明切模型导致失效；也没有完整复现原始竞态。官方仓库的[相同症状报告 #9812](https://github.com/deepseek-ai/deepseek-harness/discussions/9812)同样将具体触发条件列为开放问题，不能把讨论中的猜测当作已确认根因。

## 本机已实施

用户保存并完全退出 DSH 后：

1. 备份 desktop profile 的 `cordis.patch.yml`、package manifest 和当前队伍文件。
2. 在该 profile 的用户 patch 层追加[明确的 HMR 禁用条目](./hmr-disable.patch.yml)。
3. 将当前 `ctf2-b7` 的暂停持久化，只改 `halted` / `haltedAt`。任务、成员、flag 和发现逐项与备份对比相同，4 个任务均保留；没有调用会取消任务的普通 halt 路径。
4. 带上此前修复的原生 WinPS 模块路径，重新打开 DSH。新宿主 PID 5124、父进程 16344，启动于北京时间 11:42:30；启动后生成的组合配置确为 `hmr.disabled: true`。
5. 核对 package manifest 与备份一致：没有安装或升级任何插件，没有部署仍待安装的第五轮候选包，没有恢复刷题。

备份目录：`C:\Users\MetaVi\AppData\Local\Temp\ctf-runtime-repair-20261016-114210`。配置恢复必须在完整退出 DSH 后进行；恢复旧配置会重新允许自动 HMR。

关闭 HMR 是**减少自动配置重建的缓解措施**。本机精确 `dsh-base@0.2.0-rc.2` 默认启用 profile 配置监听；`root: []` 仍监听 profile/home patch 文件。确认用的是禁用 `hmr` 条目，而不是往 package manifest 写入未经该版本实现支持的 `patchReload` 字段。

**边界：** 关闭 HMR 只停止其监听与自动重载。插件管理器的主动安装、卸载或配置事务仍可能直接更新 Loader；长任务运行时应避免这些操作。本轮没有修补 Harness 的整个失效上下文迁移机制，也不保证所有同类故障不会再发生。

桌面 HTTP 接口要求正常认证，未绕过认证执行内部工具。实际桌面验证包括进程重启、配置应用和持久数据保留；工具连续性由下面的隔离真实宿主验收覆盖，没有发送真实模型请求或恢复用户解题。

## 诊断与回归

```powershell
node scripts/session-runtime-diagnose.mjs '绝对路径\session.v4.jsonl.zstd'
```

脚本只读，支持独立压缩帧拼接，输出错误次数、工具名与事件序号/时间，不输出 prompt、工具参数、凭据或 flag。遇到截断帧拒绝读取，不执行自动修复；先完整退出宿主，保留副本再重试。Node 需要支持 Zstd，当前使用 24.21.0。

```powershell
node --test scripts/session-runtime-diagnose.test.mjs
node scripts/runtime-services-smoke.mjs --artifact ./dsh-ctf-teams-windows-shell-fix-0.1.29.tgz
```

4 项单元回归验证多帧、真实失败计数、与正常权限拒绝的区分、损坏/截断拒绝。真实 Harness `0.2.0-rc.2` + 当前桌面同款插件，在明确关闭 HMR 后：三轮执行目标读取、文件写/读、原生 PowerShell、CTF 建队/状态；第二、三轮在一个工具执行中改写隔离 profile 配置并等待超过监听稳定窗口，再验证后续工具。通过正式模型选择接口往返切换模型，核对实际 request header；三轮均通过，权限投影持续存在。

这项测试证明缓解配置下的工具连续性，不是原始竞态的失败前后对照。模型使用确定性适配器，文件和工具及权限服务真实执行。证据见 [validation.json](./validation.json) 与 evidence 目录。

## 遇到同类错误时

停止重复试探，不把工具失败当作已写入；先保留未登记结果和检查点，再从宿主侧恢复。刷新前端不保证更换后端服务上下文。完整退出/重开后先核对状态，只有用户明确要求继续时再 resume。不要通过删除会话、重建队伍、放宽权限或尝试工具注入来绕过生命周期错误。

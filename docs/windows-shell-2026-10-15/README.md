# Windows PowerShell 与 Bash 启动修复

日期：2026-10-15。本地维护，未提交、推送或发布。

## 实际根因

新会话的 `pwsh` 工具在用户命令执行前报 `prepare-workspace.ps1` 无法加载 `Microsoft.PowerShell.Security`。错误来自已安装的 `dsh-ops@0.3.0/lib/workspace-preparation.js`：它在 tools/execute 钩子里固定启动系统 Windows PowerShell 5.1，继承宿主环境，执行工作区准备脚本。

DSH 桌面此前从 Codex 的 PowerShell 7 环境重开，继承了 Core 模块路径。直接以同样环境调用系统 5.1，能复现 Get-Acl 自动加载失败；显式 Import-Module 也会遇到类型数据重复等版本不兼容问题。把系统 WindowsPowerShell 模块目录放到搜索路径前面后，5.1 与 7.x 均能正常加载各自的 Security 模块。

因此，“所有 shell 命令都被拦在准备阶段”这个观察成立；“机器没有 PowerShell 7”“DSH 自带沙箱必然有故障”则不成立。实际已有 `@dsh-ops/pwsh-win32-x64` 自带的 PowerShell **7.6.6**，不在普通安装目录，也未必在 PATH 上。真正冲突发生在另外一条 5.1 引导链。

Bash 有两个独立因素：

1. CTF 预设在 Windows 上禁用原生 tool-bash。这有结构原因：宿主的 tool-bash 与 tool-pwsh 共用 `ctx.shell`，直接同时打开会把一种语言送进另一种解释器。
2. dsh-ops 提供独立 `ops_bash`，但该 profile 缺少可选 Bash 包，且关闭系统回退，故未发布这个工具。现有 Git Bash 能在普通进程里执行，其 MSYS 哈希却不匹配 dsh-ops 的受限执行桥接，不能把“能直接运行”当成“已支持沙箱执行”。

## 本次处理

- 插件启动时用 `src/windows-shell.ts` 在当前进程内优先加入系统 5.1 模块目录。保留用户自定义目录、去重，卸载时恢复；若后续其他所有者修改该变量，则不覆盖它。不修改系统环境变量、注册表、ACL 引导逻辑或第三方插件源码。
- 保留 Windows 原生 PowerShell 工具，使用 dsh-ops 已有的独立 `ops_bash`，没有把 Bash 命令交给 PowerShell，也没有关闭工作区准备钩子。
- 通过已安装 dsh-ops 的 `provision-shells --bash` 补齐其固定版本 PortableGit **2.56.0.2**。官方 Git for Windows release 产物 SHA-256 为 `075e158ef8e1f0ab80b347e245405d3eca735c2dc88fd8e032e137d0ca61f61b`，下载后已校验。兼容运行时位于 `~/.dsh/dsh-ops/shells/bash/2.56.0.2`，MSYS 与 dsh-ops 桥接要求一致；现有 Git 安装不变。
- 更新预设注释、README 与协作知识库，说明 PowerShell、独立 Bash、WSL 的边界，以及引导错误不能靠反复换参数解决。

本次保留 `allowSystemShellFallback:false`，新启动的 dsh-ops 会自动优先读取已经校验的托管 Bash。无需额外配置全局 PATH 或绑定 Codex 私有 PowerShell 路径。若没有安装 dsh-ops，此补丁仍能修复 PowerShell 模块路径，但不会凭空增加 Bash 执行器。

## 验证

5 个纯回归覆盖模块目录优先级、大小写与去重、挂载/卸载及后续所有者、非 Windows 不生效等行为。已有项目完整验证通过。

`scripts/windows-shell-smoke.mjs` 会创建隔离 profile 和工作区，挂载精确的 DSH `0.2.0-rc.2`、真正的 CTF 预设和 dsh-ops `0.3.0`。只有模型使用确定性样本；工具、工作区引导、子进程、PowerShell、Bash、权限策略和 Windows 沙箱均真实执行。

| 会话模式 | PowerShell 7 | 独立 Bash |
| --- | --- | --- |
| workspace-write | 模块加载、工作区写入成功；越界写入被拒绝 | 工作区写入成功；越界写入被拒绝 |
| read-only | 工作区写入被拒绝 | 工作区写入被拒绝 |
| danger-full-access | 正常执行 | 正常执行 |

验收使用 CTF 预设检查 `pwsh` 和 `ops_bash` 均可见，读取工具实际输出并检查文件，未用取消沙箱或强制完全访问冒充修复，也未调用真实付费模型。

```powershell
pnpm build
node --test scripts/windows-shell.test.mjs
pnpm verify
node scripts/windows-shell-smoke.mjs --ops-root 'C:/Users/MetaVi/.dsh/profiles/desktop/node_modules/dsh-ops'
# 打包后仍需用 --artifact 参数验证同一安装包：
node scripts/windows-shell-smoke.mjs --ops-root 'C:/Users/MetaVi/.dsh/profiles/desktop/node_modules/dsh-ops' --artifact ./dsh-ctf-teams-windows-shell-fix-0.1.29.tgz
```

原生测试为 Windows 专项，依赖已安装 dsh-ops 和已校验的托管 shell，不作为未满足这些前提的跨平台 CI 的默认步骤。测试会在临时目录保留报告和隔离状态。

## 生效与边界

本机已于 2026-10-15 22:26（Asia/Shanghai）完成桌面安装与重启，72 个编译文件与验收产物逐字节一致，其他插件依赖和 Desktop bundles 保持原样。启动时显式优先加入系统模块目录，插件也会在后续启动时应用同一兼容规则。桌面宿主新进程和本地监听已核对，运行时解析同时返回 bundled PowerShell 与 provisioned Bash 可用。

安装前的配置、锁文件和原插件备份位于 `C:/Users/MetaVi/AppData/Local/Temp/ctf-shell-install-20261015-222625`，其中 `installation-receipt.json` 保存部署比对结果。没有修改历史会话或恢复解题目标。实际模型工具执行验收在隔离新会话完成，没有向用户会话自动发送测试提示。

需要把本地修复包安装到实际 desktop profile，并完整退出再启动 DSH。已有进程的 shell 解析是启动时快照，仅创建新会话不一定重新发现 Bash。

桌面安装要使用安装自带的 CLI，全局 npm CLI 会拒绝 desktop profile：

```powershell
& 'E:\DSH\desktop\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add --save-exact --offline --ignore-scripts E:/dsh-ctf-teams-main/dsh-ctf-teams-windows-shell-fix-0.1.29.tgz
```

PowerShell 里先运行 `$PSVersionTable.PSVersion` 和 `Get-Acl .`，Bash 用模型实际获得的 `ops_bash` 运行 `printf 'BASH_OK\n'`。对新会话和原失败会话分别确认工具列表；不要在旧工具调用错误上无限重试。

WSL 的 `kali-linux` 已实际启动成功，`/usr/bin/python3` 存在；本次探测没有找到 `sage`。`ctf_teams_env` 仍是宿主本地工具探测，不代表 WSL 的完整工具清单。未把用户提供的“这些在 Kali 都存在”直接作为已验证事实，也未在本次引入自动 WSL 安装或批量平台操作。

安装与验收的最终状态见 [validation.json](./validation.json)。

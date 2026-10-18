# DSH 后续更新兼容：0.2.1-rc.2 与有界加载策略

本次根据维护者“不要每次更新都不能用”的要求，将宿主加载准入与精确实测矩阵分开。仅本地修改与安装，不推送或发布。

## 故障与证据

实际 Desktop 已升级到 `0.2.1-rc.2`，profile 中仍安装上一轮 `rc.1` 本地包。旧包的 21 个 DSH peer 精确枚举到 `0.2.1-rc.1`，新版宿主按声明跳过整包，最终组合配置没有 `preset-ctf-teams`。此前用户已经确认 `rc.1` 能创建会话并正常回复，该确认不等同于 `rc.2` 验收。

从当前 `E:/DSH/desktop/resources/app.asar` 只读提取隔离副本，与上一轮 `rc.1` 副本对比：`dsh-app-boot`、`dsh-agent-preset`、`dsh-subagent`、`dsh-experimental-auto-review`、`dsh-system-prompt`、`dsh-tools` 与 Cordis 的 `lib/index.js` 字节完全一致。完整文件哈希见 [提取证据](./evidence/desktop-extraction.json)。这只证明这些入口未变，不能推导整个版本没有变更。

官方 [rc.2 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)列出模型与搜索 API 更新。实际产物中，宿主优先检查 `engines.dsh`，否则检查 DSH peers，使用 `includePrerelease: true`。

## 新规则

| 层次 | 行为 |
| --- | --- |
| 加载准入 | `>=0.2.1-0 <0.3.0-0`，包含后续 `0.2.x` 的 RC、Alpha 和稳定补丁版；旧宿主保留精确声明。 |
| 实测矩阵 | `supportedHosts` 继续保存精确目标，CI 不会下载猜测的未来版本。当前新验收目标为 `0.2.1-rc.2`。 |
| 诊断 | doctor 对区间内但矩阵外版本显示 `compatible-untested`；继续检查缺包、依赖混装和重复运行时身份。 |
| 子代理 | 优先使用 `startActivation` / `drainChildren`，否则走旧 API；保留 persona、工具限制、队员结果归属和冷恢复适配。缺少必要契约时明确报错。 |
| 自动审批 | 已审查的实现继续使用局部清理修复；实现或注入形态变化则完整安装官方审查器，保留其依赖、配置、拒绝与失败结果。缺失审查器仍明确失败。 |
| 安装 | 补丁放在用户 profile 外的稳定兼容目录，不修改桌面 ASAR，不依赖每次升级后的应用目录或仓库临时构建文件。 |

`compatibleHostRange`、`engines.dsh` 和 DSH peer 声明由同一规则约束；禁止 `*` 和无上界放行。开发 SDK 与 pnpm overrides 继续精确固定 `0.2.0-rc.2`，不会因放宽用户加载范围引入混装。npm 自身的默认 prerelease peer 匹配不同于 Harness 的门禁；不要通过自动安装另一套 DSH peer 来消除预发布警告，桌面继续使用宿主提供的 SDK。

自动审批回退不会自动切换用户权限，也不会把审查器失败解释为允许。未知新实现暂不应用旧清理补丁，因而不能承诺原先清理问题在所有未来版本都已修复；HMR 仍保持关闭。历史权限服务在线重建问题仍未扩展修复。

## 验证与边界

验证结果见 [validation.json](./validation.json)。新增测试覆盖真实宿主两个门禁路径、后续 RC / 补丁准入、次版本上界、诊断不冒充实测、官方审批器新增依赖和拒绝/失败传播。完整项目回归之外，打包产物在实际 `rc.2` 依赖闭包中进行队员生命周期、故障回退、任务恢复、CodeMode、Web 审批、真实 shell 与目标工具测试。

允许加载不能防止上游真正删除 API 或更改存储格式。`0.3.x` 和跨主版本升级仍须审查；范围内版本若真正更改必需契约，也可能需要适配。用户会话、队伍、模型路由和权限配置的保留情况按安装证据单独记录；不自动恢复刷题。

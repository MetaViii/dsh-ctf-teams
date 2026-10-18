# 局部升级审查台账：0.2.0-rc.2 → 0.2.1-rc.1

本次针对用户插件故障做端点产物审查，不是两个版本全部提交的变更或 revert 普查。旧端为项目锁定的 npm 依赖闭包，新端为本机实际桌面 ASAR 的只读副本；不把发布日期或 release 叙述代替 API 实现证据。

| 边界 | 旧实现 | 新实现 | 适配与证明 |
| --- | --- | --- | --- |
| 组合包准入 | 插件声明精确支持到 0.2.0-rc.2 | 运行时为 0.2.1-rc.1，声明不匹配而整包跳过 | 加入精确目标；原包真实启动失败，新包能注册、选择并执行 CTF 预设；未授予豁免 |
| Persona 目录 | 可插值 cwd | 不再注册 cwd 变量，workingDirectory 提供必要上下文 | 配置按服务存在性选择；单元覆盖两分支，实际新旧宿主工具回合通过 |
| Auto 依赖 | approval/llm/permissionPresets/sessions/tools | 额外需要 workingDirectory，apply 主体指纹相同 | 兼容入口动态注入审计过的完整依赖集；审批异常继续阻止写入 |
| 队员启动 | startContinuable，provider 声明 persona/toolFilter | startActivation，provider 声明 agentPreset，启动请求不再消费 persona/toolFilter | 新入口映射及可信子 scope 角色/限制，旧请求保留；真实队员首轮、冷恢复和受限工具集 |
| 后代限制 | start/startContinuable | startActivation | 三入口按实际存在性安装守卫；新旧单元验证限制，避免制造不存在的旧方法 |
| 定向收尾 | drainContinuableChildren | drainChildren | 兼容 seam 保持所有者、ID、receiver 及异常；真实 route repair、重派、归档和暂停 |
| 工具展示测试 | mixed 可见原生目录 | 仅正式 native/ptc 模式 | 原生测试选 native，另测实际 Code Mode；不伪造模型目录中缺失的工具 |
| Web 测试组合 | headless 隐含交互凭据 | headless 明确禁用 credentials | 仅隔离 Web 测试启用交互凭据，正常令牌交换产生 cookie，产品认证保持开启 |

七类触点：①旧审批清理兼容入口已审计依赖并实测；②成员创建事件、队伍事件及投递通过原回归核验；③服务 API 的启动/收尾迁移及错误透传已覆盖；④安装仅改 profile/包/兼容目录并备份，测试不触碰用户状态；⑤preset 注册、工具与斜杠命令有真实回合；⑥面板 API 继续使用真实认证；⑦真实 PowerShell 与产品入口退出、冷恢复均有实测。没有新增公开通道或扩大网络权限。

确认未变：Session format 仍为 4、subagent descriptor format 仍为 3；persona 的作用域 section 接口和现有 host FIFO 投递符号仍可使用；保留成员历史描述中的 persona/toolFilter，不批量改写持久数据。完整用户数据迁移仍由宿主负责，本次不额外转换会话文件。

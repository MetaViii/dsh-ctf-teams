# Desktop 0.2.1-rc.1 升级后 CTF 预设缺失（2026-10-17）

## 结论

当前桌面实际为 Harness `0.2.1-rc.1` / Cordis `4.0.5`。旧安装包的全部 21 个 DSH peer 只列举到 `0.2.0-rc.2`，新版启动时按声明跳过整个 CTF 组合包，因而没有注册 `preset-ctf-teams`。在桌面同款隔离运行时重现了用户的 `agent-preset/not-found: Unknown agent preset: ctf-teams`，不是历史会话或队伍文件丢失。

仅补版本声明仍不足以运行。真实回合与组队回归继续发现工作目录提示、旧审批兼容入口以及子代理启动和收尾接口的变化。本次适配覆盖这些调用，见[迁移台账](./migration-ledger.md)。原诊断、实际应用和验收范围分别见 `evidence/diagnosis.json`、`evidence/desktop-install.json`、[validation.json](./validation.json)。文件不存在时表示该步骤尚未记录，不能按文案推定已完成。

## 改动

- `package.json` 的 DSH peer 精确加入 `0.2.1-rc.1`；兼容清单新增该目标。保持 `0.2.0-rc.2` 开发依赖闭包和原有旧版本声明，不扩大到未验证的未来版本，不添加版本豁免。
- CTF persona 在存在新版 `workingDirectory` 服务时使用宿主提供的必要目录上下文；旧宿主继续使用其支持的 `{{cwd}}` 插值。
- 审批兼容入口按审计后的上游完整依赖集创建子上下文，新版包含 `workingDirectory`。继续使用宿主的审批策略，只修 effect 清理；不把“apply 函数未变”误作全部依赖未变。
- 新子代理使用 `startActivation`，由 CTF 插件接收执行结果并维持自有任务回报；旧子代理继续用 `startContinuable`。新版不再接受启动时 persona/toolFilter，因此在可信成员的创建前 scope 安装角色和限制；从队伍持久状态冷恢复，保留历史描述中的已有覆盖。
- 委派深度检查覆盖新 `startActivation`，不在新版伪造已经移除的方法。暂停、归档、重派和模型修复使用新版 `drainChildren`，旧版仍用 `drainContinuableChildren`，保留原父代理所有权校验与错误传播。

## 验证与边界

从本机新桌面 ASAR 只读复制完整运行时到隔离目录（17,247 个文件，含 1,583 个 unpacked 文件），没有修改桌面 ASAR。测试直接运行该运行时的产品入口；模型与平台回执为确定性样本，工具、持久化、文件、PowerShell、认证 HTTP 面板与代理生命周期真实执行。

验证包含新建/恢复 CTF 预设会话、队员首轮角色及工具限制、FIFO 投递、失败路由修复、降级、旧成员冷恢复、队长闲时唤醒、自然语言/斜杠入口、认证面板批准、Code Mode、暂停与完成后不重复唤醒。原生工具和审批清理也用同一个最终包分别在新旧两代宿主运行。各报告的实际通过项以 `validation.json` 为准。

旧测试驱动中有三项独立适配：使用完整用户消息而不是被技能目录挤出的截断尾部断言；稳定性驱动改用新旧统一的启动/收尾入口；headless 中默认禁用交互凭据，认证 Web 场景明确装配隔离凭据服务。保留修复前失败报告，不把它们删去或忽略后宣称全部通过。

没有调用真实付费模型或向 CTF2 写入，没有用测试修改用户会话；其他操作系统、全部历史宿主矩阵及真实模型供应商未重新实测。旧版 `sessionProjections` 原始竞态与在线 Auto 权限服务重建限制，仍按[前次调查](../session-projections-2026-10-16/follow-up.md)记录，不能据本次恢复扩大为全面根治。

## 本机应用

安装须在用户保存并完全退出 DSH 后进行。备份 profile、当前安装包及审批兼容文件，使用独立文件名的本地包更新 CTF 安装；旧审批兼容目录保留，profile 改指向本次稳定目录。原权限、模型路由、其他插件和队伍状态不作业务改动。回退时也须退出，再恢复本轮备份及旧依赖包。

本次仅本地维护，不提交、不推送、不发布。宿主官方变更来源为 [0.2.1-rc.1 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.1)；具体 API 结论来自实际安装产物的逐项核验。

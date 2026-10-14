# CTF2 第二轮改进与验收（2026-10-14）

本轮依据更新后的 `E:\DSH\CTF2\dsh-ctf-teams-改进建议.md`，重点处理 P1-4～P1-9、3.4～3.7 及 100 分题复盘。原始观察保留，状态以本文和原建议中新增的实施标注为准。第一轮记录见 [2026-10-13](../ctf2-improvements-2026-10-13/README.md)。

## 完成状态

“已完成”指插件功能已实现且对应本地验证通过；不表示已重新登录 CTF2 刷题，或已验证真实账号的限流恢复。

| 建议 | 状态 | 实施与边界 |
| --- | --- | --- |
| P0-1、P0-2：计划输入及错误说明 | 已完成（上一轮） | 支持成员 executionPrompt；任务 id/subject 必填；非法字段和缺失字段分别报告，长中文输入保留简洁结构诊断。 |
| P1-1：格式过滤与平台冲突 | 已完成（上一轮） | 格式仅警告，原文和大小写保留，支持多个格式或 null；本轮新增嵌套包装识别。 |
| P1-2：成员幻觉与复核 | 已完成（上一轮） | evidence_kind/confidence/evidence 与独立 verify_finding 历史；声明不会自动变为事实。 |
| P1-3：flag 定位 | 已完成（上一轮） | 返回含战队代次的 flag_ref，支持精确内容；本轮不同题目的相同字符串独立记录，内容歧义要求用 ref。 |
| P1-4：创建/重派唤醒 | 已完成 | 返回调度后的真实状态、attempt_id、dispatch_state/reason；不靠 send_message 启动任务。依赖、忙碌、未读待投递邮件、资源和故障会明确说明等待原因。 |
| P1-5：外部代理静默掉线 | 部分完成 | /health、请求超时、CLI 指向代理不可达；可选宿主管理代理，异常退出有限重启；删除战队不停止共享代理，外部已有代理不归宿主所有。历史退出根因未查明，活着但挂死的进程不强杀，操作系统杀进程权限未隔离。 |
| P1-6：NO_ADAPTER/429 通知风暴 | 已完成 | 持久化按成员/错误码计数，同类只通知一次；配置错误立即 faulted；429 展示提供的重试/重置时间，未知时不猜；历史重复邮件折叠。update_member 验证并修复路由，先撤销旧写权限再排空旧子会话。 |
| P1-7：批量题目过早 SOLVED | 已完成 | multi_challenge、expected_challenges、每条 flag 的 challenge_id；按不同题目计数；单题通过继续工作，mark_challenge_solved 明确结束批次。单题默认行为保留。 |
| P1-8：嵌套包装和候选变体 | 已完成 | 平衡括号识别；variants 或 generate_variants 显式登记独立候选/ref/复核历史；不自动尝试平台提交，不把变体静默覆盖到原文。 |
| P1-9：503 判失败/恢复卡死 | 已完成 | 最终临时基础设施故障保留任务所有者、checkpoint、remaining_items；冷却后自动恢复一次，再次失败等待修复；auto/queue_if_busy 可进入可用成员或共享池。真实上游无可用账号需上游恢复。 |
| P2-1：已有队伍互斥 | 已完成（上一轮） | replaceExisting 先校验后归档；坏计划不损坏旧板；继续现有战队有明确提示。 |
| P2-2：GBK 乱码 | 部分完成 | 状态/归档/真实宿主中文用例通过，图片 Python 输出固定 UTF-8；旧终端、外部脚本及 GBK 字节源没有统一转码，无法保证所有控制台。 |
| 3.1：solo | 已完成（上一轮） | 跳过成员、任务和引用仓库准备，沿用候选/复核/归档审计。 |
| 3.2：包装推断 | 已完成 | 标明原始 wrapper 和格式警告；嵌套变体仅显式生成。 |
| 3.3：生命周期 | 已完成（上一轮） | archive_path、archive_summary、平台环境清理提醒；不会自动销毁平台靶机。 |
| 3.4：独占环境槽位 | 部分完成 | 同战队同 resource_key 的任务串行化，报告 holder；被阻塞的任务不饿死其他离线任务。跨战队/多宿主的账号级锁、平台原子租约未实现；实际环境释放仍需平台操作。 |
| 3.5：只读 preflight/离线自测 | 部分完成 | 白名单检查在调度、claim、队长接管前执行，过期/未知/错题事实均阻塞。platform_check 只读刷新事实并触发调度；offline_verified 要求队长确认的可复现 finding。不自动在每次派发前请求平台，不运行任意字符串脚本。 |
| 3.6：实例存活时提交 | 部分完成 | requires_running_target_for_submit 提示核验/恢复靶机，明确环境失败不等于 flag 错。插件的 submit_flag 只登记候选，不掌控外部 CLI/MCP 提交或 stop，因此无法强制外部动作次序。 |
| 3.7：非视觉降级 | 已完成（功能），部分实测 | image_to_text 支持 ASCII、OCR、QR/条码和像素比较；限制工作区路径，结果明确未验证。ASCII/像素/真实 OpenCV QR 实测通过；OCR/Tesseract 与条码/ZBar 未在本机完整实测，依赖缺失有提示。 |
| 活跃 challenge 去重 | 已完成 | create_task 的 challenge_id 禁止意外重复；allow_duplicate_challenge=true 允许明确的并行角度。未填写 challenge_id 的旧任务不推测去重。 |
| 全员限流后的队长接管 | 已完成 | 状态和网页提示暂无可用成员，沿用 reassign_task(assignee="captain") 单任务接管并保留证据。不会擅自切换模型、清空队伍或启动未授权接管。 |
| 平台接受 → 战队板自动对账 | 未实现 | 外部提交成功仍由队长调用 mark_flag 记录；未拦截任意外部工具结果，防止将其他题目或网络错误错记为通过。 |

## 使用方式

批量刷题先设置：

```js
await tools.ctf_teams_set_challenge({ multi_challenge: true, expected_challenges: 23 });
// 每个任务/候选填写真实 challenge_id。
await tools.ctf_teams_create_task({
  subject: '验证 ch1', assignee: 'agent-1', challenge_id: 'ch1',
  resource_key: 'ctf2-single-slot',
  preflight: ['environment_free', 'challenge_unsolved']
});
// 平台只读检查通过后，调度会派发；环境须在平台上显式释放。
await tools.ctf_teams_platform_check({ practice_ground_id: '真实场 ID', challenge_id: 'ch1' });
const candidate = await tools.ctf_teams_submit_flag({
  flag: 'flag{GWHT{原文}}', challenge_id: 'ch1', generate_variants: true,
  evidence: '解题脚本、命令与原始输出'
});
// 实际平台验证后，以对应 ref 记录。一次通过不会结束整批工作。
await tools.ctf_teams_mark_flag({ flag_id: candidate.flag_ref, verdict: 'verified', note: '实际平台接受输出' });
// 全部目标经平台确认后：mark_challenge_solved({ note: '完整核验依据' })。
```

preflight 支持 `environment_free`、`challenge_unsolved`、`access_ready`、`target_running`、`offline_verified` 及建议文档中的 whoami/get/env 等价别名。平台快照有效期为 60 秒，同题字段必须匹配 challenge_id；取不到字段不视为通过。只读适配器只请求 whoami/get/environment，未知平台返回结构需要后续适配，绝不编造事实。

成员修复使用 `ctf_teams_update_member({member_name,provider,model,reason})`；换空闲执行者使用 `ctf_teams_reassign_task({task_id,assignee:'auto',reason})`。`remaining_items` 可通过 create_task/update_task 保存；检查点仅用于续做，不作为新尝试的完成证据。同成员同错误码首次通知后只累计次数，明确修复路由会清除故障账本。

图片调用 `ctf_teams_image_to_text({image:'附件.png',action:'ascii'|'ocr'|'decode'|'compare',compare:'另一张.png'})`。ASCII/compare 需要 Pillow；OCR 还需 pytesseract/Tesseract，QR 可用 OpenCV，条码需要 pyzbar/ZBar。配置 `env.pythonBin` 可指定 Python；工具不会隐式安装依赖。限制单张 2500 万像素、输出和运行时间；文件按真实路径检查，不能越出解题工作区。

## 可选代理托管

默认不启动代理。需要托管时在插件配置中加入：

```yaml
ctf2:
  proxyUrl: http://127.0.0.1:39528/mcp
  manageProxy: true
  credentialDir: E:/DSH/CTF2/.ctf2-agent # 替换为实际 OAuth 私有目录
  timeoutMs: 10000
  restartDelayMs: 3000
  maxRestarts: 3
```

凭据目录必须是绝对路径；凭据不复制进包，不出现在状态工具中。已有正常代理只使用，不接管。宿主关闭只停止自己创建的进程，战队删除不影响代理。宿主管理进程退出最多重启三次，重启预算耗尽后检查日志和 OAuth；不能保证绕过机器权限、端口占用或外部强杀。

手工启动可用 `node scripts/ctf2-mcp-proxy.mjs`；改进后的 CLI 随包提供为 `scripts/ctf2-cli.mjs`。用户原有 `E:\DSH\CTF2\ctf2-cli.mjs` 本轮未覆盖，使用新诊断需切换到仓库/安装包内版本。

## 验收范围

验证结论和路径见 [validation.json](validation.json)。覆盖完整离线验证链、生命周期/旧代写入权限、100 次故障风暴、503 一次恢复、23 题计数、嵌套变体、独占资源/预检、本地代理、真实 DSH 0.2.0-rc.2（278 个同版本分包）以及打包后真实入口。真实宿主使用确定性模型和平台判定样本；CTF2 平台账号、真实模型服务、真实配额及实际靶机未参与本次验收。旧宿主版本未新增实机兼容性结论，也未发布 npm。

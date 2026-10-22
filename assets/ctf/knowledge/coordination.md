# CTF 协作与平台核验

先核对任务所有权、证据和资源约束，再选择并行方式。

## 先查台账，再做下一项实验

同一题多成员或跨会话续做时，先用 `ctf_teams_hypothesis({action:"list",challenge_id:"平台真实题目 ID"})` 查已尝试的假设。离线题目使用稳定的附件标识；不要把不同题目混用同一个 ID。摘要有截断标记，使用 `hypothesis_id` 分页读取完整实验历史，不能仅凭最新结果推定整条路线已排除。

1. `propose` 填写 `challenge_id`、`statement` 和 `prediction`。预测应具体到能被观察或反驳的条件；相同题目、假设和预测精确去重，不做语义去重。
2. 实际运行实验后，`record_test` 带返回的 `ledger_ref`、`hypothesis_id`、`expected_revision`，以及稳定的 `test_key`、真实 `method`、`observation`、`outcome` 和 `basis`。修改测试内容或纠正输入时使用新 key，保留旧记录；版本冲突先重读并协调。
3. `outcome` 是报告的 `supports/refutes/inconclusive`，不是平台裁决。`basis=construction` 表示构造或反例，`measurement` 表示计时、性能等测量，`observation` 表示其他观察。测量型反驳必须给出 `next_step`，继续检查噪声、环境、输入或构造反例；不能靠一次测量封死路线。
4. 可选 `evidence_files` 绑定工作区相对文件，每次最多 8 个、每个最多 32 MiB。记录 SHA-256、大小和时间，不执行 method。查询单条假设时 `check_files:true` 检查**最新实验**的文件是否相同、变更、缺失或不可读；旧实验的快照保留在分页历史中。
5. 文件哈希只证明字节一致，报告的原始输出仍可能不实。重要推导需队长独立复现，并在 `verify_finding` 中记录实际检查；平台接受 flag 也不能反推整篇推导正确。大输出和完整脚本保存为文件，不在台账中编造或裁剪成成功故事。

新增假设或实验各产生一次未复核 finding，供原有同步流程读取。查询和重复写入不产生进度、不确认未读看板，也不唤醒成员；暂停后可以补记，不会自动恢复战队。归档摘要保留假设、预测、所有实验及文件快照，不自动删除失败路线。

## Windows shell 与工具探测

Windows 上用 `pwsh` 执行 PowerShell；组合了 dsh-ops 且其 Bash 运行时可用时，用独立的 `ops_bash` 执行 POSIX 命令。不要只去掉预设的 Windows 禁用条件：宿主的 `tool-bash` 与 `tool-pwsh` 共享 `ctx.shell`，直接同时启用可能把 Bash 文本交给 PowerShell。WSL 命令可通过 `pwsh` 显式调用 `wsl.exe -d <实际发行版> --exec /bin/bash ...`，先验证实际启动成功及目标工具存在。

`ctf_teams_env` 默认检查宿主本地。Windows 另用 `{runtime:"wsl"}` 列出发行版，再传 `{runtime:"wsl",distribution:"kali-linux",tools:["python3","sage"]}` 检查明确的 Linux 环境。结果包含解释器和实际搜索 PATH，超时/探针故障为 unknown，不算缺失；自定义虚拟环境仍需另验。分别验证 Windows、Git Bash、WSL；发行版存在也不代表每个工具存在。`Get-Acl` / 模块加载等 workspace preparation 错误发生在用户命令之前，换 workdir、重复重试或切换权限模式不能修复。保留第一条完整错误与实际解释器路径，先修执行环境，再启动代理或批量解题。

## 批量刷题首轮清单

1. 显式 `create({name:"...",challenge_mode:"batch"})`，与 `mode:solo/squad` 独立。旧入口 `set_challenge({multi_challenge:true,expected_challenges:N})` 继续有效；仅在任务标题写“批量”不会切换模式。
2. 根据平台配额、附件和服务需求安排 `resource_key`；不要把题型当成环境需求的证明。
3. 怀疑未解列表漏题时，由一个协调者运行 `node scripts/ctf2-cli.mjs scan-unsolved practice_ground_id=... category=MISC limit=50 max_pages=100 --output unsolved.json`。它关闭服务端未解过滤，从第一页分页、去重，再按明确的 `is_solved=false` 筛选。向成员提供输出路径，避免每条 lane 重扫全库。
4. 重复页、矛盾或未知状态、不完整分页会给出 `complete:false`、警告和退出码 2。不要以此时的空列表认定刷完；扫描不是原子实时快照，开工前再核对题目状态。工具不执行平台写操作。
5. 批量候选必须带真实 `challenge_id`，外部来源附 `source_kind` / `source_url`。核对赛事、年份、附件和身份，不凭同名标题猜 UUID；域名和少量判定样本不是可靠性评分。
6. 单题接受后继续其他 lane，整批完成才显式 `mark_challenge_solved`。不要要求成员忽略 solved 横幅：先核对版本与模式，再修正配置。

队长接管仅覆盖当前轮次。进入 idle 等非运行状态时，未完成任务会撤销旧尝试并回到成员池，检查点保留；队长邮箱留下 task id、旧 attempt 和原因。之后先查实际所有者，再操作外部环境。通知不额外唤醒队长，也没有新增永久持有任务的语义。

## 模型路由失效时

如果互不相关的工具（含 `get_goal`、状态、文件、shell）统一返回 `cannot get required service "sessionProjections" in inactive context`，先按宿主服务生命周期故障处理：停止重复工具试探和派发，保留检查点、原始回执、未落板候选及实际成功/失败边界，通知用户从宿主侧恢复。失败的 `mark_flag` 不等于判定已保存，界面显示“已完成”也不等于工具成功。不要重建团队、删除文件、虚报写入，或通过调整 shell 参数和权限去修复这个服务错误。刷新 GUI 不能保证重建后端上下文；通常需要保存工作后完整退出并重开宿主。根因需结合实际日志调查，不根据“恰好切过模型”断言因果。

CTF 平台 `whoami` 检查比赛账号，不能证明 LLM API Key 有效。核对 `status` 的实际 provider/model；裸 401 / `invalid_api_key` 会暂停成员并保留任务和检查点，不自动切换到可能增加费用的路由。

使用 `update_member({member_name,provider,model,reason})` 显式修复路由，撤销旧尝试、排空旧会话并保持成员名、看板和任务身份，无需删除重建。已有显式 fallback 保留原规则。省略成员 `model` 时，全局 `memberModel` 仍可能生效，不能当成绕过默认配置的方法。一次 Key 故障也不能证明某个模型供应商更不稳定。

`status.members[].route_diagnostics` 区分保存路由、在线请求配置和队长配置。队长换模型不会自动更新已创建成员；差异可能来自有意分工，应按用户意图显式 `update_member`，halted 时也可以先修复再恢复。在线信息缺失不等于队员已经使用保存路由，未知时不要编造实际调用模型。

同一候选的新来源会追加记录并参与同步，保留提交者与证据；来源仍是未经复核的陈述。拒绝历史属于候选，不自动封禁整个网站。字形歧义可用 `text_candidates` 显式生成有上限的候选（含 `2/Z`），不自动试投，也不假设比赛没有错误提交惩罚。

## 建队与执行边界

- 默认 `ctf-teams` 使用 `taskPlanning: captain`：先有阵容、零任务是等待规划，不是故障。通过 `create({plan:{members,tasks}})` 一次提交最小可用依赖图；每项任务需要 `id`、`subject`。不要凭空补固定六阶段模板。
- 单步附件题可用 `mode: solo`，直接分析并登记发现、候选和实际判定。批量解题要设置 `multi_challenge`，每道题保留 `challenge_id`。
- `create_task` 的 `assignee` 是成员名；队长接管已有未完成任务使用 `reassign_task({task_id,assignee:"captain",reason})`，一次只接管一项。`claim_task` 属于成员，不是队长抢共享任务的捷径。
- 不指定 assignee 创建任务会进入共享池，调度器可能立即派发。它不是惰性暂存区。先查看创建结果的 `status`、`attempt_id`、`dispatch_state`，再按需重派。
- 接管返回 `takeover_context`：任务约定、检查点、剩余事项、依赖产物、新看板进展和队长自己的未读消息。检查点不是完成证据。已完成任务应补充证据，不要为改备注重新执行。
- 持久成员身份取决于本战队登记的成员会话和当前任务尝试。内部可以使用宿主的 continuable child provider；另行启动普通子代理不会自动注册成成员。成员完成要走共享任务状态和证据流程。

## 同步与文件协作

- `ctf_teams_sync` 同时读取共享看板增量与调用者自己的未读私信。`inbox_limit` 为 1..50，默认 10；只确认本次返回的消息，超出部分下次继续读，旧尝试消息会被过滤。
- `has_updates` 仅代表看板变化；私信另看 `inbox`、`inbox_remaining`。消息来源与任务尝试会保留，但私信没有自动变成已复核事实。
- 有效结果、失败路线和纠正用 `report_finding` 入看板；`send_message` 用于提醒、求助与协调。队长通过独立检查后用 `verify_finding` 记录判定。
- 优先用共享任务看板表达 TODO 的归属和状态。确需 Markdown 文件时，指定单一写入者，或每名成员写独立文件后合并。先扫描末尾行号再追加仍存在并发竞争，不等于原子更新。

## 单环境平台与配额

- 环境限制约束资源，不规定 Web 必须由队长做。需要同一环境槽的任务共用 `resource_key`，在一个战队内串行执行；其他战队和外部会话不受这个本地锁控制。
- 题型不等于资源需求：Web 可以静态审计，Misc/Reverse 也可能需要远程交互。根据附件、服务与提交前提安排依赖图；确认可离线完成后再释放靶机。
- `platform_check` 只刷新允许的只读事实。实际启停、延时和提交由平台工具执行，任务完成不会替你释放平台槽。
- 有效队员也可 `platform_check` 刷新准入；阻塞原因标出缺失的 preflight key。设错条件时请队长用 `edit_plan.update_task` 原地修正 pending、attempt 0 的任务：`preflight` 完整替换，`[]` 清空，省略保留；`preflight_finding_id:""` 清引用。不得把未执行任务伪报成失败以绕过闸门。
- 多个不同 MCP 工具没有通用的批处理封装。先查实时 `tools` / `schema`，避免无必要的重复查询；不要把不相关请求拼成不存在的工具。

## 接受结果与战绩

- 保留 flag 原始字节、大小写和包装。格式规则是提示，不是平台真相；确有依据的变体另存为候选，按平台结果判定。
- 平台返回明确接受或题目 `is_solved=true` 是该题完成的依据。重复提交已解题可能被接受但不新增分数；账户总解题数、分数可能有延迟，也可能来自其他会话。需要排查歧义时再读 `get` / `whoami`，不为每次提交强加多次请求。
- CLI 是平台桥接，不知道当前战队身份，不会自动修改本地看板。实际接受后，在对应 `challenge_id` 下登记 `submit_flag`，再由队长 `mark_flag` 保存原始回执依据；批量完成后显式 `mark_challenge_solved`。
- 历史账户总数不能直接充当本战队完成数。导入旧成绩需要逐题关联和真实回执；没有这些证据时，保留外部成绩单，不伪造看板成功。
- 本仓库 CLI 要连同 `lib/ctf2-protocol.js` 使用。工作目录中的旧独立 CLI 不会随插件更新；从新版插件目录运行 `node scripts/ctf2-cli.mjs ...`，修改源码后先构建。
- CLI 退出码：0 为有效响应，1 为传输/RPC/平台明确错误，2 为未知工具/空结果/协议或筛选形状错误。HTTP 200、`isError:false`、`null` 不构成成功；写操作遇到响应异常时先查平台状态，避免盲目重试。
- `RATE_LIMITED` 等已知业务错误会在代理标为 `isError:true`，CLI 非零退出且不打印成功数据，保留 `retry_after_ms` 等提示。不自动重试写操作；读取成功并校验退出码后才替换缓存，直接 `> cache.json` 可能先截断旧文件。旧复制脚本不随插件更新，不可忽略其退出码或把错误对象当“无附件”。

读取平台 JSON 时优先使用 CLI 的 `--output <路径>` 原子 UTF-8 缓存，检查退出码。限流或分页不完整会保留旧文件；不要再用 `> cache.json` 提前截断它。每条 lane 使用独立输出文件，原子替换不等于自动合并。

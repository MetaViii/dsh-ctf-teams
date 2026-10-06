<p align="right">
  <a href="./README.md">English</a> · <strong>简体中文</strong>
</p>

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="dsh-ctf-teams 把一个 DeepSeek Harness 会话变成多智能体 CTF 战队">
</p>

# dsh-ctf-teams

**CTFTeams** —— DeepSeek Harness 的多智能体 CTF 插件，fork 自 [dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams) 并为 CTF 重新打造。一个会话成为**队长**，派出四名**全能型 CTF 专家**（web / pwn / reverse / crypto / forensics / misc，每个 agent 全域覆盖），从不同角度**并行攻打同一道题**，**每轮同步进展**，共享 flag 候选看板，战况通过**终端 dashboard** 直接呈现。

## 为什么

真实的 CTF 解题本来就是多条战线同时推进。CTFTeams 完整保留了 agent-teams 的底座（可续聊的持久化成员、带依赖的任务 DAG、邮箱消息、两阶段计划审批、质量门），再加上 CTF 真正需要的东西：

- **可选中的 agent 模式**——插件同时声明了 `ctf-teams` 这个 Harness **agent 预设**（显示名「CTF 团队模式」），于是战队成为一个可在应用里直接选中的模式（会话模式选择器 / 设置 → 通用里的默认预设），而不用靠记工具名。该模式组合出完整的 agent 平面（shell、文件系统、技能、委派、计划模式、上下文压缩）并叠加 CTF 队长人格；`ctf_teams_*` 工具来自 profile 级的宿主行，在任何模式下都可调用。
- **ctf-teams 团队模板**——内置零配置团队模板：`/ctf-teams <题目>` 一键派出四名全能专家攻打题目，队长现场规划攻击图。
- **轮次同步协议**——每一条有价值的中间结论都发到共享 findings 看板；成员一次调用即可拉取自己没看过的增量，调度器把最新进展附在每个任务派发里，还会主动推送给空闲成员。没有新进展的一轮零开销。
- **证据门控的 flag 流程**——候选 flag 必须带可复现证据提交，按题目 flag 格式校验、自动去重；只有队长能录入平台判定结果。一旦 verified，全队切换到 writeup 模式。
- **内置知识库**——kali 工具箱、pwntools、SageMath、Volatility 3、分领域作战手册（web / pwn / reverse / crypto / forensics / misc），以及全新 PoC/CVE 的狩猎流程，会话内用 `ctf_teams_knowledge` 直接阅读。
- **工具链服务**——`ctf_teams_env` 先检测本机：pwntools、volatility3、sage、gdb、nmap、hashcat、tshark、exiftool 等约 40 个托管工具的状态与版本；缺失的按预置 apt/pip/brew/gem 映射直接安装（逐参数执行、不走 shell）。重型工具（sage、ghidra、pwndbg）只报告手动安装命令，不擅自执行。
- **引用库预置**——小型 PoC/技能库（ctf-skills、Awesome-POC）在**建队时自动克隆**；其余（exphub、0xMarcio pocindex/cve、trickest/cve、PoC-in-GitHub、cvelistV5）用 `ctf_teams_references` 按需同步到 `<workspace>/.ctf-teams/references/`，并给每个 agent 返回绝对路径和 `rg` 检索提示——N-day 狩猎先查本地、再上网。
- **实时 dashboard 页签，而且能操作**——应用里「对话 / 轨迹」旁边多一个**「解题面板」**页签：题目头信息、任务进度条、成员泳道（实时活动、`⚡` 未同步看板动态、未读邮件、当前任务）、findings 流、flag 看板，以及宿主算好的 `Next` 下一步提示，每 1.5 秒从一条带信任围栏的路由刷新。面板上的按钮能直接推动解题——开始解题（题目表单）、批准并运行、推进一轮、暂停/继续、核对 flag、附件（工作区文件选择器）、写 WRITEUP、导出 WP / 导出复盘——每次点击只投入**一条你自己的消息**，队伍状态的唯一写者仍然是对长 agent。
- **终端 dashboard**——同一份战况的文本版，给没有页签的界面用：`ctf_teams_status`（模型 + 人类）和 `/ctf-teams-board`（仅人类，不唤醒模型）。

## 快速开始

**DeepSeek Harness 桌面版（主要安装目标）：** 在应用侧栏打开「插件 → 添加插件」，输入 npm 包名和版本（`@nanmicoder/dsh-ctf-teams`），安装完成后点击「立即启用」，宿主提示需要重启时重启桌面应用。桌面端自带 Harness 内核与包管理器，自行管理 profile。

**CLI / Web：**

```bash
dsh plugin --profile <name> add @nanmicoder/dsh-ctf-teams
```

（`<name>` 换成实际使用的 CLI profile；安装后重启该 profile 的 Harness 进程。）插件包含两层 patch：宿主层的插件行与 `ctf-teams` agent 预设层，两者都在组合（composition）加载时读取，所以**安装或升级后必须重启宿主 / 桌面应用**，然后选择模式：

- 桌面版：新建会话时选择「CTF 团队模式」（或在「设置 → 通用」里设为默认预设）。刚装完模式列表里没有「CTF 团队模式」是没重启，不是没装上。
- CLI / Web profile：模式同样来自该 profile 的预设名册。

然后在该 profile 的任意会话里：

```
/ctf-teams 解 http://chal.local:8000，附件在 ./dist
/ctf-teams-board          # 直接打印解题看板，不消耗模型轮次
```

或者自然语言："用 CTFTeams 解出这道 pwn。" **不需要你批准**：出厂配置 `autoApprove: true`，队长在同一次回复里记录题目、提交阵容 + 任务图并立刻派发，之后一路处理成员汇报，直到 flag 验证通过、writeup 写完。切到**「解题面板」页签**（就在「对话 / 轨迹」旁边）实时看它推进。想要回旧的两阶段流程，把插件配置里的 `autoApprove` 设为 `false`：计划会停在 staged，Web 计划卡询问批准，点「批准并运行」才开跑。

## 命令

插件占用一个封闭的命令命名空间，所以 `/` 菜单很短，每条命令只有一个含义：

| 命令 | 作用 |
|---|---|
| `/ctf-teams [--profile <名称>] <题目>` | 开始（或继续）解题。不带 `--profile` 时用配置里的默认阵容——内置的 `ctf-teams` 小队。 |
| `/ctf-teams-board` | 把仪表盘直接打印到对话流。不产生模型轮次、不改任何状态。 |
| `/ctf-teams-<名称>` | 为**其他**已配置的团队模板各生成一个别名，例如 `/ctf-teams-web-only <目标>` 显式选用该阵容。 |

有两个别名是**故意不注册**的：**默认**模板自己的别名（那只是把 `/ctf-teams` 换个更长的名字，即 `ctf-teams-ctf-teams`），以及任何与插件既有命令撞名的模板（比如名字叫 `board`）。把 `defaultProfile` 设为 `''` 关掉默认阵容后，它的别名会回来。

## Dashboard 长什么样

同一份状态，两个界面。**「解题面板」页签**（对话 / 轨迹 / 解题面板）是实时版：客户端视图每 1.5 秒轮询 `GET /plugins/dsh-ctf-teams/state`，请求走 harness 的浏览器信任围栏（未认证的请求拿到的是 401，不是数据），渲染出

- 题目头信息——🚩 已解出 / ◌ 进行中、分类、分值、远程目标、附件、flag 格式；
- 任务进度条 + 统计（`3 完成 · 1 进行中 · 1 待办 · …`）；
- 成员泳道：实时活动、`⚡` 未同步的看板动态数、未读邮件、当前任务、`done/total`；
- 最新 findings（带时间）、flag 看板（带判定）、以及**下一步（`Next`）**提示；
- 多队切换与已归档战队的回看。

宿主重启时会保留最后一份快照并显示「重连中」，页面不在前台时暂停轮询。

### 直接在页签上操作

每个按钮只做一件事：**往会话里投入一条「你自己的消息」**。面板本身从不改队伍状态，所以队长协议（staged 批准、flag 判定、附件写入）照旧生效，而且对话流里能看到你到底点了什么：

| 按钮 | 出现条件 | 发出的内容 |
|---|---|---|
| 开始解题 | 还没有战队 | 题目表单（目标、模板、远程、分类、分值、flag 格式）→ `/ctf-teams …` + 这些事实 |
| 批准并运行 | 存在 staged 计划（队长） | `ctf_teams_approve` + 派发就绪任务——只有 `autoApprove: false`，或本次升级前就已 staged 的战队才需要 |
| 推进一轮 | 进行中 | `ctf_teams_status`、派发就绪任务、唤醒落后成员 |
| 暂停 / 继续 | 进行中 / 已暂停（队长） | halt，或带理由 `ctf_teams_resume` |
| 核对 flag fN | 存在候选（队长） | 核对平台 → `ctf_teams_mark_flag` |
| 附件 | 未归档（队长） | 工作区文件选择器 → `ctf_teams_set_challenge` 写入所选路径 |
| 写 WRITEUP | 参与者 | 按 CTF 选手写法产出 `WRITEUP.md`（见下） |
| 导出 WP / 导出复盘 | 始终 | 下载 `WRITEUP.md`，或生成的 markdown 复盘报告 |
| 删除战队 | 队长 | 二次确认对话框（显示文件数与占用大小）→ **移到归档**（「已归档」里仍可回看）或 **彻底删除**（释放磁盘） |
| 清空归档 (N) | 已归档视图（队长） | 一次性永久删除归档目录里的全部战队 |

上面这些按钮都是**往会话里投入一条「你自己的消息」**，所以队长协议（staged 批准、flag 判定、附件写入）照旧生效，对话流里也能看到你点了什么。两个清理按钮是例外：删文件不需要模型轮次，由宿主在队伍锁保护下直接执行——同样有权限门（删除战队要队长会话，清空归档要活跃会话）、同样要点两次，并且会回报**真实释放的字节数**。

成员会话里「只有队长能做」的按钮是**禁用**状态（而不是点了才报错）；已归档战队只读，只留导出与清理。这些端点与读取路径一样走浏览器信任围栏，并且只允许指定方法、限制请求体大小、按磁盘上的真值校验权限。

### writeup 怎么写

`写 WRITEUP` 发送的是 `src/writeup.ts` 里那份 CTF 解题记录规范——和队长协议、完成判定用的是同一份文本：

```
# <题目名> — <分类>
## 题目信息   平台/分类/分值、附件、远程地址
## 侦察      真正跑过的命令与真实输出
## 漏洞分析   漏洞点、成因、触发条件、关键代码片段
## 利用过程   从侦察到 flag 的完整步骤；payload 原始形式 + 编码形式；原始 HTTP 报文
## flag      平台返回的原始响应与 flag 原文
## 参考      公开资料/CVE（没有就删掉）
```

不出现解题工具、agent、模型或平台框架，也没有「修复建议 / 缓解措施」这一节：writeup 记录的是怎么打进去，不是怎么修。内容必须是真实跑过的（不许编造或润色输出），每条命令都要能直接复制，已有内容只做增量更新。

**终端面板**是同一份状态给没有页签的界面用的文本版（`ctf_teams_status` 给模型和人类看，`/ctf-teams-board` 只给人类看且不产生模型轮次）。每段标题栏都带自己的实时计数，最后一行的 `Next` 与页签由同一个函数算出，所以两边永远不会给出互相矛盾的建议：

```
╭─ CTF TEAMS ── 🚩 SOLVED ────────────────────────────────────────────────────╮
│ Challenge  baby_rsa · crypto · 500pts                                      │
│ Remote     nc chal.local:9999                                              │
│ Files      rsa.pem, out.txt                                                │
│ Flag fmt   /flag\{[^}]+\}/                                                 │
│ Status     running · round 4 · 12m · 3 findings · 1 flag                   │
│ Goal       解出 baby_rsa 并写出可复现的解题链                              │
├─ Agents ─────────────────────────────────────────────────────── 1/4 working┤
│ ○ agent-1     idle ⚡1      full-stack CTF expert                           │
│ ○ agent-2     idle         full-stack CTF expert                           │
│ ● agent-3     working      t3 Write the reproducible solve cha…            │
│ ◇ agent-4     unspawned    full-stack CTF expert                           │
├─ Task board ──────────────────── [████████████░░░░] 3/4 · last beat 30s ago┤
│ t3 ▶       Write the reproducible solve chain to WRITEUP.md → agent-3      │
│ t1 ✓       Recon attachments and fingerprint the challenge → agent-1       │
│ t2 ✓       Attack the RSA parameters (Wiener / Coppersmith) → agent-2      │
│ t4 ✓       Cross-check the flag against the platform → captain             │
│            3 done · 1 active · 0 pending                                   │
├─ Findings (latest) ──────────────────────────────── 3 total · newest 3m ago┤
│ r1 fd1     [agent-1/recon] 两个附件 rsa.pem + out.txt；openssl rsa -pubin… │
│ r2 fd2     [agent-2/crypto] Wiener 命中：e 极大、d 很小；已还原私钥并解出… │
│ r3 fd3     [agent-3/dead-end] 远端无 HTTP 面，纯 nc 交互，排除 web 链路    │
├─ Flags ─────────────────────────────────────────── 1 total · 1 verified    ┤
│ f1 ✓       flag{w13n3r_4tt4ck_ftw} by agent-2 — platform accepted          │
│ Next       ▸ solved — write WRITEUP.md, then archive the team              │
╰─ live · ctf_teams_status for the full detail                               ╯
```

一眼读法：顶栏是结论（🚩 SOLVED / ◌ unsolved）；每段标题栏右侧是这一段的实时计数（几路在跑、任务进度条 + 最近一次看板更新、findings 新鲜度、已验证 flag 数）；成员后的 `⚡N` 表示他还有 N 条看板动态没拉；`Next` 是最值得立刻执行的一步——核对候选 flag、给空闲成员派发就绪任务、恢复被 halt 的队，或者去写 writeup。

## 内置 ctf-teams 战队

四名成员（`agent-1` … `agent-4`），刻意不做方向拆分：每人都是全栈 CTF 专家（web、pwn、reverse、crypto、forensics、misc），共享同一套知识库（kali-tools、pwntools、sage-math、volatility3、web、pwn、reverse、crypto、forensics、misc、cve-poc）。提速来自**并行角度**而不是领域分工：每个 agent 在选定攻击路线前先 sync，公开认领（`ctf_teams_report_finding`），要接手队友的路线必须先发 finding 声明，每轮把所有结果——包括死胡同——发上看板。

任务规划是 `captain` 模式：模板只提供人与守则，任务图由队长根据题目实际情况推导（先侦察，再并行分域，最后收敛到 flag 验证 + writeup）。你在 `profiles.ctf-teams` 里的同名配置会整体覆盖内置模板。

## 工具链与引用库服务

开跑之前，队长（或任意成员）先把机器准备好：

```
ctf_teams_env  { action: "check" }                  # 检测 pwntools / vol3 / sage / kali 工具链 …
ctf_teams_env  { action: "install", dry_run: true } # 先看安装计划
ctf_teams_env  { action: "install" }                # 安装缺失项（apt/pip/brew/gem）
ctf_teams_references { action: "sync", repo: "all" }# 克隆 PoC/CVE/技能库
ctf_teams_references { action: "path", repo: "exphub" }
```

托管目录覆盖约 40 个工具（Python 栈、pwn/逆向、web、密码学、取证、杂项）。`check` 报告版本和安装提示；`install` 直接执行预置 argv 序列（不经 shell），装完自动复检；sage/ghidra/pwndbg 等重型工具只打印手动安装路径。配置 `env.allowInstall: false` 可彻底禁用执行（dry-run 仍可用）。

引用库清单预置了以下仓库——它们保存在 GitHub（有的好几个 GB），所以服务按需浅克隆进 workspace，而不是把 npm 包撑爆：

| 仓库 id | 来源 | 内容 |
|---|---|---|
| `ctf-skills` | [ljagiello/ctf-skills](https://github.com/ljagiello/ctf-skills) | 分 CTF 领域的 agent 作战手册（MIT） |
| `awesome-poc` | [WyAtu/Awesome-POC](https://github.com/WyAtu/Awesome-POC) | 按产品整理的 PoC 索引 |
| `exphub` | [zhzyker/exphub](https://github.com/zhzyker/exphub) | 经典 CVE 可直接运行的 exploit 脚本 |
| `pocindex` | [0xMarcio/pocindex](https://github.com/0xMarcio/pocindex) | 8.2 万+ PoC 索引（按 CVE 检索） |
| `marcio-cve` | [0xMarcio/cve](https://github.com/0xMarcio/cve) | 按年份聚合的 CVE+PoC |
| `trickest-cve` | [trickest/cve](https://github.com/trickest/cve) | 自动聚合的 CVE 数据库（超大） |
| `poc-in-github` | [nomi-sec/PoC-in-GitHub](https://github.com/nomi-sec/PoC-in-GitHub) | 每日更新的 PoC JSON 索引（大） |
| `cvelistv5` | [CVEProject/cvelistV5](https://github.com/CVEProject/cvelistV5) | 官方 CVE JSON v5 档案（超大） |

## 轮次同步协议

1. 成员把每一条有价值的结论用 `ctf_teams_report_finding` 发上看板——死胡同也要发，打上 `dead-end` 标签，帮队友省一整轮。
2. `ctf_teams_sync` 返回该成员没看过的全部增量并推进其游标；空结果意味着"没人有新进展——继续或让出"。
3. 调度器顺路捎带：任务派发自动附上最新 findings，空闲成员若看板有新内容会收到 digest 推送。游标持久化——不重复、不丢失。
4. flag 也是看板：`ctf_teams_submit_flag` 按题目格式校验并去重；队长对平台验证后用 `ctf_teams_mark_flag` 录入判定。`verified` 即标记题目已解出，全员转入 writeup。

## 工具

队长专属：`ctf_teams_create`、`ctf_teams_approve`、`ctf_teams_edit_plan`、`ctf_teams_add_member`、`ctf_teams_remove_member`、`ctf_teams_create_task`、`ctf_teams_reassign_task`、`ctf_teams_amend_task`、`ctf_teams_set_challenge`、`ctf_teams_mark_flag`、`ctf_teams_resume`、`ctf_teams_delete`

成员共用：`ctf_teams_claim_task`、`ctf_teams_update_task`、`ctf_teams_send_message`、`ctf_teams_status`、`ctf_teams_submit_flag`、`ctf_teams_report_finding`、`ctf_teams_sync`、`ctf_teams_knowledge`、`ctf_teams_env`、`ctf_teams_references`

## 配置

```yaml
# cordis.patch.yml / profile 配置
stateDir: .ctf-teams          # 团队状态根目录（位于会话 workspace 下）
memberProvider: spawn         # 'spawn' 或 'fork'
maxMembers: 8
defaultProfile: ctf-teams     # create 未指定 profile/plan 时生效（空串关闭）
slashCommand: true            # /ctf-teams 命令 + 手势边界
boardCommand: true            # /ctf-teams-board 看板命令
autoApprove: true             # 建队即开跑：不需要人工点批准（false = 两阶段计划审批）
profiles: {}                  # 自定义 profiles；同名覆盖内置模板
env:
  allowInstall: true          # false 时 ctf_teams_env 安装仅支持 dry-run
  probeTimeoutMs: 10000
  installTimeoutMs: 300000
  # pythonBin: /usr/bin/python3
references:
  autoSync: small             # 建队时自动克隆小型库（'off'|'small'|'all'；随附 patch 配置默认开启，库层默认关闭）
  depth: 1                    # 引用仓库浅克隆深度
  dirName: references         # 位于 <stateDir> 下：.ctf-teams/references
  timeoutMs: 600000
```

## agent 预设模式

本插件按 `dsh.bundle.patch` 的顺序应用两层 patch：

| 层 | 文件 | 贡献内容 |
|---|---|---|
| 1 | `cordis.patch.yml` | 宿主层的 `@nanmicoder/dsh-ctf-teams` 插件行：`ctf_teams_*` 工具、`/ctf-teams`、`/ctf-teams-board`、队长使用说明段落——对该 profile 的每个会话生效。 |
| 2 | `presets/ctf-teams.patch.yml` | `ctf-teams` **agent 预设**（`@deepseek-ai/dsh-agent-preset`，显示名「CTF 团队模式」，order 3）：该模式的人格、shell、文件系统、技能、委派、计划模式与上下文压缩。 |

想调整模式就改第 2 层：`plugins` 列表里的每一行都属于该 agent 的平面——去掉 `tool-web` 就只让这个模式失去联网搜索，启用 `tool-subagent-codex` 就只给这个模式多加一个委派 provider。预设行与官方预设一样从 Harness 安装目录和 profile 解析，**重启宿主后新建的会话**才能看到改动。

第 2 层需要带 agent preset 注册表的 Harness（**0.2.0-rc.2 及以上**，该代预设是组合里的声明行）。更老的宿主上这一行无法解析，只是模式不出现，第 1 层照常工作——如果希望在那里显式挂载工具，可把 `- insert: [{ id: ctf-teams, name: '@nanmicoder/dsh-ctf-teams' }]` 加到该 profile 的 `cordis.patch.yml`。

## 开发

```bash
pnpm install
pnpm build          # tsc -> lib/ + git-artifact 戳记
pnpm typecheck
pnpm verify         # 完整离线验证链，含 ctf-verify / lifecycle / 质量门
```

## 致谢

Fork 自程序员阿江 (Relakkes) 的 [dsh-agent-teams](https://github.com/NanmiCoder/dsh-agent-teams)——感谢优秀的多智能体底座。CTF 特化的轮次同步、flag 看板、知识库与终端 dashboard 是本 fork 的增量。基于 MIT 协议开源。

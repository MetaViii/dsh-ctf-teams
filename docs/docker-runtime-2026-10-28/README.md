# Docker 默认解题运行时 · 0.1.36

本轮将“协调成员与检测本机工具”补齐为统一的解题执行入口。默认使用 Docker，原生／WSL 作为显式高级选项。构建从 2026-10-28 开始，最终交付与证据另见 [validation.json](./validation.json)。不升级 DSH Desktop，不恢复既有暂停战队。

## 使用方式

需要运行中的 Docker Engine（Linux 容器）。本轮完整镜像面向 `linux/amd64`，本机镜像约 8 GB；首次构建还需要网络、构建缓存空间和较长等待。插件包包含配方与运行器，不内嵌镜像层，不发布公共镜像。

```js
await tools.ctf_teams_runtime({ action: 'prepare' });
await tools.ctf_teams_runtime({ action: 'import', source: 'dist/challenge.zip' });
await tools.ctf_teams_exec({ command: 'file input/dist/challenge.zip' });
```

先建队再准备运行时；`prepare` 缺少默认镜像时按随包 Dockerfile 构建。可在模型回合外预先运行包内 `node scripts/runtime-setup.mjs build`；`check` 只查看镜像，不启动战队。首次构建失败会保留 Docker 缓存，修复网络／磁盘后重试。自定义镜像缺失不会擅自替换或构建。

`status` 只读，不构建、不启动暂停容器。`ctf_teams_env(check)` 默认检查真实解题容器；`runtime: local/wsl` 用于显式诊断，不改变默认后端。宿主没有 Python 或 PATH 不完整，不再直接等同于解题环境缺工具。默认模式隐藏并阻止 CTF 会话使用已知的宿主 shell 工具；其他会话照常使用。

### 文件、作业与暂停

| 路径／状态 | 行为 |
| --- | --- |
| `<workspace>/.ctf-teams-work/<identity>/` | 仅此子目录挂到容器 `/work`，脚本、附件副本和结果持久保存在本机。普通文件工具可在返回的 `host_workdir` 写脚本。 |
| `<workspace>/.ctf-teams-runtime/<identity>/` | 宿主作业台账、命令状态、完整输出日志；不挂进解题容器。 |
| `runtime(import)` | 显式导入工作区附件，拒绝目录逃逸、链接／junction、已知私有状态与凭据目录；不覆盖现有文件，原附件保留。 |
| `exec(wait_ms: 0)` | 返回作业 ID，使用 `runtime(job)` 读取或 `runtime(cancel)` 取消；没有后台定时唤醒模型。 |
| `timeout_ms` | 命令截止时间；`wait_ms` 只控制本次前台等待。默认分别 300000 / 1000 毫秒。 |
| 输出 | 返回末尾 16 KB；完成／暂停时导出完整 stdout/stderr，本地台账不反复嵌入大段输出。 |
| 面板暂停 | 先保存 halted 和检查点，再停止整队容器与成员；导出日志，未完成作业标为 interrupted。停止失败明确返回，不能冒充成功。 |
| 明确继续 | 同队重新使用持久化目录，不重放旧命令；后台监听等服务由模型检查后显式重启。 |
| 队员重派／修复／移除 | 撤销旧任务能力并取消其受管作业；成员命令必须带当前 task_id / attempt_id。 |
| 归档／插件正常退出 | 停止已登记的本插件容器，保留文件、台账和容器，不自动删除成果。 |

队伍身份包含工作区、队长、队伍及看板代际，防止另一个会话或重建队伍复用旧运行时。持久保存容器 ID、镜像 ID 与启动时间；发现外部重启将旧作业标为中断，不重放。命令经 stdin 传入，避免 Windows 长命令行限制；Bash 字面量有专用引用规则。

命令以非 root 身份执行，根目录中的监督器保存受保护作业记录；无 privileged、Docker socket 或整个宿主工作区挂载。容器限制默认内存 2048 MiB、2 CPU、1024 PID。工具仍受正常 DSH 工具审批与有效 sandboxPolicy 控制：read-only 或权限服务异常时拒绝执行，不自动升权。

本机普通 `/work` 文件有持久性；容器内其他路径的手动变更不属于成果备份。需要额外 Python 包时可在 `/work` 中建 venv；不要覆盖共享系统工具环境。后台服务应作为受管后台作业运行前台服务命令。单作业清理覆盖其进程组；主动脱离进程组的守护进程仍由整队容器停止边界收尾，不能把它当作单作业隔离沙箱。

### CTF2 与原生高级选项

队长使用 `ctf_teams_ctf2` 的 connect、whoami、grounds、challenges、get、attachment、environment、start、extend、stop、submit。它通过既有 loopback 代理执行固定平台方法。connect 仅使用宿主既有 OAuth 文件启动随包代理，不自动登录，不把 token 挂入容器。附件入口返回下载 URL，可在容器用 curl/requests 获取；没有新增通用附件授权／下载包装器。

平台变更要求活动战队和有效可写权限；队员不能调用此入口。提交保留候选原文、返回平台错误，不自动重试、不自动标记 verified。平台靶机生命周期与本地解题容器分别管理；暂停本地战队不擅自销毁远程靶机。

profile 插件配置示例：

```yaml
- id: ctf-teams
  config:
    execution:
      backend: docker
      image: dsh-ctf-tools:0.1.36
      autoBuild: true
      memoryMb: 2048
      cpus: 2
```

需要 Windows 程序、本机 GPU 或既有 Kali 环境时，显式改 `execution.backend: native` 并重启对应宿主。原生工具、权限、模型路由、既有插件保留；本轮不卸载本机工具。原生执行沿用宿主语义，不承诺 Docker 的进程监督、隔离与整容器暂停。

## 工具箱与选型

| 用途 | 随镜像提供的主要工具 |
| --- | --- |
| 通用脚本 | Bash、Python 3.11、Node 24、npm、PHP、Ruby、JDK 17、Mono、gcc/multilib、make/cmake、git、jq、rg、SQLite |
| 密码 | SageMath 9.5、Z3、SymPy、gmpy2、fpylll、PyCryptodome/Cryptodomex、cryptography |
| Pwn／Reverse | pwntools、gdb/gdb-multiarch、binutils、patchelf、strace/ltrace、qemu-user、angr、Capstone、Unicorn、LIEF、pyelftools、pefile、ROPgadget、ropper、one_gadget、seccomp-tools、UPX、JADX、apktool |
| Web／网络 | requests/httpx/aiohttp、nmap、sqlmap、ffuf、gobuster、Nuclei、Nikto、Hydra、john、hashcat、socat、netcat、OpenSSH、DNS 工具 |
| 取证／杂项 | Volatility 3、YARA、Scapy、dpkt、tshark/tcpdump、7z、unrar-free、binwalk、foremost、ExifTool、steghide、SleuthKit、pngcheck、zsteg |
| 图像／媒体 | Pillow、NumPy/SciPy、OpenCV、pytesseract/Tesseract、zbar/pyzbar、qrcode、ffmpeg、sox；同一镜像运行插件图片助手 |

审阅了 [Muteki](https://github.com/FishCodeTech/muteki/tree/e58f1b47a23b8a18128e382761afb7a3bae7fbdc) 对本机／容器后端和完整／精简镜像的划分；独立实现运行时，未复制其 AGPL 源码。没有直接塞入完整 Kali，也不把 WebUI 视为解题能力来源。

只读统计私有历史工作区 4582 个文件、约 34.6 MB，跳过 6 个大文件；按工具族统计提及，指导补齐 Sage、Android 反编译、脱壳、媒体和二进制依赖。统计不是成功使用次数，不代表重新验证几百道题；不公开历史附件、会话、真实 flag 或凭据。

基础镜像和 Node 固定 digest；UPX/JADX/Nuclei 下载校验 SHA-256；Nikto 固定 commit；pip 工具依赖固定版本。修复了 bitstring 5 移除 ConstBitStream 对 angr/ropper 的破坏，锁到兼容版本，依据 [bitstring 官方迁移说明](https://bitstring.readthedocs.io/en/stable/upgrading_to_version_5.html)。补齐 Nikto 的 Perl 模块。Linux 包仍来自 Debian 仓库，Ruby 依赖随构建解析；不是逐位可重现构建。验收以最终镜像 ID、版本清单和实际功能探针为准。

## 验证与交付记录

自动化范围包括真实容器中合成附件与结果的字节往返、完整大输出日志、非零退出码、超时、错误目录、成员所有权、暂停停止后台写入、明确续做不重放、外部重启识别、撤销作业、Windows 长命令与带逗号目录。工具箱执行导入／启动与 AES、Z3、格、Sage、编译、gdb、angr、Unicorn、pcap、YARA、Volatility、QR/OCR 等实际计算。工具启动失败不算“已安装即可用”。

真实 DSH Loader/工具桥接使用确定性模型边界，执行真实 Docker 命令，检查 full/workspace-write/read-only、暂停、冷恢复，以及显式 native 的真实 shell 写入。最终测试、产物哈希和本机备份安装结果记录在 [validation.json](./validation.json)；这些检查不能冒充真实模型刷题成绩。

## 尚未覆盖的环境

- 不提供所有题目的目标服务、指定 libc／内核／体系结构；按题目单独准备靶机或定制镜像。
- 未内置 Ghidra、radare2、pwndbg、Frida、大型字典集；GUI、Windows 动态分析、内核利用、硬件和 GPU 需要高级环境。hashcat 命令可启动不等于 GPU 可用。
- Linux AMD64 本机验收不代表 ARM64 或全部宿主操作系统验收；Docker 网络不能用容器内的 127.0.0.1 访问宿主代理，需明确可达地址。
- 没有全局 provider 令牌桶、跨战队平台租约、自动提交对账或全自动平台登录；没有后台模型轮询／无限自动恢复。
- 未对真实模型在线解题收益、平台写操作、GUI 手动交互和断电恢复作保证。正常退出能收尾；强杀整个宿主后的容器由 Docker 与下一次显式检查管理。

# 第三轮 CTF2 改进记录

对原始建议第 9、10 节独立评审，已逐条回写原始 Markdown，保留刷题观察并注明维护结论。

## 已完成

| 建议 | 改进 |
| --- | --- |
| 9.2、9.3 | 修复 CLI 丢弃后续参数；校验请求 id、JSON/SSE、工具错误和 null，错误非零退出。显式 unsolved_only 只保留实际未解条目，未知状态提示剔除，服务器总数不改写。 |
| 10.3 | 零任务队长规划模式显示 planning，solo 显示 running；不放宽交付门槛。 |
| 10.5、10.9 | sync 返回本人未读私信，默认 10 组、上限 50；确认已返回消息并过滤旧尝试。队长接管直接返回约定、检查点、剩余事项、依赖输出、看板增量和本人未读消息。 |
| 9.5 | 新增 text_candidates，有限枚举易混字符、保留原文、最多 128 项并提示截断；支持 Base64 原始 hex/转义 ASCII 预览，不自动提交或判定。 |
| 9.1 | 增加 Crypto、Cryptodome、cryptography 的导入与基础 AES 运算探针、broken 状态及安装后复测。仅采纳诊断，不全局切换后端；旧 Cryptodome 环境只独立探测，不自动安装。 |
| 10.1、10.4、10.8 | 明确队长通过 reassign_task 接管，一次一项；默认 profile 由队长规划，普通临时子代理不会自动注册为成员。 |

## 调整、未采纳与未实现

9.4：补充 solo 逐题记账，但未实现历史回执导入。账户总数、任意 TODO 无法证明当前战队的成绩。9.6：补充规范 DOC piece table 诊断路线，未实现或验收通用 DOC 解析器。9.8：采用逐步加深 radare2 分析，不固定要求最深分析。

9.7、9.9：保留原始 flag 包装和大小写，按明确接受回执或逐题状态判断；不强制统一包装，也不要求每次账户总分上涨。10.2、10.10：配额约束资源而非执行者，成员可以按 resource_key 排队，不凭题型断言是否离线。10.6：扫描末行再追加仍有竞争，采用任务板、单写入者或独立文件后合并。10.7：没有已验证的多工具 endpoint，不实现虚构的通用 MCP 批处理。

尚未实现历史回执导入、通用 DOC 解析器、通用 MCP 批处理、跨战队资源租约和外部平台写操作的强制顺序约束。OCR/ZBar 依赖适配及三种密码后端的本机完整兼容性未另行验收，基础 AES 探针不证明所有算法可用。

## 使用与验证

新版 CLI 需要同包 lib/ctf2-protocol.js；旧目录中复制的独立脚本不会随插件更新。示例：`node scripts/ctf2-cli.mjs next category=CRYPTO unsolved_only=true limit=10`。退出码 0 代表有效响应，1 为传输/RPC/工具错误，2 为协议、空结果或筛选异常；响应有效不表示该题通过，写操作响应异常应先查状态，不自动重试。

`sync.inbox` 和 `inbox_remaining` 表示私信，`has_updates` 仅表示看板增量。私信不自动变成 finding，重要结论仍需 report_finding 与独立复核。详细规则见[协作知识库](../../assets/ctf/knowledge/coordination.md)。

运行 `pnpm build`、`pnpm verify`、`pnpm verify:ctf:harness --all-scenarios`；打包验收用 `node scripts/ctf2-harness-smoke.mjs --artifact package.tgz --all-scenarios`。结果与指纹见 [validation.json](./validation.json)。目标宿主为 0.2.0-rc.2，核验 278 包闭包；模型回答和平台回执使用固定样本，不代表线上重新刷题或真实账号配额恢复。

判断参考：[PyCryptodome 变更记录](https://www.pycryptodome.org/src/changelog)（截至 2026-10-15，pycryptodomex 留在 3.x 重要安全修补分支），[radare2 分析指南](https://book.rada.re/analysis/code_analysis.html)，[微软 DOC 文本提取规范](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/01d5d8c4-cf9c-4ef9-80fd-439e763cfe01)。

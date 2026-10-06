/**
 * The writeup contract every lane shares.
 *
 * A CTF writeup is a solving record a teammate — or a reader months later —
 * can replay: what the box showed, what the bug was, what was sent, what came
 * back. It is written the way a player writes one, so it carries no trace of
 * how the solve was organized: nothing about the agent, the model, the harness,
 * the team internals, and no remediation advice (a CTF writeup documents an
 * exploit, it does not file a bug report).
 *
 * The text here is the single source for the protocol section, the panel's
 * 写 WRITEUP action and the per-lane guidance, so all three agree.
 * @module dsh-ctf-teams/writeup
 */

/** Where the deliverable lands, relative to the workspace. */
export const WRITEUP_PATH = 'WRITEUP.md'

/**
 * The deliverable spec, as instruction text for the agent writing it.
 *
 * Deliberately free of tooling and product names: this text becomes part of a
 * public-facing artifact.
 */
export const WRITEUP_SPEC = [
  `Write ${WRITEUP_PATH} in the workspace root, organized the way a CTF player writes a solve record:`,
  '',
  '```markdown',
  '# <题目名> — <分类>',
  '',
  '## 题目信息',
  '平台/赛事、分类、分值；题目描述的原文要点；附件清单与远程地址（动态靶机写清 host:port 或 URL）。',
  '',
  '## 侦察 / 信息收集',
  '你实际看到并验证过的东西：文件类型与元数据、strings/反编译片段、页面源码与关键请求、目录扫描结果。',
  '每条命令都写成可以直接复制执行的形式，并贴上它真实的输出（长输出截断，保留关键行）。',
  '',
  '## 漏洞分析',
  '漏洞点与成因、触发条件、为什么可利用。贴关键代码片段并指出问题所在的行；',
  '如果是已知漏洞或经典套路，写清对应的类型/CVE 与判断依据。',
  '',
  '## 利用过程',
  '从零到 flag 的完整步骤，按实际执行顺序排列：侦察得到的线索 → 构造 payload → 发送 → 得到什么回显 → 下一步。',
  'payload 同时给出原始形式与编码后的形式（URL/hex/base64 等）；关键请求贴原始 HTTP 报文；',
  '脚本片段要能独立跑起来，并说明需要的环境（Python 版本、依赖、需要连通的地址）。',
  '',
  '## flag',
  '平台/校验器返回的原始响应，以及 flag 原文。',
  '',
  '## 参考',
  '用到的公开资料、CVE、writeup、工具文档。没有就删掉这一节。',
  '```',
  '',
  'Rules:',
  '- 写你真正跑过的东西：命令、输出、payload、flag 都必须是真实的，不要凭记忆编造或润色输出。',
  '- 一条命令一个代码块，保证读者能原样复制执行、在有网的环境里复现整条链。',
  '- 中文写正文，命令/路径/流量/payload 保持原样。',
  '- 写失败的路和踩过的坑（死胡同）一两句话带过即可，把篇幅留给最终成功的路径。',
  '- 不要出现任何与解题工具、agent、模型、平台框架、团队协作机制相关的内容，也不要把这一节写成对外汇报。',
  '- 不要写修复建议、缓解措施或“如何防御”：writeup 记录的是怎么打进去，不是怎么修。',
  '- 已经存在的内容要更新，不要整篇重写；只补齐实际发生过的步骤。',
].join('\n')

/**
 * The completion contract, shared by the captain protocol and the panel.
 */
export const WRITEUP_COMPLETION = `A solved challenge is not finished until ${WRITEUP_PATH} lets someone replay the whole chain from the challenge files to the flag.`

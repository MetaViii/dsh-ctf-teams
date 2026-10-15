#!/usr/bin/env node
/**
 * Minimal CLI over the CTF2 MCP bridge.
 *
 * The DSH profile row talks to the local proxy (scripts/ctf2-mcp-proxy.mjs),
 * which owns the OAuth token and refreshes it. This CLI speaks the same
 * Streamable-HTTP JSON-RPC the harness speaks, so any lane can call CTF2 tools
 * from a shell:
 *
 *   node scripts/ctf2-cli.mjs tools
 *   node scripts/ctf2-cli.mjs whoami
 *   node scripts/ctf2-cli.mjs challenges practice_ground_id=<uuid> difficulty=Easy
 *   node scripts/ctf2-cli.mjs get <challenge_id>
 *   node scripts/ctf2-cli.mjs start <challenge_id>
 *   node scripts/ctf2-cli.mjs submit <challenge_id> <flag>
 *
 * Arguments are JSON (`'{"a":1}'`) or shell-safe `a=1 b=true` pairs; on Windows
 * PowerShell strips the quotes out of inline JSON handed to a native binary, so
 * prefer the pair form.
 *
 * Env: CTF2_PROXY (default http://127.0.0.1:39528/mcp)
 */

import { readFile, writeFile } from 'node:fs/promises'
import { Ctf2ProtocolError, parseRpcResponse, unwrapToolResult, filterUnsolved } from '../lib/ctf2-protocol.js'

const PROXY = process.env.CTF2_PROXY ?? 'http://127.0.0.1:39528/mcp'
let nextId = 1
async function rpc(method, params) {
  const id = nextId++
  let res
  try { res = await fetch(PROXY, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(35_000),
  }) } catch (error) {
    throw new Error(`local MCP proxy unreachable at ${new URL(PROXY).origin} (${error.cause?.code ?? error.name}). Check /health and start scripts/ctf2-mcp-proxy.mjs; do not retry challenge submissions until the proxy is up.`)
  }
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} -> HTTP ${res.status}: ${text.slice(0, 600)}`)
  return parseRpcResponse(text, id)
}

/** Flatten an MCP tool result into something readable. */
async function callTool(name, args, { print = true, unsolvedOnly = false } = {}) {
  if (!name) throw new Ctf2ProtocolError('A tool name is required; inspect `tools` or `schema <tool>`')
  const res = await rpc('tools/call', { name, arguments: args })
  let payload = unwrapToolResult(res)
  if (unsolvedOnly) {
    const filtered = filterUnsolved(payload)
    payload = filtered.payload
    console.error(`local unsolved filter: ${filtered.returned}/${filtered.received} returned; ${filtered.unknown} unknown status omitted; server totals unchanged`)
  }
  if (print) console.log(JSON.stringify(payload, null, 2))
  return payload
}

/** Accepts JSON or `a=1 b=true` pairs. */
function argsFrom(text) {
  if (!text) return {}
  const t = text.trim()
  if (t.startsWith('{')) return JSON.parse(t)
  const out = {}
  for (const pair of t.split(/\s+/)) {
    const i = pair.indexOf('=')
    if (i < 0) throw new Error(`not a k=v pair: ${pair}`)
    const k = pair.slice(0, i)
    const v = pair.slice(i + 1)
    out[k] = v === 'true' ? true : v === 'false' ? false : /^-?\d+$/.test(v) ? Number(v) : v
  }
  return out
}

async function listTools() {
  const tools = []
  const cursors = new Set()
  let cursor
  do {
    const page = await rpc('tools/list', cursor ? { cursor } : {})
    if (!Array.isArray(page.tools) || page.tools.some(tool => !tool || typeof tool.name !== 'string')) throw new Ctf2ProtocolError('Invalid tools/list response')
    tools.push(...page.tools)
    if (page.nextCursor && (typeof page.nextCursor !== 'string' || cursors.has(page.nextCursor))) throw new Ctf2ProtocolError('Invalid or repeated tools/list cursor')
    if (page.nextCursor) cursors.add(page.nextCursor)
    cursor = page.nextCursor
  } while (cursor)
  return tools
}

const [verb, ...rest] = process.argv.slice(2)
const arg = (i) => rest[i]

/**
 * Every CTF2 practice tool is keyed by (practice_ground_id, challenge_id).
 * Resolve the ground from an explicit second position argument or CTF2_GROUND.
 */
function where(challenge, ground) {
  const practice_ground_id = ground ?? process.env.CTF2_GROUND
  if (!practice_ground_id) {
    throw new Error(`no practice ground: pass it as the next argument or export CTF2_GROUND (challenge ${challenge})`)
  }
  return { practice_ground_id, challenge_id: challenge }
}

try {
  switch (verb) {
    case 'tools': {
      const tools = await listTools()
      for (const t of tools) console.log(`${t.name}\n    ${t.description?.split('\n')[0] ?? ''}`)
      console.error(`\n${tools.length} tool(s)`)
      break
    }
    case 'schema': {
      const tools = await listTools()
      const hit = tools.find((t) => t.name === arg(0) || t.name === `ctf2_${arg(0)}`)
      if (!hit) throw new Ctf2ProtocolError(`no such tool: ${arg(0)}`)
      console.log(JSON.stringify(hit, null, 2))
      break
    }
    case 'call':
      await callTool(arg(0), argsFrom(rest.slice(1).join(' ')))
      break
    case 'whoami':
      await callTool('ctf2_agent_whoami', {})
      break
    case 'grounds':
      await callTool('ctf2_list_practice_grounds', argsFrom(rest.join(' ')))
      break
    case 'next': {
      const args = argsFrom(rest.join(' '))
      await callTool('ctf2_agent_next_challenges', args, { unsolvedOnly: args.unsolved_only === true })
      break
    }
    case 'challenges': {
      const args = argsFrom(rest.join(' '))
      await callTool('ctf2_list_practice_challenges', args, { unsolvedOnly: args.unsolved_only === true })
      break
    }
    case 'get':
      await callTool('ctf2_get_practice_challenge', where(arg(0), arg(1)))
      break
    case 'attachment':
      await callTool('ctf2_get_attachment_url', { ...where(arg(0), arg(2)), file_id: arg(1) })
      break
    case 'download': {
      // Signed URL + fetch in one step: Windows PowerShell 5.1 fails the TLS
      // handshake on the CDN, so the download happens here, in Node.
      const info = await callTool('ctf2_get_attachment_url', { ...where(arg(0), arg(2)), file_id: arg(1) }, { print: false })
      const att = info?.attachment ?? info
      const res = await fetch(att.url)
      if (!res.ok) throw new Error(`attachment fetch -> HTTP ${res.status}`)
      const bytes = Buffer.from(await res.arrayBuffer())
      const out = arg(3) ?? att.file_name ?? 'attachment.bin'
      await writeFile(out, bytes)
      console.log(`${out}  ${bytes.length} bytes  (${att.file_name}, mime ${att.mime_type})`)
      break
    }
    case 'start':
      await callTool('ctf2_start_challenge_environment', where(arg(0), arg(1)))
      break
    case 'env':
      await callTool('ctf2_get_environment', where(arg(0), arg(1)))
      break
    case 'extend':
      await callTool('ctf2_extend_environment', where(arg(0), arg(1)))
      break
    case 'stop':
      await callTool('ctf2_user_delete_practice_id_challenges_challengeid_environment', where(arg(0), arg(1)))
      break
    case 'note': {
      // ctf2_agent_log_note takes ONLY {challenge_id, kind, content} and sets
      // additionalProperties:false, so no ground and no `format` may be sent.
      const kind = arg(1) ?? 'result'
      let content = arg(2)
      if (!content) throw new Error('note needs content, or @<path> to read it from a file')
      if (content.startsWith('@')) content = await readFile(content.slice(1), 'utf8')
      await callTool('ctf2_agent_log_note', { challenge_id: arg(0), kind, content })
      break
    }
    case 'submit':
      await callTool('ctf2_submit_flag', {
        ...where(arg(0), arg(2)),
        flag: arg(1),
        confirmation: true,
      })
      break
    default:
      console.log(`ctf2 - CLI over ${PROXY}

  tools                                     list MCP tools
  schema <tool>                             print one tool's inputSchema
  call <tool> [json|k=v]                    raw tools/call
  whoami                                    ctf2_agent_whoami
  grounds [json|k=v]                        ctf2_list_practice_grounds
  challenges <practice_ground_id=...>       ctf2_list_practice_challenges
  next [json|k=v]                           ctf2_agent_next_challenges
  get <challenge_id> [ground_id]            ctf2_get_practice_challenge
  attachment <challenge_id> <file_id> [gid] ctf2_get_attachment_url
  start <challenge_id> [ground_id]          ctf2_start_challenge_environment
  env <challenge_id> [ground_id]            ctf2_get_environment
  extend <challenge_id> [ground_id]         ctf2_extend_environment
  stop <challenge_id> [ground_id]           destroy the environment
  note <challenge_id> <plan|finding|result> <@file|text>
                                     ctf2_agent_log_note (challenge_id + kind + content only)
  submit <challenge_id> <flag> [ground_id]  ctf2_submit_flag (confirmation: true)

Every practice tool needs the ground: pass it positionally or export CTF2_GROUND.`)
  }
} catch (error) {
  console.error(`ctf2 error: ${error.message}`)
  process.exitCode = error instanceof Ctf2ProtocolError ? error.exitCode : 1
}

#!/usr/bin/env node
/**
 * End-to-end acceptance for the CTF2 MCP integration through the local proxy:
 * the same JSON-RPC sequence @deepseek-ai/dsh-mcp-client performs at startup
 * (`initialize` → paginated `tools/list`), then DSH's own schema validator over
 * every returned tool, then one live `tools/call`.
 *
 * This is the gate that proves the tools can actually register: if any
 * inputSchema left in the DSH subset fails, the bridge would roll back the whole
 * generation and the model would see no tools at all.
 *
 * Usage:
 *   node scripts/ctf2-mcp-acceptance.mjs [--proxy http://127.0.0.1:39528/mcp]
 */

import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PROXY_URL = String(
  process.argv.includes('--proxy') ? process.argv[process.argv.indexOf('--proxy') + 1] : 'http://127.0.0.1:39528/mcp',
)
const SERVER_NAME = 'ctf2'

const DSH_MODULES = ['C:/Users/MetaVi/.dsh/profiles/node_modules', resolve(REPO_ROOT, 'node_modules')]

function loadValidator() {
  for (const root of DSH_MODULES) {
    const file = resolve(root, '@deepseek-ai/dsh-tools/lib/index.js')
    if (existsSync(file)) return { entry: pathToFileURL(file).href, root }
  }
  throw new Error(`dsh-tools not found in: ${DSH_MODULES.join(', ')}`)
}

let nextId = 1
/** One proxy round trip; handles both plain JSON and SSE bodies. */
async function rpc(method, params) {
  const id = nextId++
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} -> HTTP ${res.status}: ${text.slice(0, 400)}`)
  const payload = text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('')
  const envelope = JSON.parse(payload || text)
  if (envelope.error) throw new Error(`${method} -> ${JSON.stringify(envelope.error)}`)
  return envelope.result
}

const { entry, root } = loadValidator()
const { assertSupportedJsonSchema } = await import(entry)
console.log(`proxy      : ${PROXY_URL}`)
console.log(`validator  : ${root}\\@deepseek-ai\\dsh-tools\n`)

const init = await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'dsh-ctf-teams', version: '0.1.29' },
})
console.log(`initialize : ok — ${init.serverInfo?.name} ${init.serverInfo?.version ?? ''} (protocol ${init.protocolVersion})`)

// The bridge drains pagination with a repeated-cursor guard; mirror that here.
const tools = []
const seen = new Set()
let cursor
do {
  const page = await rpc('tools/list', cursor ? { cursor } : {})
  tools.push(...page.tools)
  cursor = page.nextCursor
  if (cursor) {
    if (seen.has(cursor)) throw new Error(`repeated continuation cursor ${cursor}`)
    seen.add(cursor)
  }
} while (cursor)

console.log(`tools/list : ${tools.length} tools over ${seen.size + 1} page(s)`)

const rejected = []
let withOutputSchema = 0
for (const tool of tools) {
  try {
    assertSupportedJsonSchema(tool.inputSchema)
  } catch (error) {
    rejected.push([tool.name, error.message])
  }
  if (tool.outputSchema !== undefined) withOutputSchema += 1
}

console.log(`inputSchema: ${tools.length - rejected.length}/${tools.length} inside the DSH subset`)
console.log(`outputSchema still advertised: ${withOutputSchema} (bridge drops unsupported ones itself)`)

if (rejected.length) {
  console.log('\n✗ REJECTED — the bridge would roll back the whole generation:')
  for (const [name, message] of rejected) console.log(`  - ${name}: ${message}`)
  process.exitCode = 1
} else {
  console.log('\n✓ every tool registers; model-facing names:')
  for (const tool of tools) console.log(`   mcp__${SERVER_NAME}__${tool.name}`)
}

// One real call: proves the token injection and refresh path work, not just discovery.
if (!process.argv.includes('--no-live')) {
  const call = await rpc('tools/call', { name: 'ctf2_agent_whoami', arguments: {} })
  const payload = call.structuredContent ?? call.content
  console.log(`\nlive tools/call ctf2_agent_whoami (isError=${Boolean(call.isError)}):`)
  console.log(JSON.stringify(payload, null, 2).slice(0, 2000))
}

process.exitCode = rejected.length ? 1 : 0

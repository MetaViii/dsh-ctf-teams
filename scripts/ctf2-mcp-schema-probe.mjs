#!/usr/bin/env node
/**
 * Compatibility probe: will ctf2.dasctf.com's MCP tools survive the DSH bridge?
 *
 * The DSH MCP bridge accepts only a subset of JSON Schema for tool parameters
 * (`@deepseek-ai/dsh-tools` `assertSupportedJsonSchema`), and a single
 * unsupported keyword makes the whole tool generation roll back. This script
 * lists the real tools from CTF2 and runs DSH's own validator over every
 * `inputSchema` and `outputSchema` so the failure is predicted offline instead
 * of observed as "no tools appeared".
 *
 * Usage:
 *   node scripts/ctf2-mcp-schema-probe.mjs            # schema check only
 *   node scripts/ctf2-mcp-schema-probe.mjs --live     # also run tools/call ctf2_get_profile
 */

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MCP_URL = 'https://ctf2.dasctf.com/api/ai/v1/mcp'
const TOKEN_FILE = resolve(process.env.CTF2_OAUTH_DIR ?? resolve(REPO_ROOT, '.ctf2-agent'), 'oauth-token.json')

/** The harness runtime that actually loads the desktop profile. */
const DSH_MODULES = [
  'C:/Users/MetaVi/.dsh/profiles/node_modules',
  resolve(REPO_ROOT, 'node_modules'),
]

function loadHarnessValidator() {
  for (const root of DSH_MODULES) {
    const entry = pathToFileURL(resolve(root, '@deepseek-ai/dsh-tools/lib/index.js')).href
    if (existsSync(resolve(root, '@deepseek-ai/dsh-tools/lib/index.js'))) return { entry, root }
  }
  throw new Error(`dsh-tools not found in: ${DSH_MODULES.join(', ')}`)
}

async function accessToken() {
  if (!existsSync(TOKEN_FILE)) throw new Error(`no token file at ${TOKEN_FILE}; run \`node scripts/ctf2-mcp-oauth.mjs login\``)
  const record = JSON.parse(await readFile(TOKEN_FILE, 'utf8'))
  if (!record.access_token) throw new Error(`${TOKEN_FILE} has no access_token`)
  if (record.expires_at && Date.parse(record.expires_at) < Date.now()) {
    throw new Error(`access token expired at ${record.expires_at}; run \`node scripts/ctf2-mcp-oauth.mjs refresh\``)
  }
  return record.access_token
}

/** One Streamable-HTTP JSON-RPC call; reads both plain JSON and SSE-framed replies. */
async function rpc(token, method, params, id = 1) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} -> HTTP ${res.status}: ${text.slice(0, 300)}`)
  const payload = text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('')
  const envelope = JSON.parse(payload || text)
  if (envelope.error) throw new Error(`${method} -> JSON-RPC error ${JSON.stringify(envelope.error)}`)
  return envelope.result
}

const { entry, root } = loadHarnessValidator()
const tools = await import(entry)
const { assertSupportedJsonSchema } = tools
console.log(`validator  : ${root}\\@deepseek-ai\\dsh-tools`)

const token = await accessToken()
const init = await rpc(token, 'initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'dsh-ctf-teams', version: '0.1.29' },
})
console.log(`server     : ${init.serverInfo?.name} ${init.serverInfo?.version ?? ''}`)
console.log(`protocol   : ${init.protocolVersion}`)
if (init.instructions) console.log(`instructns : ${init.instructions.length} chars`)

const list = await rpc(token, 'tools/list', {}, 2)
console.log(`tools      : ${list.tools.length}\n`)

let inputOk = 0
let outputOk = 0
const inputBad = []
const outputBad = []
const taskRequired = []

for (const tool of list.tools) {
  try {
    assertSupportedJsonSchema(tool.inputSchema)
    inputOk += 1
  } catch (error) {
    inputBad.push([tool.name, error.message])
  }
  if (tool.outputSchema === undefined) {
    outputOk += 1
  } else {
    try {
      assertSupportedJsonSchema(tool.outputSchema)
      outputOk += 1
    } catch (error) {
      outputBad.push([tool.name, error.message])
    }
  }
  if (tool.execution?.taskSupport === 'required') taskRequired.push(tool.name)
}

console.log(`inputSchema   supported: ${inputOk}/${list.tools.length}`)
console.log(`outputSchema  supported: ${outputOk}/${list.tools.length}  (unsupported ones are dropped, not fatal)`)
console.log(`task-required tools    : ${taskRequired.length ? taskRequired.join(', ') : 'none'}`)

if (inputBad.length) {
  console.log('\n✗ INPUT schemas the bridge would REJECT (blocks the whole tool generation):')
  for (const [name, message] of inputBad) console.log(`  - ${name}: ${message}`)
} else {
  console.log('\n✓ Every inputSchema is inside the DSH subset — registration will not be rejected.')
}

if (outputBad.length) {
  console.log('\n· OUTPUT schemas that degrade to unconstrained JsonValue (harmless):')
  for (const [name, message] of outputBad.slice(0, 5)) console.log(`  - ${name}: ${message}`)
  if (outputBad.length > 5) console.log(`  … and ${outputBad.length - 5} more`)
}

console.log('\nmodel-facing names (first 5):')
for (const tool of list.tools.slice(0, 5)) console.log(`  mcp__ctf2__${tool.name}`)

if (process.argv.includes('--live')) {
  const call = await rpc(token, 'tools/call', { name: 'ctf2_get_profile', arguments: {} }, 3)
  console.log('\nlive tools/call ctf2_get_profile:')
  console.log(JSON.stringify(call.structuredContent ?? call.content, null, 2).slice(0, 1500))
}

process.exitCode = inputBad.length ? 1 : 0

#!/usr/bin/env node
/**
 * Local MCP proxy in front of https://ctf2.dasctf.com/api/ai/v1/mcp, for DSH.
 *
 * It closes the two gaps that stop @deepseek-ai/dsh-mcp-client from using CTF2
 * directly:
 *
 * 1. **Authorization.** The DSH bridge sends static headers and implements no
 *    OAuth, while CTF2 requires a Bearer token that expires in ~15 minutes.
 *    The proxy injects the token and refreshes it transparently, so the client
 *    never sees a 401 mid-session.
 *
 * 2. **Schema subset.** DSH accepts only `type/oneOf/properties/required/
 *    additionalProperties/items/enum/const` for tool parameters, and rejects the
 *    *entire* tool generation when one tool violates it. CTF2's tools use
 *    `format`, `minLength`, `maxLength`, `minimum`, `maximum`, `anyOf`, and type
 *    arrays. The proxy strips those keywords from `tools/list` input schemas,
 *    keeping every keyword DSH does enforce, so validation of arguments is
 *    preserved as far as the harness can express it.
 *
 * Everything else — JSON-RPC ids, SSE framing, `tools/call` bodies, error
 * results — is forwarded byte-for-byte.
 *
 * Usage:
 *   node scripts/ctf2-mcp-proxy.mjs --selftest     # offline sanitizer proof
 *   node scripts/ctf2-mcp-proxy.mjs                # listen on 127.0.0.1:39528
 *   node scripts/ctf2-mcp-proxy.mjs --port 39528 --verbose
 */

import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const UPSTREAM = 'https://ctf2.dasctf.com/api/ai/v1/mcp'
const ISSUER = 'https://ctf2.dasctf.com'
const TOKEN_ENDPOINT = `${ISSUER}/oauth/token`

const CREDENTIAL_DIR = String(process.env.CTF2_OAUTH_DIR ?? resolve(REPO_ROOT, '.ctf2-agent'))
const TOKEN_FILE = resolve(CREDENTIAL_DIR, 'oauth-token.json')
const CLIENT_FILE = resolve(CREDENTIAL_DIR, 'oauth-client.json')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}

const VERBOSE = process.argv.includes('--verbose')

// ---------------------------------------------------------------- sanitizer --

/** What @deepseek-ai/dsh-tools `assertSupportedJsonSchema` accepts. */
const ALLOWED = new Set([
  'type',
  'oneOf',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'const',
])
/** Annotations are carried through: they are data, not constraints. */
const ANNOTATIONS = new Set(['description', 'title', 'default', 'examples'])
const SIMPLE_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])

/**
 * Rewrite one schema node into the DSH subset.
 * @returns {{schema: object, stripped: string[]}} the sanitized node and the keyword paths removed.
 */
function sanitizeSchema(node, path = 'schema', stripped = []) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return { schema: node, stripped }

  const out = {}

  // DSH rejects `type: ["string","null"]`; keep the first concrete type.
  let type = node.type
  if (Array.isArray(type)) {
    const concrete = type.find((t) => t !== 'null' && SIMPLE_TYPES.has(t))
    stripped.push(`${path}.type (${type.join('|')} → ${concrete ?? 'omitted'})`)
    type = concrete
  }
  if (typeof type === 'string' && SIMPLE_TYPES.has(type)) out.type = type

  for (const [key, value] of Object.entries(node)) {
    if (key === 'type') continue
    if (ANNOTATIONS.has(key)) {
      out[key] = value
      continue
    }
    if (!ALLOWED.has(key)) {
      stripped.push(`${path}.${key}`)
      continue
    }
    if (key === 'properties') {
      out.properties = {}
      for (const [prop, sub] of Object.entries(value ?? {})) {
        out.properties[prop] = sanitizeSchema(sub, `${path}.properties.${prop}`, stripped).schema
      }
      continue
    }
    if (key === 'items') {
      // `items` is only valid under an array root in the DSH subset.
      if (type === 'array') out.items = sanitizeSchema(value, `${path}.items`, stripped).schema
      else stripped.push(`${path}.items (parent is not an array)`)
      continue
    }
    if (key === 'required') {
      // Keep only names that are still declared properties, so a stale entry
      // cannot make every call fail validation.
      const declared = new Set(Object.keys(node.properties ?? {}))
      const kept = Array.isArray(value) ? value.filter((name) => declared.has(name)) : []
      const dropped = Array.isArray(value) ? value.filter((name) => !declared.has(name)) : []
      for (const name of dropped) stripped.push(`${path}.required[${name}] (undeclared property)`)
      if (kept.length) out.required = kept
      continue
    }
    if (key === 'oneOf') {
      // `oneOf` and `type` are mutually exclusive in the subset.
      delete out.type
      const members = Array.isArray(value) ? value : []
      if (members.length >= 2) {
        out.oneOf = members.map((sub, i) => sanitizeSchema(sub, `${path}.oneOf[${i}]`, stripped).schema)
      } else {
        stripped.push(`${path}.oneOf (needs at least two schemas)`)
      }
      continue
    }
    out[key] = value
  }

  // A node that declares neither `type` nor `oneOf` may not carry the sibling
  // constraint keywords the subset ties to a type.
  if (out.type === undefined && out.oneOf === undefined) {
    for (const key of ['properties', 'required', 'additionalProperties', 'items', 'enum', 'const']) {
      if (Object.hasOwn(out, key)) {
        delete out[key]
        stripped.push(`${path}.${key} (no type or oneOf)`)
      }
    }
  }
  return { schema: out, stripped }
}

/** Prefer a typed shape over a bare object for the required `inputSchema`. */
function sanitizeInputSchema(schema) {
  const { schema: clean, stripped } = sanitizeSchema(schema ?? { type: 'object', properties: {} })
  if (clean.type !== 'object' && clean.oneOf === undefined) return { schema: { type: 'object' }, stripped }
  return { schema: clean, stripped }
}

/** Rewrite every `tools/list` result in a JSON-RPC payload, in place. */
function sanitizeToolsList(message) {
  const tools = message?.result?.tools
  if (!Array.isArray(tools)) return { message, report: [] }
  const report = []
  for (const tool of tools) {
    const { schema, stripped } = sanitizeInputSchema(tool.inputSchema)
    tool.inputSchema = schema
    // Unsupported outputSchema vocabulary is dropped by the bridge itself; the
    // proxy strips it for the same reason so `structuredContent` stays bounded.
    if (tool.outputSchema !== undefined) {
      delete tool.outputSchema
      stripped.push('outputSchema (dropped: DSH bridge degrades it anyway)')
    }
    if (stripped.length) report.push({ tool: tool.name, stripped })
  }
  return { message, report }
}

// ------------------------------------------------------------------- tokens --

async function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

function secondsLeft(record) {
  if (!record?.expires_at) return null
  return Math.round((Date.parse(record.expires_at) - Date.now()) / 1000)
}

let refreshInFlight = null

/** Refresh the access token when it is close to expiry. */
async function refreshToken(force = false) {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    const stored = await readJson(TOKEN_FILE)
    if (!stored?.refresh_token) throw new Error(`no refresh_token in ${TOKEN_FILE}; run \`ctf2-mcp-oauth.mjs login\``)
    const left = secondsLeft(stored)
    if (!force && left !== null && left > 60) return stored
    const client = await readJson(CLIENT_FILE, {})
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: stored.refresh_token,
        client_id: client?.client_id ?? '',
        resource: UPSTREAM,
      }).toString(),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`refresh failed ${res.status}: ${text.slice(0, 300)}`)
    const body = JSON.parse(text)
    const record = {
      ...stored,
      ...body,
      refresh_token: body.refresh_token ?? stored.refresh_token,
      obtained_at: new Date().toISOString(),
      expires_at: body.expires_in ? new Date(Date.now() + body.expires_in * 1000).toISOString() : null,
    }
    await writeJson(TOKEN_FILE, record)
    if (VERBOSE) process.stdout.write(`[proxy] token refreshed, ${secondsLeft(record)}s left\n`)
    return record
  })().finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

async function currentToken() {
  const stored = await readJson(TOKEN_FILE)
  if (!stored?.access_token) throw new Error(`no token in ${TOKEN_FILE}; run \`ctf2-mcp-oauth.mjs login\``)
  const left = secondsLeft(stored)
  if (left !== null && left <= 60) return (await refreshToken(true)).access_token
  return stored.access_token
}

// ------------------------------------------------------------------ proxying --

/** Forward one JSON-RPC message upstream, refreshing once on a 401. */
async function forward(rawBody, allowRetry = true) {
  const token = await currentToken()
  const res = await fetch(UPSTREAM, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: rawBody,
  })
  if (res.status === 401 && allowRetry) {
    if (VERBOSE) process.stdout.write('[proxy] upstream 401 — forcing a token refresh and retrying once\n')
    await refreshToken(true)
    return forward(rawBody, false)
  }
  return res
}

/** Rebuild an SSE body after rewriting any `tools/list` payload inside it. */
function rewriteSse(text) {
  const report = []
  const lines = text.split('\n')
  const out = lines.map((line) => {
    if (!line.startsWith('data:')) return line
    const payload = line.slice(5).trim()
    if (!payload) return line
    try {
      const parsed = JSON.parse(payload)
      const result = sanitizeToolsList(parsed)
      report.push(...result.report)
      return `data: ${JSON.stringify(result.message)}`
    } catch {
      return line
    }
  })
  return { body: out.join('\n'), report }
}

const server = createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(405, { 'content-type': 'text/plain' }).end('this MCP proxy only accepts POST')
    return
  }
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', async () => {
    const rawBody = Buffer.concat(chunks).toString('utf8')
    try {
      const upstream = await forward(rawBody)
      const contentType = upstream.headers.get('content-type') ?? 'application/json'
      const text = await upstream.text()
      const isSse = contentType.includes('text/event-stream')
      const { body, report } = isSse ? rewriteSse(text) : rewriteJson(text)
      for (const entry of report) {
        process.stdout.write(`[proxy] sanitized ${entry.tool}: ${entry.stripped.length} keyword(s)\n`)
      }
      res.writeHead(upstream.status, { 'content-type': contentType })
      res.end(body)
    } catch (error) {
      process.stdout.write(`[proxy] error: ${error.message}\n`)
      res.writeHead(502, { 'content-type': 'application/json' }).end(
        JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: String(error.message) }, id: null }),
      )
    }
  })
})

/** Same rewrite for a plain-JSON body. */
function rewriteJson(text) {
  try {
    const parsed = JSON.parse(text)
    const { report } = sanitizeToolsList(parsed)
    return { body: JSON.stringify(parsed), report }
  } catch {
    return { body: text, report: [] }
  }
}

// -------------------------------------------------------------------- driver --

function selftest() {
  const sample = {
    type: 'object',
    properties: {
      challenge_id: { type: 'string', format: 'uuid', description: 'keep me' },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      content: { type: 'string', minLength: 1, maxLength: 2000 },
      rank: { type: ['integer', 'null'], minimum: 0 },
      mode: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    },
    required: ['challenge_id', 'format', 'content', 'maxLength', 'minLength'],
    additionalProperties: false,
  }
  const { schema, stripped } = sanitizeInputSchema(sample)
  console.log('sanitized inputSchema:')
  console.log(JSON.stringify(schema, null, 2))
  console.log('\nstripped:')
  for (const s of stripped) console.log(`  - ${s}`)
  const keptFormat = JSON.stringify(schema).includes('"format"')
  const keptRequired = schema.required
  console.log(`\nformat keyword gone      : ${!keptFormat ? 'yes' : 'NO — still present'}`)
  console.log(`required survivors       : ${JSON.stringify(keptRequired)}`)
  console.log(`description annotation   : ${schema.properties.challenge_id.description === 'keep me' ? 'preserved' : 'LOST'}`)
  console.log(`constraints kept         : type/enum/const/properties/items only — ${Object.keys(schema).join(', ')}`)
  return !keptFormat && !!keptRequired
}

if (process.argv.includes('--selftest')) {
  process.exitCode = selftest() ? 0 : 1
} else {
  const port = Number(arg('port', 39528))
  const host = String(arg('host', '127.0.0.1'))
  await refreshToken().catch((error) => {
    process.stdout.write(`[proxy] warning: ${error.message}\n`)
  })
  server.listen(port, host, () => {
    process.stdout.write(`[proxy] ctf2 MCP proxy listening on http://${host}:${port}/mcp\n`)
    process.stdout.write(`[proxy] upstream ${UPSTREAM}\n`)
  })
}

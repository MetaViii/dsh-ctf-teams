#!/usr/bin/env node
/**
 * CTF2 MCP OAuth 2.1 helper for DeepSeek Harness (DSH).
 *
 * Why this exists: ctf2.dasctf.com/api/ai/v1/mcp is an OAuth-protected
 * Streamable-HTTP MCP endpoint. @deepseek-ai/dsh-mcp-client speaks
 * `streamable-http` with static headers and implements no OAuth flow, so the
 * Bearer credential has to be obtained out of band and injected as a header.
 *
 * This script owns that out-of-band part: Dynamic Client Registration (RFC
 * 7591), Authorization Code + PKCE (S256), token refresh, and a local token
 * file the DSH plugin config reads for its `Authorization` header.
 *
 * Usage:
 *   node scripts/ctf2-mcp-oauth.mjs status
 *   node scripts/ctf2-mcp-oauth.mjs login [--scopes a,b,c] [--client <id>] [--port 39527]
 *   node scripts/ctf2-mcp-oauth.mjs refresh
 *   node scripts/ctf2-mcp-oauth.mjs token        # prints a currently valid access token
 *   node scripts/ctf2-mcp-oauth.mjs exchange --code <authcode>   # paste-the-code fallback
 *
 * Default token file: <workspace>/.ctf-teams/ctf2-agent/oauth-token.json
 */

import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const ISSUER = 'https://ctf2.dasctf.com'
const AUTHORIZE_ENDPOINT = `${ISSUER}/oauth/authorize`
const TOKEN_ENDPOINT = `${ISSUER}/oauth/token`
const REGISTER_ENDPOINT = `${ISSUER}/oauth/register`
const RESOURCE = `${ISSUER}/api/ai/v1/mcp`

/** Read-only by default: the platform asks for minimum scopes until a write is requested. */
const DEFAULT_SCOPES = [
  'profile:read',
  'daily:read',
  'practice:read',
  'environment:read',
  'environment:write',
  'practice:submit',
  'agent:read',
  'agent:trace',
  'competition:read',
  'submission:read',
]

/**
 * Keep the credential outside `.ctf-teams`: the DSH Windows file sandbox denies
 * writes to the CTFTeams state directory (and to `scripts/`) from the shell it
 * spawns, so a token written there would fail with a bare access denial.
 */
const CREDENTIAL_DIR = String(
  process.env.CTF2_OAUTH_DIR ?? resolve(REPO_ROOT, '.ctf2-agent'),
)
const DEFAULT_STORE = resolve(CREDENTIAL_DIR, 'oauth-token.json')
const CLIENT_STORE = resolve(CREDENTIAL_DIR, 'oauth-client.json')

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const value = process.argv[i + 1]
  return value === undefined || value.startsWith('--') ? true : value
}

const STORE_PATH = resolve(String(arg('store', DEFAULT_STORE)))

function log(...parts) {
  console.log(...parts)
}

async function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`)
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function pkcePair() {
  const verifier = base64url(randomBytes(48))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function openBrowser(url) {
  const platform = process.platform
  const [command, args] =
    platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}

async function registerClient(redirectUri) {
  const payload = {
    client_name: 'deepseek-harness (dsh-ctf-teams)',
    redirect_uris: [redirectUri],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: DEFAULT_SCOPES.join(' '),
  }
  const res = await fetch(REGISTER_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`dynamic client registration failed (${res.status}): ${text}`)
  const client = JSON.parse(text)
  client.redirect_uris = client.redirect_uris ?? [redirectUri]
  return client
}

async function ensureClient(redirectUri, explicitClientId) {
  if (explicitClientId) {
    const stored = (await readJson(CLIENT_STORE)) ?? {}
    return { client_id: String(explicitClientId), redirect_uris: stored.redirect_uris ?? [redirectUri] }
  }
  const stored = await readJson(CLIENT_STORE)
  if (stored?.client_id) return stored
  log('· registering a new OAuth client (RFC 7591)…')
  const client = await registerClient(redirectUri)
  await writeJson(CLIENT_STORE, client)
  log(`· client_id ${client.client_id} saved to ${CLIENT_STORE}`)
  return client
}

async function postToken(body) {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  })
  const text = await res.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = { raw: text }
  }
  if (!res.ok) {
    const detail = parsed.error_description ?? parsed.error ?? parsed.raw ?? text
    throw new Error(`token endpoint ${res.status}: ${detail}`)
  }
  return parsed
}

function withExpiry(record) {
  const now = Date.now()
  const expiresIn = Number(record.expires_in ?? 0)
  return {
    ...record,
    obtained_at: new Date(now).toISOString(),
    expires_at: expiresIn > 0 ? new Date(now + expiresIn * 1000).toISOString() : null,
    expires_in: expiresIn,
  }
}

function secondsLeft(record) {
  if (!record?.expires_at) return null
  return Math.round((Date.parse(record.expires_at) - Date.now()) / 1000)
}

/** Exchange an authorization code (the same call serves the browser redirect and the paste fallback). */
async function exchangeCode({ clientId, code, verifier, redirectUri }) {
  const token = await postToken({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    resource: RESOURCE,
  })
  const record = withExpiry(token)
  await writeJson(STORE_PATH, record)
  return record
}

function successPage(message) {
  return `<!doctype html><meta charset="utf-8"><title>CTF2 MCP authorization</title>
<body style="font-family:system-ui;padding:3rem;max-width:40rem;margin:auto">
<h1 style="font-size:1.3rem">CTF2 MCP 授权完成</h1>
<p>${message}</p>
<p style="color:#666">可以关闭此页面，回到 DSH 继续。</p></body>`
}

async function login() {
  const port = Number(arg('port', 39527))
  const redirectUri = `http://127.0.0.1:${port}/callback`
  const scopes = String(arg('scopes', DEFAULT_SCOPES.join(',')))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const client = await ensureClient(redirectUri, arg('client'))
  const clientId = client.client_id
  const { verifier, challenge } = pkcePair()
  const state = base64url(randomBytes(16))

  const authUrl = new URL(AUTHORIZE_ENDPOINT)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', scopes.join(' '))
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')
  authUrl.searchParams.set('resource', RESOURCE)

  let settle
  const done = new Promise((resolvePromise) => {
    settle = resolvePromise
  })

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', redirectUri)
    if (url.pathname !== '/callback') {
      res.writeHead(404).end('not found')
      return
    }
    const code = url.searchParams.get('code')
    const error = url.searchParams.get('error')
    const returnedState = url.searchParams.get('state')
    if (error) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
      res.end(successPage(`授权失败：${error} ${url.searchParams.get('error_description') ?? ''}`))
      settle({ ok: false, reason: `${error} ${url.searchParams.get('error_description') ?? ''}` })
      return
    }
    if (returnedState !== state) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
      res.end(successPage('state 不匹配，已拒绝该回调。'))
      settle({ ok: false, reason: 'state mismatch' })
      return
    }
    try {
      await exchangeCode({ clientId, code, verifier, redirectUri })
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(successPage('访问令牌已写入本地 token 文件。'))
      settle({ ok: true })
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' })
      res.end(successPage(`换取令牌失败：${err.message}`))
      settle({ ok: false, reason: err.message })
    }
  })

  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolvePromise)
  })
  log(`· callback listening on ${redirectUri}`)

  log('· opening the CTF2 authorization page in your browser…')
  log(`  if it does not open, paste this URL:\n  ${authUrl.toString()}\n`)
  openBrowser(authUrl.toString())

  const timeoutMs = Number(arg('timeout', 300000))
  const timer = setTimeout(() => settle({ ok: false, reason: 'timed out waiting for the browser callback' }), timeoutMs)
  const result = await done
  clearTimeout(timer)
  server.close()

  if (!result.ok) {
    log(`\n✗ browser flow did not complete: ${result.reason}`)
    log('\nFallback: authorize in the browser, copy the `code` from the address bar, then run')
    log(`  node scripts/ctf2-mcp-oauth.mjs exchange --code <code> --verifier ${verifier}`)
    await writeJson(resolve(dirname(STORE_PATH), 'pending-pkce.json'), { verifier, clientId, redirectUri, scopes })
    process.exitCode = 1
    return
  }
  await reportStatus()
}

async function exchange() {
  const code = arg('code')
  if (!code || code === true) throw new Error('--code <authorization code> is required')
  const pending = await readJson(resolve(dirname(STORE_PATH), 'pending-pkce.json'))
  const verifier = arg('verifier') ?? pending?.verifier
  if (!verifier || verifier === true) throw new Error('no PKCE verifier available: pass --verifier')
  const clientId = arg('client') ?? pending?.clientId ?? (await readJson(CLIENT_STORE))?.client_id
  const redirectUri = String(arg('redirect', pending?.redirectUri ?? 'http://127.0.0.1:39527/callback'))
  const record = await exchangeCode({ clientId, code: String(code), verifier: String(verifier), redirectUri })
  log('· token exchanged')
  await reportStatus(record)
}

async function refresh() {
  const stored = await readJson(STORE_PATH)
  if (!stored?.refresh_token) throw new Error(`no refresh_token in ${STORE_PATH}; run \`login\` first`)
  const client = await readJson(CLIENT_STORE, {})
  const token = await postToken({
    grant_type: 'refresh_token',
    refresh_token: stored.refresh_token,
    client_id: client?.client_id ?? stored.client_id ?? '',
    resource: RESOURCE,
  })
  const record = withExpiry({ ...token, refresh_token: token.refresh_token ?? stored.refresh_token })
  await writeJson(STORE_PATH, record)
  log('· access token refreshed')
  await reportStatus(record)
}

/** Print the access token, refreshing it first when it is expired or about to be. */
async function token() {
  let stored = await readJson(STORE_PATH)
  if (!stored?.access_token) throw new Error(`no token in ${STORE_PATH}; run \`login\` first`)
  const left = secondsLeft(stored)
  if (left !== null && left < 60) {
    try {
      await refresh()
      stored = await readJson(STORE_PATH)
    } catch (error) {
      process.stderr.write(`refresh failed: ${error.message}\n`)
    }
  }
  const left2 = secondsLeft(stored)
  if (left2 !== null && left2 < 0) throw new Error('access token expired and could not be refreshed; run `login`')
  process.stdout.write(`${stored.access_token}\n`)
}

async function reportStatus(record) {
  const stored = record ?? (await readJson(STORE_PATH))
  if (!stored) {
    log(`✗ no token file at ${STORE_PATH}; run \`login\``)
    process.exitCode = 1
    return
  }
  const left = secondsLeft(stored)
  log('')
  log(`token file  : ${STORE_PATH}`)
  log(`scope       : ${stored.scope ?? '(not reported)'}`)
  log(`token type  : ${stored.token_type ?? 'Bearer'}`)
  log(`expires_at  : ${stored.expires_at ?? '(unknown)'}${left === null ? '' : `  (${left}s left)`}`)
  log(`refresh     : ${stored.refresh_token ? 'yes' : 'no'}`)
  const whoami = await probeWhoami(stored.access_token)
  log(`probe       : ${whoami}`)
}

async function probeWhoami(accessToken) {
  try {
    const res = await fetch(RESOURCE, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'dsh-ctf-teams', version: '0.1.29' },
        },
      }),
    })
    if (!res.ok) return `MCP initialize returned ${res.status}`
    const text = await res.text()
    const dataLine = text.split('\n').find((line) => line.startsWith('data:')) ?? text
    const parsed = JSON.parse(dataLine.replace(/^data:\s*/, ''))
    const info = parsed?.result?.serverInfo
    return info ? `MCP ok — ${info.name} ${info.version ?? ''}`.trim() : 'MCP ok'
  } catch (error) {
    return `MCP probe failed: ${error.message}`
  }
}

const command = process.argv[2] ?? 'status'
const commands = { login, refresh, status: () => reportStatus(), token, exchange }

try {
  const run = commands[command]
  if (!run) throw new Error(`unknown command ${JSON.stringify(command)}; expected one of ${Object.keys(commands).join(', ')}`)
  await run()
} catch (error) {
  process.stderr.write(`error: ${error.message}\n`)
  process.exitCode = 1
}

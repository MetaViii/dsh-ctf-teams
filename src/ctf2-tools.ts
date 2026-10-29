/** Typed host-side platform bridge; OAuth never enters a solving container. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { spawn, type ChildProcess } from 'node:child_process'
import { join, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { access } from 'node:fs/promises'
import { proxyHealth, proxyUrl, type PlatformConfig } from './platform.ts'
import { parseRpcResponse, unwrapToolResult } from './ctf2-protocol.ts'
import { requireExecutionPolicy, type AuthorizeExecution } from './execution-tools.ts'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

const methods: Record<string, string> = {
  whoami: 'ctf2_agent_whoami', grounds: 'ctf2_list_practice_grounds',
  challenges: 'ctf2_list_practice_challenges', get: 'ctf2_get_practice_challenge',
  attachment: 'ctf2_get_attachment_url', environment: 'ctf2_get_environment',
  start: 'ctf2_start_challenge_environment', extend: 'ctf2_extend_environment',
  stop: 'ctf2_user_delete_practice_id_challenges_challengeid_environment', submit: 'ctf2_submit_flag',
}
const writes = new Set(['connect', 'start', 'extend', 'stop', 'submit'])
const value = (data: unknown): Record<string, JsonValue> => JSON.parse(JSON.stringify(data))

export async function callPlatformBridge(config: PlatformConfig, action: string, args: Record<string, JsonValue>, signal: AbortSignal): Promise<JsonValue> {
  const name = methods[action]
  if (!name) throw new Error('Unsupported CTF2 platform action')
  const id = 'ctf-teams-' + action
  const response = await fetch(proxyUrl(config), {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs ?? 35_000)]),
  })
  if (!response.ok) throw new Error(`CTF2 HTTP ${response.status}; no platform verdict was recorded. Inspect status before retrying a write.`)
  return unwrapToolResult(parseRpcResponse(await response.text(), id)) as JsonValue
}

export function registerCtf2Bridge(ctx: Context, config: PlatformConfig, authorize: AuthorizeExecution): void {
  const owned = new Map<string, ChildProcess>()
  ctx.effect(() => () => { for (const child of owned.values()) child.kill(); owned.clear() }, 'ctf-teams: platform proxy ownership')
  ctx.tools.register(defineTool({
    name: 'ctf_teams_ctf2',
    description: 'Captain-only typed CTF2 platform bridge, independent of Docker and host shells. connect starts only the packaged loopback proxy with existing host OAuth files; no automatic login or token export. Read actions query platform facts/attachment URLs. start/extend/stop/submit change the platform explicitly, never retry automatically and never mark a local flag verified. Do not stop a target needed by other work; platform writes are blocked while the team is halted/staged.',
    parameters: {
      action: { type: 'string', required: true, enum: ['connect', 'whoami', 'grounds', 'challenges', 'get', 'attachment', 'environment', 'start', 'extend', 'stop', 'submit'] },
      practice_ground_id: { type: 'string' }, challenge_id: { type: 'string' }, file_id: { type: 'string' },
      flag: { type: 'string', description: 'submit: exact candidate, preserving bytes/case/wrapper.' },
      page: { type: 'number' }, limit: { type: 'number' }, category: { type: 'string' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
    async execute(args, exec) {
      const a = await authorize(exec, { mutate: writes.has(args.action) })
      if (!a.captain) throw new Error('Only the captain controls the platform bridge')
      if (writes.has(args.action)) requireExecutionPolicy(a.agent)
      if (args.action === 'connect') {
        const health = await proxyHealth(config)
        if (health.up) return value({ action: 'connect', ...health, already_running: true })
        const directory = config.credentialDir ?? join(a.workspace, '.ctf2-agent')
        if (!isAbsolute(directory)) throw new Error('Proxy credential directory must be absolute')
        await access(join(directory, 'oauth-token.json')).catch(() => { throw new Error('Existing CTF2 OAuth file was not found; configure/login with the packaged OAuth helper. No credentials were mounted in Docker.') })
        const url = proxyUrl(config)
        let failure = ''
        if (!owned.has(url.href)) {
          const child = spawn(process.execPath, [fileURLToPath(new URL('../scripts/ctf2-mcp-proxy.mjs', import.meta.url)), '--host', url.hostname, '--port', url.port || '80'], {
            env: { ...process.env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}), CTF2_OAUTH_DIR: directory }, stdio: 'ignore', windowsHide: true,
          })
          owned.set(url.href, child)
          child.once('error', error => { failure = error.message; if (owned.get(url.href) === child) owned.delete(url.href) })
          child.once('exit', () => { if (owned.get(url.href) === child) owned.delete(url.href) })
        }
        for (let index = 0; index < 30; index++) {
          exec.signal.throwIfAborted()
          if (failure) throw new Error('Proxy failed to start: ' + failure)
          const ready = await proxyHealth({ ...config, timeoutMs: 500 })
          if (ready.up) return value({ action: 'connect', ...ready, already_running: false, note: 'Proxy liveness only; whoami verifies platform authentication. Host-owned proxy survives team pause.' })
          await new Promise<void>(done => setTimeout(done, 100))
        }
        throw new Error('Proxy startup was not confirmed; inspect the configured loopback endpoint. No platform write was retried.')
      }
      const params: Record<string, JsonValue> = {}
      if (!['whoami', 'grounds'].includes(args.action)) {
        if (!args.practice_ground_id?.trim()) throw new Error('practice_ground_id is required')
        params.practice_ground_id = args.practice_ground_id
        if (args.action !== 'challenges') {
          if (!args.challenge_id?.trim()) throw new Error('challenge_id is required')
          params.challenge_id = args.challenge_id
        }
      }
      if (args.action === 'challenges') {
        for (const [key, value] of [['page', args.page], ['limit', args.limit]] as const) if (value !== undefined) {
          if (!Number.isInteger(value) || value < 1 || value > (key === 'limit' ? 100 : 100_000)) throw new Error(`Invalid ${key}`)
          params[key] = value
        }
        if (args.category) params.category = args.category
      }
      if (args.action === 'attachment') { if (!args.file_id) throw new Error('file_id is required'); params.file_id = args.file_id }
      if (args.action === 'submit') { if (!args.flag || args.flag.length > 8192) throw new Error('flag must contain 1..8192 characters'); params.flag = args.flag; params.confirmation = true }
      return value({ action: args.action, result: await callPlatformBridge(config, args.action, params, exec.signal), local_verdict_recorded: false })
    },
  }))
}

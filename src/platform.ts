import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { TeamState } from './types.ts'

export interface PlatformConfig {
  proxyUrl?: string
  timeoutMs?: number
  manageProxy?: boolean
  credentialDir?: string
  restartDelayMs?: number
  maxRestarts?: number
}

export function proxyUrl(config: PlatformConfig = {}): URL {
  const url = new URL(config.proxyUrl ?? 'http://127.0.0.1:39528/mcp')
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('CTF2 proxy must be an unauthenticated loopback HTTP URL')
  return url
}

export async function proxyHealth(config: PlatformConfig = {}): Promise<{ up: boolean; state: string }> {
  const url = proxyUrl(config)
  try {
    const response = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(config.timeoutMs ?? 5000) })
    const body = await response.json() as { service?: string }
    return { up: response.ok && body.service === 'ctf2-mcp-proxy', state: response.ok && body.service === 'ctf2-mcp-proxy' ? 'up' : 'unrecognized proxy; upgrade the proxy to expose /health' }
  } catch { return { up: false, state: `down/unreachable at ${url.origin}; start scripts/ctf2-mcp-proxy.mjs or enable host-owned ctf2.manageProxy` } }
}

async function readTool(config: PlatformConfig, name: string, args: Record<string, string>): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(proxyUrl(config), { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: name, method: 'tools/call', params: { name, arguments: args } }), signal: AbortSignal.timeout(config.timeoutMs ?? 10_000) })
  } catch { throw new Error((await proxyHealth(config)).state) }
  const text = await response.text()
  if (!response.ok) throw new Error(`CTF2 proxy/upstream HTTP ${response.status}; refresh OAuth or check platform availability; no challenge verdict was recorded`)
  const data = text.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).filter(line => line && line !== '[DONE]')
  const envelopes = data.length ? data.map(line => JSON.parse(line)) : [JSON.parse(text)]
  const envelope = envelopes.find(item => item.id === name) ?? envelopes.at(-1)
  if (envelope?.error || envelope?.result?.isError) throw new Error(`CTF2 read-only ${name} failed; check OAuth, challenge/ground ids and platform state`)
  const result = envelope?.result
  let facts = result?.structuredContent
  if (!facts) {
    const raw = result?.content?.find((entry: { type: string; text?: string }) => entry.type === 'text' && entry.text)?.text
    if (raw) { try { facts = JSON.parse(raw) } catch {} }
  }
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) throw new Error(`CTF2 ${name} did not return structured facts; preflight stays blocked`)
  return facts as Record<string, unknown>
}

/** Allowlisted read-only calls only; unknown schema fields remain unknown. */
export async function readPlatformSnapshot(config: PlatformConfig, ground: string, challengeId?: string): Promise<NonNullable<TeamState['platformSnapshot']>> {
  if (challengeId && !ground) throw new Error('practice_ground_id is required for challenge/environment checks')
  const who = await readTool(config, 'ctf2_agent_whoami', {})
  const snapshot: NonNullable<TeamState['platformSnapshot']> = { checkedAt: Date.now(), challengeId }
  const user = (who.agent ?? who.user ?? who) as Record<string, unknown>
  if (typeof user.active_environments === 'number' && Number.isInteger(user.active_environments) && user.active_environments >= 0) snapshot.activeEnvironments = user.active_environments
  if (challengeId) {
    const where = { practice_ground_id: ground, challenge_id: challengeId }
    const challenge = await readTool(config, 'ctf2_get_practice_challenge', where)
    const details = (challenge.challenge ?? challenge) as Record<string, unknown>
    if (typeof details.is_solved === 'boolean') snapshot.isSolved = details.is_solved
    const environment = await readTool(config, 'ctf2_get_environment', where)
    const env = (environment.environment ?? environment) as Record<string, unknown>
    if (typeof env.access_ready === 'boolean') snapshot.accessReady = env.access_ready
    if (typeof env.running === 'boolean') snapshot.targetRunning = env.running
    else if (typeof env.status === 'string' && ['running', 'stopped', 'deleted', 'exited'].includes(env.status.toLowerCase())) snapshot.targetRunning = env.status.toLowerCase() === 'running'
  }
  snapshot.checkedAt = Date.now()
  return snapshot
}

/** Shared infrastructure belongs to the host. Team deletion never controls this process. */
export function installProxySupervisor(ctx: Context, config: PlatformConfig = {}): void {
  if (!config.manageProxy) return
  const url = proxyUrl(config)
  if (!config.credentialDir || !isAbsolute(config.credentialDir)) throw new Error('managed proxy needs an absolute ctf2.credentialDir (OAuth files stay outside the package)')
  ctx.effect(() => {
    let disposed = false, owned: ChildProcess | undefined, timer: ReturnType<typeof setTimeout> | undefined, restarts = 0
    const schedule = () => {
      if (disposed || restarts >= (config.maxRestarts ?? 3)) return
      restarts++
      timer = setTimeout(() => { void start() }, config.restartDelayMs ?? 3000)
      timer.unref()
    }
    const start = async () => {
      if (disposed) return
      if ((await proxyHealth(config)).up || disposed) return // Existing external proxies are never owned or killed.
      owned = spawn(process.execPath, [fileURLToPath(new URL('../scripts/ctf2-mcp-proxy.mjs', import.meta.url)), '--port', url.port || '80', '--host', url.hostname], { env: { ...process.env, CTF2_OAUTH_DIR: config.credentialDir }, stdio: 'ignore', windowsHide: true })
      let settled = false
      const finish = () => { if (settled) return; settled = true; owned = undefined; if (!disposed) { ctx.logger.warn('ctf-teams: managed CTF2 proxy unavailable; bounded restart policy applies'); schedule() } }
      owned.once('error', finish)
      owned.once('exit', finish)
    }
    void start()
    return () => { disposed = true; if (timer) clearTimeout(timer); owned?.kill() }
  })
}

/** Docker execution owns only labelled containers and a dedicated workspace subtree. */
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile, rename, realpath, lstat, readdir, open } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute, sep, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TeamState } from './types.ts'
import { withTeamLock } from './state.ts'

export const TOOLKIT_VERSION = '0.1.36'
export const DEFAULT_CTF_IMAGE = 'dsh-ctf-tools:0.1.36'
export interface ExecutionConfig {
  backend?: 'docker' | 'native'
  image?: string
  autoBuild?: boolean
  memoryMb?: number
  cpus?: number
}
export interface RuntimeScope {
  key: string; container: string; workspace: string; host_workdir: string; state_dir: string
}
export interface RuntimeJob {
  id: string; owner: string; task_id?: string; attempt_id?: string; command: string
  status: string; started_at: number; exit_code?: number | null
  stdout?: string; stderr?: string; stdout_path?: string; stderr_path?: string
  experiment_ref?: string
}
interface RuntimeState { version: 1; scope: RuntimeScope; image: string; image_id: string; container_id: string; container_started_at?: string; jobs: RuntimeJob[]; paused: boolean }
interface RunResult { code: number; stdout: string; stderr: string }
const runner = fileURLToPath(new URL('../assets/ctf', import.meta.url))
const controllers = new Map<string, AbortController>()
const privateInput = /^(?:\.git|\.dsh|\.ctf2-agent|\.ctf-teams(?:-runtime|-work)?|\.agent-teams|oauth-token\.json)$/i

/** No host shell, no model-supplied Docker flags, bounded output, and real cancellation. */
export function dockerCommand(argv: readonly string[], options: { signal?: AbortSignal; timeoutMs?: number; input?: string } = {}): Promise<RunResult> {
  options.signal?.throwIfAborted()
  return new Promise((done, reject) => {
    const child = spawn('docker', [...argv], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = '', failed: Error | undefined
    const add = (value: string, next: Buffer) => (value + next.toString('utf8')).slice(-256_000)
    child.stdout.on('data', value => { out = add(out, value) })
    child.stderr.on('data', value => { err = add(err, value) })
    const cancel = () => { failed = new Error('Docker operation cancelled'); child.kill() }
    options.signal?.addEventListener('abort', cancel, { once: true })
    const timer = setTimeout(() => { failed = new Error('Docker operation timed out'); child.kill() }, options.timeoutMs ?? 30_000)
    child.once('error', error => { failed = error })
    child.once('close', code => {
      clearTimeout(timer); options.signal?.removeEventListener('abort', cancel)
      failed ? reject(failed) : done({ code: code ?? -1, stdout: out, stderr: err })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(options.input)
  })
}
async function required(argv: readonly string[], options: Parameters<typeof dockerCommand>[1] = {}): Promise<string> {
  const result = await dockerCommand(argv, options)
  if (result.code !== 0) throw new Error(`Docker ${argv[0]} failed: ${(result.stderr || result.stdout).trim().slice(-4000)}`)
  return result.stdout.trim()
}
function digest(text: string): string { return createHash('sha256').update(text).digest('hex') }
export function runtimeScope(workspace: string, team: Pick<TeamState, 'id' | 'captainSessionId' | 'boardId' | 'createdAt'>): RuntimeScope {
  const absolute = resolve(workspace), canonical = process.platform === 'win32' ? absolute.toLowerCase() : absolute
  const key = digest(`${canonical}\0${team.captainSessionId}\0${team.id}\0${team.boardId ?? team.createdAt}`).slice(0, 32)
  return { key, container: `ctft-${key}`, workspace: absolute, host_workdir: join(absolute, '.ctf-teams-work', key), state_dir: join(absolute, '.ctf-teams-runtime', key) }
}
async function safeDirectory(root: string, target: string): Promise<void> {
  const rel = relative(root, target)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Runtime directory escaped workspace')
  let current = root
  for (const component of rel.split(sep).filter(Boolean)) {
    current = join(current, component)
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Runtime paths must not contain symlinks or junctions') }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  await mkdir(target, { recursive: true })
  const actual = await realpath(target), base = await realpath(root)
  const actualRel = relative(base, actual)
  if (actualRel.startsWith('..') || isAbsolute(actualRel)) throw new Error('Runtime directory resolved outside workspace')
}
async function load(scope: RuntimeScope): Promise<RuntimeState | undefined> {
  try {
    const value = JSON.parse(await readFile(join(scope.state_dir, 'runtime.json'), 'utf8')) as RuntimeState
    if (value.version !== 1 || value.scope.key !== scope.key || value.scope.container !== scope.container
      || value.scope.host_workdir !== scope.host_workdir || value.scope.state_dir !== scope.state_dir
      || !/^sha256:[a-f0-9]{64}$/.test(value.image_id) || !/^[a-f0-9]{64}$/.test(value.container_id)
      || !Array.isArray(value.jobs) || value.jobs.some(job => !/^[a-f0-9-]{36}$/.test(job.id) || typeof job.owner !== 'string')) throw new Error('Invalid runtime state')
    return value
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
}
async function save(state: RuntimeState): Promise<void> {
  await safeDirectory(state.scope.workspace, state.scope.state_dir)
  const file = join(state.scope.state_dir, 'runtime.json'), temp = `${file}.${randomUUID()}.tmp`
  const durable = { ...state, jobs: state.jobs.map(({ stdout: _stdout, stderr: _stderr, ...job }) => job) }
  await writeFile(temp, JSON.stringify(durable, null, 2) + '\n'); await rename(temp, file)
}
interface ContainerInfo { Id: string; Image: string; Config: { Labels?: Record<string, string> }; State: { Running: boolean; StartedAt: string } }
async function inspect(scope: RuntimeScope): Promise<ContainerInfo | undefined> {
  const result = await dockerCommand(['container', 'inspect', scope.container])
  if (result.code !== 0) {
    if (/No such (?:object|container)/i.test(result.stderr)) return undefined
    throw new Error(`Docker unavailable: ${result.stderr.trim().slice(-2000)}`)
  }
  const info = JSON.parse(result.stdout)[0] as ContainerInfo
  if (info.Config.Labels?.['io.ctf-teams.owner'] !== scope.key) throw new Error('Container name belongs to another owner; no action taken')
  return info
}
export async function runtimeStatus(scope: RuntimeScope): Promise<Record<string, unknown>> {
  const saved = await load(scope)
  try {
    const engine = JSON.parse(await required(['version', '--format', '{{json .Server}}']))
    const info = await inspect(scope)
    return { backend: 'docker', engine: engine.Version, ...scope, container_workdir: '/work', prepared: !!info, running: info?.State.Running ?? false, paused: saved?.paused ?? false, image: saved?.image ?? DEFAULT_CTF_IMAGE, image_id: saved?.image_id, job_count: saved?.jobs.length ?? 0, jobs: (saved?.jobs ?? []).slice(-20).map(job => ({ ...job, command: job.command.slice(0, 240) })) }
  } catch (error) { return { backend: 'docker', ...scope, prepared: false, running: false, error: String(error), next_action: 'Start Docker Desktop (Linux containers) and retry runtime prepare. No native fallback was used.', job_count: saved?.jobs.length ?? 0 } }
}
export async function prepareRuntime(scope: RuntimeScope, config: ExecutionConfig, signal: AbortSignal, admit: () => Promise<void>): Promise<RuntimeState> {
  return withTeamLock(`container:${scope.key}`, async () => {
    await admit(); signal.throwIfAborted()
    const image = config.image || DEFAULT_CTF_IMAGE
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,255}$/.test(image)) throw new Error('Invalid configured image reference')
    let imageResult = await dockerCommand(['image', 'inspect', image], { signal })
    if (imageResult.code !== 0) {
      // Check the engine separately: do not misdiagnose an unavailable daemon as a missing image.
      await required(['version', '--format', '{{.Server.Version}}'], { signal })
      if (image !== DEFAULT_CTF_IMAGE || config.autoBuild === false) throw new Error(`Image ${image} is missing. Build the shipped runtime Dockerfile or install the configured image; no native fallback.`)
      await required(['build', '--file', join(runner, 'runtime', 'Dockerfile'), '--tag', image, runner], { signal, timeoutMs: 3_600_000 })
      imageResult = await dockerCommand(['image', 'inspect', image], { signal })
    }
    if (imageResult.code !== 0) throw new Error('Unable to inspect runtime image')
    const imageInfo = JSON.parse(imageResult.stdout)[0]
    if (imageInfo.Config?.Labels?.['io.ctf-teams.runtime'] !== '1') throw new Error('Configured image lacks the CTF runtime protocol label')
    await admit(); signal.throwIfAborted()
    await safeDirectory(scope.workspace, scope.host_workdir)
    await safeDirectory(scope.workspace, scope.state_dir)
    let info = await inspect(scope), state = await load(scope)
    if (info && (!state || info.Id !== state.container_id || info.Image !== state.image_id)) throw new Error('Container identity drift; stop and inspect it explicitly. Existing files were preserved.')
    if (!info) {
      if (state && state.jobs.some(job => job.status === 'running')) {
        for (const job of state.jobs) if (job.status === 'running') job.status = 'interrupted'
      }
      const id = await required(['run', '--detach', '--init', '--name', scope.container,
        '--label', `io.ctf-teams.owner=${scope.key}`, '--label', 'io.ctf-teams.runtime=1',
        '--cap-drop', 'ALL', '--cap-add', 'SETUID', '--cap-add', 'SETGID', '--cap-add', 'CHOWN', '--cap-add', 'KILL', '--security-opt', 'no-new-privileges=true',
        '--memory', `${config.memoryMb ?? 2048}m`, '--cpus', String(config.cpus ?? 2), '--pids-limit', '1024',
        '--env', `CTF_UID=${process.getuid?.() || 1000}`, '--env', `CTF_GID=${process.getgid?.() || 1000}`,
        '--mount', `type=bind,"source=${scope.host_workdir.replaceAll('"', '""')}",target=/work`, imageInfo.Id], { signal })
      state = { version: 1, scope, image, image_id: imageInfo.Id, container_id: id, jobs: state?.jobs ?? [], paused: false }
      // Commit ownership before returning; shutdown/halt can now find the container.
      await save(state); info = await inspect(scope)
    }
    if (!state || !info) throw new Error('Container preparation did not complete')
    if (!info.State.Running || state.container_started_at && state.container_started_at !== info.State.StartedAt) {
      for (const job of state.jobs) if (['running', 'starting'].includes(job.status)) job.status = 'interrupted'
    }
    if (!info.State.Running) {
      await admit(); await required(['start', scope.container], { signal })
      info = await inspect(scope)
    }
    state.container_started_at = info?.State.StartedAt
    await required(['exec', '--user', '0', scope.container, 'python3', '/opt/ctf-teams/job.py', 'identity'], { signal })
    state.paused = false; await save(state)
    await admit()
    return state
  })
}
async function jobControl(scope: RuntimeScope, action: string, id: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
  return JSON.parse(await required(['exec', '--user', '0', scope.container, 'python3', '/opt/ctf-teams/job.py', action, id], { signal }))
}
async function exportLogs(state: RuntimeState, job: RuntimeJob): Promise<void> {
  const dir = join(state.scope.state_dir, 'jobs', job.id)
  await safeDirectory(state.scope.workspace, dir)
  for (const stream of ['stdout', 'stderr'] as const) {
    const destination = join(dir, stream + '.log')
    const copied = await dockerCommand(['cp', `${state.scope.container}:/var/lib/ctf-teams/jobs/${job.id}/${stream}.log`, destination])
    if (copied.code === 0) job[`${stream}_path`] = destination
  }
}
export async function readRuntimeJob(scope: RuntimeScope, id: string, owner: string, captain: boolean, signal?: AbortSignal): Promise<RuntimeJob> {
  return withTeamLock(`container:${scope.key}`, async () => {
    const state = await load(scope), job = state?.jobs.find(item => item.id === id)
    if (!state || !job || (!captain && job.owner !== owner)) throw new Error('Unknown or unowned runtime job')
    const info = await inspect(scope)
    if (info && info.Id !== state.container_id) throw new Error('Runtime container identity changed')
    if (state.container_started_at && info?.State.StartedAt !== state.container_started_at && ['running', 'starting'].includes(job.status)) job.status = 'interrupted'
    if (['running', 'starting'].includes(job.status) && info?.State.Running) {
      const result = await jobControl(scope, 'status', id, signal)
      job.status = String(result.status); job.stdout = String(result.stdout ?? ''); job.stderr = String(result.stderr ?? '')
      job.exit_code = typeof result.exit_code === 'number' ? result.exit_code : null
    } else if (['running', 'starting'].includes(job.status)) job.status = 'interrupted'
    if (job.status !== 'running' && job.status !== 'starting' && info) await exportLogs(state, job)
    for (const stream of ['stdout', 'stderr'] as const) {
      const log = job[`${stream}_path`]
      if (!job[stream] && log) {
        const file = await open(log, 'r')
        try {
          const size = (await file.stat()).size, buffer = Buffer.alloc(Math.min(16_000, size))
          await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length))
          job[stream] = buffer.toString('utf8')
        } finally { await file.close() }
      }
    }
    await save(state)
    return { ...job }
  })
}
export async function executeRuntime(scope: RuntimeScope, config: ExecutionConfig, input: { command: string; workdir?: string; timeoutMs?: number; waitMs?: number; owner: string; taskId?: string; attemptId?: string; beforeLaunch?: (id: string, timeout: number) => Promise<{ timeoutMs: number; experimentRef?: string }> }, signal: AbortSignal, admit: () => Promise<void>): Promise<RuntimeJob> {
  if (!input.command.trim() || Buffer.byteLength(input.command, 'utf8') > 100_000) throw new Error('command must contain 1..100000 UTF-8 bytes; store larger scripts in files')
  const workdir = input.workdir ?? '.'
  if (workdir.includes('\\') || posix.isAbsolute(workdir) || workdir.split('/').includes('..') || /[\x00-\x1f]/.test(workdir)) throw new Error('workdir must be a relative container path beneath /work')
  const timeout = input.timeoutMs ?? 300_000, wait = input.waitMs ?? 1000
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 3_600_000 || !Number.isInteger(wait) || wait < 0 || wait > 30_000) throw new Error('Invalid timeout_ms or wait_ms')
  await prepareRuntime(scope, config, signal, admit)
  const id = randomUUID()
  await withTeamLock(`container:${scope.key}`, async () => {
    await admit(); signal.throwIfAborted()
    const state = await load(scope)
    if (!state || state.paused) throw new Error('Runtime is paused')
    const admission = await input.beforeLaunch?.(id, timeout) ?? { timeoutMs: timeout }
    const job: RuntimeJob = { id, owner: input.owner, command: input.command, status: 'running', started_at: Date.now(), task_id: input.taskId, attempt_id: input.attemptId, experiment_ref: admission.experimentRef }
    state.jobs.push(job); await save(state)
    try {
      await required(['exec', '--interactive', '--user', '0', scope.container, 'python3', '/opt/ctf-teams/job.py', 'start', id], { signal, input: JSON.stringify({ command: input.command, cwd: posix.join('/work', workdir), timeout: admission.timeoutMs / 1000 }) })
    } catch (error) {
      // A cancelled client can have delivered start. Stop the whole owned container
      // before reporting a failed launch; never leave an untracked execution.
      await dockerCommand(['stop', '--time', '2', scope.container]); job.status = 'interrupted'; state.paused = true; await save(state); throw error
    }
  })
  let cancellation: Promise<unknown> | undefined
  const abort = () => { cancellation = cancelRuntimeJob(scope, id, input.owner, false).catch(() => undefined) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    const until = Date.now() + wait
    do {
      signal.throwIfAborted()
      const job = await readRuntimeJob(scope, id, input.owner, false, signal)
      if (job.status !== 'running' && job.status !== 'starting' || Date.now() >= until) return job
      await new Promise<void>(done => setTimeout(done, 100))
    } while (true)
  } finally {
    signal.removeEventListener('abort', abort)
    if (signal.aborted) await (cancellation ?? cancelRuntimeJob(scope, id, input.owner, false).catch(() => undefined))
  }
}
export async function cancelRuntimeJob(scope: RuntimeScope, id: string, owner: string, captain: boolean): Promise<RuntimeJob> {
  return withTeamLock(`container:${scope.key}`, async () => {
    const state = await load(scope), job = state?.jobs.find(item => item.id === id)
    if (!state || !job || (!captain && job.owner !== owner)) throw new Error('Unknown or unowned runtime job')
    const info = await inspect(scope)
    if (job.status === 'running' && info?.State.Running) await jobControl(scope, 'cancel', id)
    if (job.status === 'running') job.status = 'cancelled'
    if (info) await exportLogs(state, job)
    await save(state); return { ...job }
  })
}
export async function pauseTeamRuntime(workspace: string, team: TeamState): Promise<{ stopped: boolean; error?: string }> {
  const scope = runtimeScope(workspace, team)
  controllers.get(scope.key)?.abort()
  return withTeamLock(`container:${scope.key}`, async () => {
    const state = await load(scope)
    if (!state) return { stopped: false }
    try {
      const info = await inspect(scope)
      if (info && info.Id !== state.container_id) throw new Error('Container identity drift; refusing to stop an unknown container')
      if (info?.State.Running) await required(['stop', '--time', '2', scope.container], { timeoutMs: 15_000 })
      state.paused = true
      for (const job of state.jobs) {
        if (job.status === 'running' || job.status === 'starting') job.status = 'interrupted'
        if (info) await exportLogs(state, job)
      }
      await save(state); return { stopped: !!info }
    } catch (error) { return { stopped: false, error: String(error) } }
  })
}
export async function cancelMemberRuntimeJobs(workspace: string, team: TeamState, owner: string, taskId?: string): Promise<void> {
  const scope = runtimeScope(workspace, team), state = await load(scope)
  for (const job of state?.jobs ?? []) {
    if (job.owner === owner && (!taskId || job.task_id === taskId) && ['running', 'starting'].includes(job.status)) await cancelRuntimeJob(scope, job.id, owner, false)
  }
}
/** Stage explicit attachments only. No full workspace, credentials, or Docker socket mounts. */
export async function stageRuntimeInput(scope: RuntimeScope, source: string, destination?: string): Promise<{ host_path: string; container_path: string; files: number }> {
  const src = resolve(scope.workspace, source), rel = relative(scope.workspace, src)
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).some(name => privateInput.test(name))) throw new Error('Input must be an explicit non-private workspace path')
  let parent = scope.workspace
  for (const part of rel.split(sep)) {
    parent = join(parent, part)
    if ((await lstat(parent)).isSymbolicLink()) throw new Error('Input path must not traverse symlinks/junctions')
  }
  const targetRel = destination ?? posix.join('input', rel.split(sep).join('/'))
  if (posix.isAbsolute(targetRel) || targetRel.includes('\\') || targetRel.split('/').some(name => name === '..' || name === '') || /[\x00-\x1f]/.test(targetRel)) throw new Error('Invalid input destination')
  const target = resolve(scope.host_workdir, ...targetRel.split('/'))
  let files = 0
  async function copy(from: string, to: string): Promise<void> {
    const info = await lstat(from)
    if (info.isSymbolicLink()) throw new Error('Input symlinks/junctions are not imported')
    if (info.isDirectory()) {
      await safeDirectory(scope.workspace, to)
      for (const entry of await readdir(from)) {
        if (privateInput.test(entry)) throw new Error('Private directories cannot be imported')
        await copy(join(from, entry), join(to, entry))
      }
    } else if (info.isFile()) {
      if (++files > 10_000) throw new Error('Input exceeds 10000 files; stage a smaller directory')
      await safeDirectory(scope.workspace, resolve(to, '..'))
      try { await lstat(to); throw new Error('Input destination already exists; choose another destination to preserve existing work') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      await copyFile(from, to)
    } else throw new Error('Only regular files/directories can be imported')
  }
  // Reject source parent junctions as well as the final input itself.
  const actual = await realpath(src), root = await realpath(scope.workspace)
  if (relative(root, actual).startsWith('..') || isAbsolute(relative(root, actual))) throw new Error('Input resolves outside workspace')
  await copy(src, target)
  return { host_path: target, container_path: posix.join('/work', targetRel), files }
}
export function runtimeController(scope: RuntimeScope): AbortController {
  let controller = controllers.get(scope.key)
  if (!controller || controller.signal.aborted) { controller = new AbortController(); controllers.set(scope.key, controller) }
  return controller
}

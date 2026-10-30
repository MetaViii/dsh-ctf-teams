/** Model-facing container entry points; all calls re-enter normal DSH tool policy. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { TeamState } from './types.ts'
import { relative, resolve, isAbsolute, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ResearchHooks } from './research-tools.ts'
import { detectTools, TOOL_SPECS } from './env.ts'
import { DEFAULT_CTF_IMAGE, dockerCommand, executeRuntime, prepareRuntime, runtimeController, runtimeScope, runtimeStatus, stageRuntimeInput, readRuntimeJob, cancelRuntimeJob, pauseTeamRuntime, type ExecutionConfig } from './docker-runtime.ts'

export interface ExecutionAccess { agent: Agent; team: TeamState; owner: string; captain: boolean; workspace: string; taskId?: string; attemptId?: string }
export type AuthorizeExecution = (exec: ToolRunContext, options?: { mutate?: boolean; taskId?: string; attemptId?: string; command?: boolean; updateState?: (access: ExecutionAccess) => boolean }) => Promise<ExecutionAccess>
const runtimeOwners = new WeakMap<AuthorizeExecution, Map<string, ExecutionAccess>>()

export const DOCKER_EXECUTION_PROMPT = `CTF execution defaults to Docker. After creating the team, use ctf_teams_runtime(action="prepare") to prepare the shipped ${DEFAULT_CTF_IMAGE} toolchain. Use ctf_teams_exec for ALL solving commands (Bash syntax), including Python, Sage, debugger and network tools; never silently fall back to pwsh/bash/ops_bash on the host. Runtime preparation may build the image on first use. No Docker image means an environment blocker, not a reason to reinstall host dependencies. ctf_teams_runtime(action="status") is read-only and never starts a container.
The runtime returns host_workdir and container_workdir=/work. Stage explicit existing attachments with runtime(action="import",source="workspace-relative/path"); the receipt identifies the container path. Write solve scripts with the normal file tools under host_workdir, and execute those relative paths in /work. Only this dedicated work subtree is mounted; Windows paths and host-local proxy URLs do not become container paths or endpoints. Keep separate per-member script/output names and use shared/ for explicit handoffs. Native reference/platform helpers remain host-managed; the captain uses ctf_teams_ctf2 for the CTF2 proxy, listings, attachment URLs, target lifecycle and explicit submissions. Its connect action uses existing host OAuth files without mounting them in Docker. Never mount the Docker socket or read host credentials into a challenge container.
Members must pass task_id and the current attempt_id to ctf_teams_exec. A running result has job_id: poll with runtime(action="job",job_id=...), or cancel your own job explicitly. wait_ms controls only the foreground wait; timeout_ms is the command deadline. Large output is saved as full host log files on completion/pause; the returned text is a bounded tail. Detached services belong in a background job with a foreground service command. Team pause stops the whole owned container, preserving workspace and logs; resume does not replay old commands or automatically restart background services. Recheck the checkpoint and rerun the necessary service after explicit team resume. Container tools, files and reports are not independent proof of a solve.`

/** Read the same effective host policy as native shell tools. No fallback on service errors. */
export function requireExecutionPolicy(agent: Agent): void {
  const policy = agent.ctx.get('sandboxPolicy') as unknown as { resolve(input: { session: Agent['session'] }): { mode: string } } | undefined
  if (!policy || typeof policy.resolve !== 'function') throw new Error('Docker execution requires the host sandboxPolicy service; no permission bypass was used')
  const mode = policy.resolve({ session: agent.session }).mode
  if (mode !== 'workspace-write' && mode !== 'danger-full-access') throw new Error('Docker execution is disabled by the current read-only/unknown permission mode. It does not escalate permissions automatically.')
}

function json(value: unknown): Record<string, JsonValue> { return JSON.parse(JSON.stringify(value)) as Record<string, JsonValue> }
function result(value: object, scope: ReturnType<typeof runtimeScope>): Record<string, JsonValue> {
  const entry = value as Record<string, unknown>
  const withId = entry.id && 'status' in entry ? { ...entry, job_id: entry.id } : value
  return json({ backend: 'docker', host_workdir: scope.host_workdir, container_workdir: '/work', ...withId })
}
function render(value: Record<string, JsonValue>): string {
  return JSON.stringify(value, null, 2)
}

export function registerExecutionTools(ctx: Context, config: ExecutionConfig, authorize: AuthorizeExecution, research?: ResearchHooks): void {
  const owned = new Map<string, ExecutionAccess>()
  runtimeOwners.set(authorize, owned)
  async function access(exec: ToolRunContext, mutate = false, taskId?: string, attemptId?: string, command = false) {
    if (config.backend === 'native') throw new Error('Advanced native backend is configured. Use the composed native shell tools and explicit local/WSL env checks.')
    const value = await authorize(exec, { mutate, taskId, attemptId, command })
    if (mutate) requireExecutionPolicy(value.agent)
    const scope = runtimeScope(value.workspace, value.team)
    const controller = runtimeController(scope)
    const signal = AbortSignal.any([exec.signal, controller.signal])
    const admit = async () => { await authorize(exec, { mutate: true, taskId, attemptId, command }); requireExecutionPolicy(value.agent) }
    if (mutate) owned.set(scope.key, value)
    return { value, scope, signal, admit }
  }
  ctx.tools.register(defineTool({
    name: 'ctf_teams_runtime',
    description: 'Manage the Docker solving runtime. status never starts/builds. prepare checks/builds the shipped toolchain and starts only this team container. import copies an explicit workspace attachment into its persistent workdir without overwriting. job reads durable job output; cancel stops an owned job. Team pause is managed by the dashboard, not this tool. Native execution is an advanced deployment configuration.',
    parameters: {
      action: { type: 'string', enum: ['status', 'prepare', 'import', 'job', 'cancel'] },
      source: { type: 'string', description: 'import: workspace-relative regular file/directory, no credential/state directories.' },
      destination: { type: 'string', description: 'import: new relative path below /work; existing files never overwritten.' },
      job_id: { type: 'string', description: 'job/cancel: exact returned job_id.' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: (_args, value) => [{ type: 'text', text: render(value) }] },
    async execute(args, exec) {
      const action = args.action ?? 'status', mutate = action === 'prepare' || action === 'import'
      const a = await access(exec, mutate)
      if (action === 'status') return json(await runtimeStatus(a.scope))
      if (action === 'job' || action === 'cancel') {
        if (!args.job_id) throw new Error('job_id is required')
        return result(action === 'job'
          ? await readRuntimeJob(a.scope, args.job_id, a.value.owner, a.value.captain, exec.signal)
          : await cancelRuntimeJob(a.scope, args.job_id, a.value.owner, a.value.captain), a.scope)
      }
      if (action === 'import') {
        if (!args.source) throw new Error('source is required')
        await a.admit()
        return result(await stageRuntimeInput(a.scope, args.source, args.destination), a.scope)
      }
      await prepareRuntime(a.scope, config, a.signal, a.admit)
      return json(await runtimeStatus(a.scope))
    },
  }))
  ctx.tools.register(defineTool({
    name: 'ctf_teams_exec',
    description: 'Execute a Bash command in this team Docker runtime. Returns job_id/status/exit_code and bounded stdout/stderr plus full log paths when complete. Files under /work persist at host_workdir. Default wait_ms=1000, timeout_ms=300000; wait_ms=0 starts a background job without automatic model wakeups. A nonzero exit is a real command outcome, not a solve. No host shell fallback. Members must provide their current task_id and attempt_id.',
    parameters: {
      command: { type: 'string', required: true },
      workdir: { type: 'string', description: 'Relative directory beneath /work; default dot. Use the normal file tools to create scripts in host_workdir.' },
      task_id: { type: 'string' }, attempt_id: { type: 'string' },
      experiment_ref: { type: 'string', description: 'Optional generation-bound experiment plan reference; a focused route stays gated when omitted. Run/time budgets apply before launch.' },
      timeout_ms: { type: 'number', description: 'Command deadline, integer 1..3600000.' },
      wait_ms: { type: 'number', description: 'Foreground wait, integer 0..30000; running jobs continue until deadline/pause/cancel.' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: (_args, value) => [{ type: 'text', text: render(value) }] },
    presentCall: args => ({ card: 'terminal', title: args.command, cwd: args.workdir ?? '/work' }),
    async execute(args, exec) {
      const a = await access(exec, true, args.task_id, args.attempt_id, true)
      await research?.check(exec, args.task_id, args.attempt_id, args.experiment_ref)
      const job = await executeRuntime(a.scope, config, { command: args.command, workdir: args.workdir, timeoutMs: args.timeout_ms, waitMs: args.wait_ms, owner: a.value.owner, taskId: a.value.taskId, attemptId: a.value.attemptId,
        beforeLaunch: research ? (id, timeout) => research.reserve(exec, id, timeout, args.task_id, args.attempt_id, args.experiment_ref) : undefined }, a.signal, a.admit)
      return result({ ...job }, a.scope)
    },
  }))
  ctx.effect(() => async () => {
    await Promise.allSettled([...owned.values()].map(a => pauseTeamRuntime(a.workspace, a.team)))
  }, 'ctf-teams: Docker jobs shutdown')
}

export async function checkDockerEnvironment(exec: ToolRunContext, config: ExecutionConfig, authorize: AuthorizeExecution, tools?: readonly string[]): Promise<Record<string, JsonValue>> {
  const a = await authorize(exec, { mutate: true }); requireExecutionPolicy(a.agent)
  const scope = runtimeScope(a.workspace, a.team)
  runtimeOwners.get(authorize)?.set(scope.key, a)
  const signal = AbortSignal.any([exec.signal, runtimeController(scope).signal])
  const admit = async () => { await authorize(exec, { mutate: true }); requireExecutionPolicy(a.agent) }
  await prepareRuntime(scope, config, signal, admit)
  const statuses = await detectTools({ platform: 'linux', python: 'python3', tools, runner: async (argv, timeoutMs) => {
    await admit()
    return dockerCommand(['exec', '--user', String(process.getuid?.() || 1000), scope.container, ...argv], { signal, timeoutMs })
  } })
  return json({ action: 'check', runtime: 'docker', runtime_ready: true, python: 'python3 (container PATH)', inspection_scope: 'Managed catalog in the exact Docker solving runtime; not a complete inventory and not proof every target can run.', host_workdir: scope.host_workdir, container_workdir: '/work', unknown: (tools ?? []).filter(name => !TOOL_SPECS.some(spec => spec.name === name)), statuses: statuses.map(s => ({ ...s, install_hint: s.installHint })) })
}

export function bashQuote(text: string): string { return "'" + text.replaceAll("'", "'\\''") + "'" }

export async function dockerImageAnalysis(exec: ToolRunContext, config: ExecutionConfig, authorize: AuthorizeExecution, args: { image: string; compare?: string; action?: string; width?: number }): Promise<string> {
  const a = await authorize(exec, { mutate: true }); requireExecutionPolicy(a.agent)
  const scope = runtimeScope(a.workspace, a.team)
  runtimeOwners.get(authorize)?.set(scope.key, a)
  const signal = AbortSignal.any([exec.signal, runtimeController(scope).signal])
  const admit = async () => { await authorize(exec, { mutate: true }); requireExecutionPolicy(a.agent) }
  async function imagePath(image: string): Promise<string> {
    const absolute = resolve(a.workspace, image), rel = relative(scope.host_workdir, absolute)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel.split('\\').join('/')
    const staged = await stageRuntimeInput(scope, image, `input/vision/${randomUUID()}/${basename(image)}`)
    return staged.container_path
  }
  const image = await imagePath(args.image), compare = args.compare ? await imagePath(args.compare) : undefined
  const argv = ['python3', '/opt/ctf-teams/image_to_text.py', '--workspace', '/work', '--image', image, '--action', args.action ?? 'ascii']
  if (compare) argv.push('--compare', compare)
  if (args.width !== undefined) {
    if (!Number.isInteger(args.width) || args.width < 8 || args.width > 160) throw new Error('width must be an integer from 8 to 160')
    argv.push('--width', String(args.width))
  }
  const job = await executeRuntime(scope, config, { command: argv.map(bashQuote).join(' '), timeoutMs: 30_000, waitMs: 30_000, owner: a.owner, taskId: a.taskId, attemptId: a.attemptId }, signal, admit)
  if (job.status !== 'completed' || job.exit_code !== 0) throw new Error(`Container image analysis ${job.status}: ${job.stderr || job.stdout || job.id}`)
  return job.stdout?.trim() ?? ''
}

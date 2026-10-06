/**
 * CTFTeams for DeepSeek Harness.
 *
 * A host-plane plugin that registers the `ctf_teams_*` tools and one
 * agent-scoped usage section. Each session keeps a stable tool set and core
 * instructions. After installation any session can solve a CTF challenge
 * with a multi-agent squad through natural language (e.g. "/ctf-teams solve
 * http://chal:8000"): the model becomes the captain, records the challenge
 * context, spawns a squad of full-stack CTF experts as durable continuable
 * subagents, breaks the attack into a task graph,
 * syncs findings every round, tracks candidate flags on a shared board, and
 * renders the whole solve as a terminal dashboard in the transcript.
 *
 * Installation (bundle): `dsh plugin --profile <name> add dsh-ctf-teams`
 * (or a local path). The bundle patch mounts this plugin row into the host
 * composition; the tools register into the shared `tools` registry and the
 * usage section into the global system prompt, so the plugin needs no realm.
 *
 * @module dsh-ctf-teams
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  registerCTFTeamsTools,
  type ToolsConfig,
} from './tools.ts'
import {
  installCTFTeamsGestureBoundary,
  registerCTFTeamsCommand,
  registerCTFTeamsBoardCommand,
} from './command.ts'
import { formatProfilesForPrompt, type TeamProfileConfig } from './profiles.ts'
import { installDashboardRoute } from './dashboard-route.ts'
import { installTeamCapabilities } from './capabilities.ts'
import { TEAM_TOOL_NAMES } from './tool-names.ts'
import { CTF_PROFILE_NAME, withBuiltinCtfProfile } from './ctf-profile.ts'
import { WRITEUP_COMPLETION } from './writeup.ts'

export const name = 'ctf-teams'
export const inject = ['tools', 'llm', 'subagents', 'systemPrompt', 'agents']

/** Plugin configuration. */
export interface Config {
  /**
   * State directory name under the captain's workspace; team state lives at
   * `<workspace>/<stateDir>/<teamId>/` (default `.ctf-teams`).
   */
  stateDir?: string
  /** `ctx.subagents` provider used to spawn members; must support continuable children and personas (default `spawn`). */
  memberProvider?: string
  /** Optional model override applied to every member. */
  memberModel?: string
  /** Prompt injected into member personas and automatic task assignments. */
  executionPrompt?: string
  /** Plugin-wide fallback route for unavailable member models. */
  fallback?: import('./profiles.ts').TeamModelFallbackConfig
  /** Member delegation depth cap (default `0`; `0` forbids delegation entirely). */
  memberMaxDepth?: number
  /** Team size cap in members (default `8`). */
  maxMembers?: number
  /** Named multi-role team profiles; they override the built-in on name collision. */
  profiles?: Record<string, TeamProfileConfig>
  /**
   * Profile applied when `ctf_teams_create` is called without `profile` or
   * `plan` (default `ctf-teams`, the shipped CTF squad). Set to an empty
   * string to disable the default and require an explicit choice.
   */
  defaultProfile?: string
  /** Toolchain service options for `ctf_teams_env` (detect + install). */
  env?: {
    /** Allow the install action to execute (default `true`; `false` keeps dry-run only). */
    allowInstall?: boolean
    /** Per-probe timeout in ms (default `10000`). */
    probeTimeoutMs?: number
    /** Per-install-command timeout in ms (default `300000`). */
    installTimeoutMs?: number
    /** Explicit Python launcher (default: `python3`, `python` on Windows). */
    pythonBin?: string
  }
  /** References library options for `ctf_teams_references`. */
  references?: {
    /**
     * Clone reference repos automatically when a team is created so the
     * PoC/CVE collections are already on disk (`small`: ctf-skills +
     * awesome-poc, the default; `all`: every manifest repo including the
     * multi-GB ones; `off`). Already-provisioned repos are never touched.
     */
    autoSync?: 'off' | 'small' | 'all'
    /** Shallow-clone depth (default `1`). */
    depth?: number
    /** Directory name under the state root (default `references`). */
    dirName?: string
    /** Per git command timeout in ms (default `600000`). */
    timeoutMs?: number
  }
  /** Prompt-section order for the usage policy (default `117`, after delegation policy). */
  promptSectionOrder?: number
  /**
   * Register the deterministic `/ctf-teams` activation surfaces (the
   * closed-namespace slash command and the plain-text gesture boundary).
   * Disable to keep the natural-language trigger as the only entry point.
   */
  slashCommand?: boolean
  /**
   * Register `/ctf-teams-board`, the harness-native dashboard command that
   * prints the solving panel straight into the transcript without waking the
   * model (default on).
   */
  boardCommand?: boolean
}

// `z.object()` has an implicit `{}` default in Schemastery.  Fallback routes
// are optional, so model absence explicitly; otherwise a missing route is
// validated as an empty object and fails on the required provider/model keys.
const fallbackRouteConfig = z.union([
  z.object({ provider: z.string().required(), model: z.string().required() }),
  z.const(undefined),
])

export const Config: z<Config> = z.object({
  stateDir: z.string().default('.ctf-teams'),
  memberProvider: z.string().default('spawn'),
  memberModel: z.string(),
  executionPrompt: z.string(),
  fallback: fallbackRouteConfig,
  profiles: z.dict(z.object({
    description: z.string(),
    protocol: z.string(),
    executionPrompt: z.string(),
    fallback: fallbackRouteConfig,
    members: z.array(z.object({
      name: z.string().required(),
      role: z.string(),
      provider: z.string(),
      model: z.string(),
      reasoning_effort: z.string(),
      executionPrompt: z.string(),
      fallback: fallbackRouteConfig,
    })).min(1).required(),
    taskPlanning: z.union([z.const('captain'), z.const('seed')]),
    reviewPolicy: z.object({
      requirementsMinRounds: z.natural().min(1),
      requirementsMaxRounds: z.natural().min(1),
      codeMaxRounds: z.natural().min(1),
      maxRepairAttempts: z.natural().min(1),
      requiredReviewers: z.array(z.string()),
    }),
    tasks: z.array(z.object({
      id: z.string().required(),
      subject: z.string().required(),
      description: z.string(),
      assignee: z.string(),
      dependencies: z.array(z.string()),
    })),
  })).default({}),
  defaultProfile: z.string().default(CTF_PROFILE_NAME),
  env: z.object({
    allowInstall: z.boolean().default(true),
    probeTimeoutMs: z.natural().default(10_000),
    installTimeoutMs: z.natural().default(300_000),
    pythonBin: z.string(),
  }),
  references: z.object({
    autoSync: z.union([z.const('off'), z.const('small'), z.const('all')]),
    depth: z.natural().default(1),
    dirName: z.string().default('references'),
    timeoutMs: z.natural().default(600_000),
  }),
  memberMaxDepth: z.natural().default(0),
  maxMembers: z.natural().min(1).default(8),
  promptSectionOrder: z.natural().default(117),
  slashCommand: z.boolean().default(true),
  boardCommand: z.boolean().default(true),
})

/** The model-facing usage policy: when and how to drive CTFTeams. */
export function usageSectionText(toolNames: string, profilesText = ''): string {
  return `CTFTeams captain protocol (multiple agents solving one CTF challenge together):
1. Inspect current team state when needed with ctf_teams_status. Continue existing work without duplicating its roster/tasks. Create only when no current team exists, with the challenge as description and approval="required"; automatic approval requires an explicit request to run immediately. The default profile "${CTF_PROFILE_NAME}" supplies a squad of interchangeable full-stack CTF experts (agent-1..agent-4, every domain) racing the same challenge from parallel angles; the task graph is yours (captain planning). Staged plans never spawn or schedule work.
2. Record the challenge before dispatching work: ctf_teams_set_challenge with title, category, points, attachments, remote endpoint, and the competition's flag format. Members see it on the dashboard and in every digest; flag submissions validate against that format.
3. Prepare the toolbox once, before the lanes need it: ctf_teams_env (action=check) detects the local toolchain (pwntools, volatility3, sage, kali tooling, …) with versions; missing pieces install with ctf_teams_env (action=install) — use dry_run=true to review the plan first, and let heavy tools (sage, ghidra, pwndbg) follow their reported manual path. The reference library (PoC/CVE/skill repos) auto-syncs its small entries at team creation; sync more with ctf_teams_references (action=sync, repo=ctf-skills,awesome-poc or repo=all — huge repos are GB-scale, so sync them only when a lane actually needs them) — every agent must rg the local references under <stateDir>/references/ before hunting online.
4. Build the complete smallest useful DAG while staged. One recon/triage task first; then parallel tasks per attack angle (agents are interchangeable full-stack experts, so assign by angle, not by specialist); then convergence (flag verification + WRITEUP.md). Pass roster and dependency graph together in create({plan:{members,tasks}}) to avoid repeated setup rounds. Every task needs a subject. Present the plan and end your turn for review; never approve in that planning turn.
5. Round sync is the coordination contract: members publish findings with ctf_teams_report_finding and pull ctf_teams_sync; the scheduler attaches new findings to every assignment and pushes digests to idle members. You monitor the board via ctf_teams_status. When a dead-end finding invalidates a lane, re-plan with ctf_teams_edit_plan: add tasks for the new attack path instead of messaging members to "start" work.
6. Flags are evidence-gated: candidates arrive via ctf_teams_submit_flag (members must include evidence). Verify each against the competition platform yourself, then record the verdict with ctf_teams_mark_flag — verified marks the challenge solved and redirects every lane to the writeup. Never claim solved without the platform accepting; never mark a claim verified without checking; rejected candidates keep hunting.
7. The scheduler dispatches ready tasks after approval. Delegate; do not duplicate slow work or send messages merely to start a stage. Handle reports/user work, then yield when waiting is all that remains: reports wake you automatically. Use status after a delivery or user request, never busy-poll or wait for unassigned members.
8. Tasks carry attempt_id capabilities. Use the current attempt_id; stale means ownership changed. Pause members only on explicit request; later guidance via send_message continues that same attempt. Retry, transfer or take over through reassign_task first; it revokes the old attempt and waits for quiescence. Prefer a member. Captain implementation/review takeover requires a user request. Every takeover is one ready task at a time, finished in this turn; never yield with captain-owned work open.
9. In a running team, correct never-started pending tasks with edit_plan update_task; preserve dependency and ownership contracts instead of cancelling and recreating the graph. A captain can cancel a never-started pending task directly. Quality kinds (requirements, implementation, verification, review, repair, integration) require objective + acceptance; implementation/repair also require inScope + verify. Review/requirements complete only with verdict=pass; needs_revision/reject fail with findings. Never approve your own implementation. Do not recreate the review loop, omit integration, or depend on a failed task. When a quality contract itself is wrong, fix it with ctf_teams_amend_task — captain-only, non-terminal tasks only, recorded in the task's revisions ledger — instead of letting the worker dead-lock.
10. Halted means the user stopped work (including the captain turn). Resume only on a later explicit user request with a reason, via ctf_teams_resume or create_task({resume:true,resumeReason}); creating tasks alone never resumes. Escalated means the review loop hit its limit, not a halt.
11. Completion: all required tasks terminal and members idle/ready — present the verified flag, the writeup path, and the final board, then let the user clean the team up (the 解题面板 has 删除战队 / 清空归档 for that) unless they want to continue. Never discard unfinished work without authorization. The writeup is a CTF solve record a reader can replay: real commands and raw output, the payload, the flag, the dead ends in one line — no tooling/agent/model/platform talk and no remediation advice. ${WRITEUP_COMPLETION}
Tools: ${toolNames}${profilesText === '' ? '' : `\n\n${profilesText}`}`
}

export function apply(ctx: Context, config: Config): void {
  // The built-in ctf-teams squad ships under the user's own profiles; exact
  // name collisions resolve to the user's definition.
  const profiles = withBuiltinCtfProfile(config.profiles)
  const resolved: ToolsConfig = {
    stateDir: config.stateDir ?? '.ctf-teams',
    memberProvider: config.memberProvider ?? 'spawn',
    memberModel: config.memberModel,
    executionPrompt: config.executionPrompt,
    fallback: config.fallback,
    memberMaxDepth: config.memberMaxDepth ?? 0,
    maxMembers: config.maxMembers ?? 8,
    profiles,
    defaultProfile: config.defaultProfile?.trim() || undefined,
    env: {
      allowInstall: config.env?.allowInstall ?? true,
      probeTimeoutMs: config.env?.probeTimeoutMs ?? 10_000,
      installTimeoutMs: config.env?.installTimeoutMs ?? 300_000,
      ...config.env?.pythonBin === undefined ? {} : { pythonBin: config.env.pythonBin },
    },
    references: {
      ...config.references?.autoSync === undefined ? {} : { autoSync: config.references.autoSync },
      depth: config.references?.depth ?? 1,
      dirName: config.references?.dirName ?? 'references',
      timeoutMs: config.references?.timeoutMs ?? 600_000,
    },
  }

  // Provider registration is a sibling plugin's effect (`subagent-spawn` /
  // `subagent-fork` rows), which can land after this mount under the Loader's
  // concurrent activation — so capability validation happens at the first
  // member spawn (`spawnMember`), the earliest point the provider list is
  // settled, rather than here.

  const ctfTeamsRuntime = registerCTFTeamsTools(ctx, resolved)
  installTeamCapabilities(ctx, {
    stateDir: resolved.stateDir,
    isPendingMember: ctfTeamsRuntime.isPendingMember,
    order: config.promptSectionOrder,
    // Keep the bounded profile directory available without extra tool calls.
    // installTeamCapabilities snapshots this once; no business state rewrites it.
    captainPrompt: () => usageSectionText(TEAM_TOOL_NAMES.join(', '), formatProfilesForPrompt(profiles)),
  })

  // The Web dashboard tab: its read-only state route plus the trust-fenced
  // action / export / files endpoints. Lazily registered: a headless profile
  // mounts no Web server, where this stays a no-op.
  installDashboardRoute(ctx, { stateDir: resolved.stateDir, profiles: Object.keys(profiles) })

  // Deterministic activation surfaces: the closed-namespace `/ctf-teams`
  // host command (surfaces in the slash menu via the Harness ui-commands
  // client) and the plain-text gesture boundary for surfaces without command
  // adjudication (headless CLI). Both default on; a profile can disable them
  // to keep the natural-language trigger exclusive.
  //
  // `commands` is registered lazily (not a required inject): it ships in the
  // base bundle of every standard profile, but a minimal composition that
  // omits the command registry keeps the plugin fully functional — the fiber
  // never pends on it and simply never gains the slash command.
  if (config.slashCommand ?? true) {
    ctx.inject(['commands'], (commandCtx) => {
      registerCTFTeamsCommand(commandCtx, () => profiles, { defaultProfile: resolved.defaultProfile })
      if (config.boardCommand ?? true) {
        registerCTFTeamsBoardCommand(commandCtx, resolved.stateDir)
      }
    })
    installCTFTeamsGestureBoundary(ctx, () => profiles)
  }
}

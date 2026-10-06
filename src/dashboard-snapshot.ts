/**
 * Server-side assembly of the CTFTeams dashboard snapshot.
 *
 * The dashboard view in the Web client is a pure renderer over this payload:
 * durable team files are the truth source (a model that skipped a tool
 * "ritual" cannot desync the panel), enriched with live subagent activity and
 * mailbox depth, exactly like the terminal panel rendered by
 * `ctf_teams_status`. `nextStep` is computed with the same
 * {@link nextStepHint} the text panel uses, so the tab and the transcript can
 * never disagree about what should happen next.
 *
 * @module dsh-ctf-teams/dashboard-snapshot
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import {
  CAPTAIN_KEY,
  listArchivedTeamIds,
  readArchivedTeam,
  readTeam,
  readUnreadMailbox,
  taskDepthsById,
  taskVisualState,
} from './state.ts'
import { memberActivity } from './members.ts'
import { challengeOf } from './findings.ts'
import { readCursor } from './findings.ts'
import { dashboardInputFromTeam, nextStepHint } from './dashboard.ts'
import { directoryUsage } from './state.ts'
import type { ChallengeInfo, FlagCandidate, TeamFinding, TeamState } from './types.ts'

/** One lane as the dashboard renders it. */
export interface DashboardMemberRow {
  id: string
  name: string
  role: string
  provider: string
  model: string
  reasoningEffort: string
  status: string
  /** `working` | `idle` | `ready` | `unspawned` | `removed`. */
  activity: string
  /** Unseen board beats (findings + flags) for this lane. */
  behind: number
  /** Unread mailbox messages. */
  unread: number
  /** The open task this lane owns, as `t3 subject`. */
  currentTask: string
  done: number
  total: number
}

/** One task row. */
export interface DashboardTaskRow {
  id: string
  subject: string
  description: string
  status: string
  /** `open` | `blocked` | `running` | `completed` | `failed` | `cancelled`. */
  state: string
  assignee: string
  dependencies: string[]
  depth: number
  updatedAt: number
  kind?: string
  round?: number
  verdict?: string
  objective?: string
  acceptance?: string[]
  inScope?: string[]
  verify?: string[]
}

/** Everything the dashboard tab needs for one team. */
export interface DashboardTeamSnapshot {
  teamId: string
  name: string
  description?: string
  workspace: string
  workspaceTitle: string
  captainSessionId: string
  /** How the requesting session relates to this team. */
  role: 'captain' | 'member' | 'bystander'
  /** True for a team read from `archive/`: its history is final. */
  archived: boolean
  /** Files under the team directory (what a delete would remove). */
  fileCount: number
  /** Bytes under the team directory (what a delete would free). */
  diskBytes: number
  phase: string
  halted: boolean
  escalated: boolean
  round: number
  createdAt: number
  lastBeatAt?: number
  solved: boolean
  challenge: ChallengeInfo
  nextStep: string
  members: DashboardMemberRow[]
  tasks: DashboardTaskRow[]
  findings: TeamFinding[]
  flags: FlagCandidate[]
  captainUnread: number
  counts: {
    members: number
    working: number
    tasks: number
    done: number
    active: number
    pending: number
    findings: number
    flags: number
    verified: number
  }
}

/** The whole route payload. */
export interface DashboardPayload {
  generatedAt: number
  sessionId?: string
  workspace?: string
  /** True for the `?archived=1` roster of finished teams. */
  archived: boolean
  /** Configured team profile names the panel's start form can select. */
  profiles: string[]
  teams: DashboardTeamSnapshot[]
}

/** One workspace scanned by the route. */
export interface DashboardRoot {
  /** Absolute workspace path (the client's matching key). */
  path: string
  /** Human-facing workspace title. */
  title: string
}

/** Session-shaped input: only the id and the workspace path are read. */
export interface DashboardSessionRef {
  id: string
  cwd?: string
}

function currentTaskOf(memberName: string, tasks: TeamState['tasks']): string {
  for (const task of tasks) {
    if (task.assignee === memberName && (task.status === 'claimed' || task.status === 'in_progress')) {
      return `${task.id} ${task.subject}`
    }
  }
  return ''
}

function roleOf(team: TeamState, sessionId: string | undefined): 'captain' | 'member' | 'bystander' {
  if (sessionId === undefined || sessionId === '') return 'bystander'
  if (team.captainSessionId === sessionId) return 'captain'
  return team.members.some((member) => member.id === sessionId) ? 'member' : 'bystander'
}

/**
 * Assemble one team's dashboard snapshot from its durable record plus live
 * activity. Never throws on partial state: an unreadable mailbox counts as
 * empty so the panel keeps rendering.
 * @param ctx - plugin context (injects `agents`).
 * @param root - the owning workspace.
 * @param stateRoot - absolute state root of that workspace.
 * @param team - the durable team record.
 * @param options - `archived` renders a historic, activity-free snapshot.
 * @returns the snapshot the Web dashboard renders.
 */
export async function assembleDashboardTeam(
  ctx: Context,
  root: DashboardRoot,
  stateRoot: string,
  team: TeamState,
  options: { sessionId?: string; archived?: boolean } = {},
): Promise<DashboardTeamSnapshot> {
  const tasks = team.tasks
  const depths = taskDepthsById(tasks)
  const roster = team.members.filter((member) => member.status !== 'removed')
  // Live activity is an enrichment: a host without the agent registry (or a
  // damaged one) must still render the durable team rather than drop it.
  let activity = new Map<string, 'running' | 'idle' | 'ready'>()
  if (options.archived !== true) {
    try {
      activity = memberActivity(ctx, roster.map((member) => member.id))
    } catch (error: unknown) {
      ctx.logger.warn(`ctf-teams: live member activity unavailable: ${String(error)}`)
    }
  }

  const members: DashboardMemberRow[] = []
  for (const member of roster) {
    let unread = 0
    try {
      unread = (await readUnreadMailbox(stateRoot, team.id, member.name)).length
    } catch (error: unknown) {
      ctx.logger.warn(`ctf-teams: mailbox read failed for ${member.name}: ${String(error)}`)
    }
    const cursor = readCursor(team, member.name)
    const behind = Math.max(
      (team.findingSeq ?? 0) - cursor.findingSeq,
      (team.flagSeq ?? 0) - cursor.flagSeq,
    )
    const owned = tasks.filter((task) => task.assignee === member.name)
    const done = owned.filter((task) => task.status === 'completed').length
    const live = member.id === '' ? 'unspawned' : activity.get(member.id) === 'running' ? 'working' : 'idle'
    members.push({
      id: member.id,
      name: member.name,
      role: member.role ?? '',
      provider: member.provider ?? '',
      model: member.model ?? '',
      reasoningEffort: member.reasoningEffort ?? '',
      status: member.status,
      activity: live,
      behind,
      unread,
      currentTask: currentTaskOf(member.name, tasks),
      done,
      total: owned.length,
    })
  }

  let captainUnread = 0
  try {
    captainUnread = (await readUnreadMailbox(stateRoot, team.id, CAPTAIN_KEY)).length
  } catch (error: unknown) {
    ctx.logger.warn(`ctf-teams: captain mailbox read failed: ${String(error)}`)
  }

  const challenge = challengeOf(team)
  const phase = team.halted === true ? 'halted' : team.escalated === true ? 'escalated' : team.phase ?? 'running'
  const openTaskByMember = new Map<string, string>()
  for (const member of members) {
    if (member.currentTask !== '') openTaskByMember.set(member.name, member.currentTask)
  }
  const memberBehind = new Map<string, number>(members.map((member) => [member.name, member.behind]))
  const completed = tasks.filter((task) => task.status === 'completed').length
  const active = tasks.filter((task) => task.status === 'claimed' || task.status === 'in_progress').length
  const pending = tasks.filter((task) => task.status === 'pending').length
  const stamps = [
    ...(team.findings ?? []).map((finding) => finding.ts),
    ...(team.flags ?? []).map((flag) => flag.ts),
    ...tasks.map((task) => task.updatedAt),
  ].filter((stamp) => Number.isFinite(stamp))

  const dashboardInput = dashboardInputFromTeam(team, {
    activity: new Map(members.filter((member) => member.id !== '').map((member) => [member.id, member.activity])),
    memberBehind,
    captainUnread,
    openTaskByMember,
  })
  const usage = await directoryUsage(join(stateRoot, team.id))

  return {
    teamId: team.id,
    name: team.name,
    ...team.description === undefined ? {} : { description: team.description },
    workspace: root.path,
    workspaceTitle: root.title,
    captainSessionId: team.captainSessionId,
    role: roleOf(team, options.sessionId),
    archived: options.archived === true,
    fileCount: usage.files,
    diskBytes: usage.bytes,
    phase,
    halted: team.halted === true,
    escalated: team.escalated === true,
    round: team.round ?? 0,
    createdAt: team.createdAt,
    ...stamps.length === 0 ? {} : { lastBeatAt: Math.max(...stamps) },
    solved: challenge.solved === true,
    challenge,
    nextStep: nextStepHint(dashboardInput),
    members,
    tasks: tasks.map((task) => ({
      id: task.id,
      subject: task.subject,
      description: task.description ?? '',
      status: task.status,
      state: taskVisualState(task.status, task.dependencies, tasks),
      assignee: task.assignee ?? '',
      dependencies: [...task.dependencies],
      depth: depths.get(task.id) ?? 0,
      updatedAt: task.updatedAt,
      ...task.kind === undefined ? {} : { kind: task.kind },
      ...task.round === undefined ? {} : { round: task.round },
      ...task.verdict === undefined ? {} : { verdict: task.verdict },
      ...task.objective === undefined ? {} : { objective: task.objective },
      ...task.acceptance === undefined ? {} : { acceptance: [...task.acceptance] },
      ...task.inScope === undefined ? {} : { inScope: [...task.inScope] },
      ...task.verify === undefined ? {} : { verify: [...task.verify] },
    })),
    findings: team.findings ?? [],
    flags: team.flags ?? [],
    captainUnread,
    counts: {
      members: members.length,
      working: members.filter((member) => member.activity === 'working').length,
      tasks: tasks.length,
      done: completed,
      active,
      pending,
      findings: team.findings?.length ?? 0,
      flags: team.flags?.length ?? 0,
      verified: (team.flags ?? []).filter((flag) => flag.status === 'verified').length,
    },
  }
}

/** Read the team directories under one workspace's state root. */
async function listTeamIds(stateRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(stateRoot, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
      .map((entry) => entry.name)
      .sort()
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

/**
 * Collect the live teams of every given workspace root.
 * @param ctx - plugin context.
 * @param roots - workspace roots to scan.
 * @param stateDir - state directory name under each workspace.
 * @param options - the requesting session id.
 * @returns one snapshot per readable team, ordered by workspace then team id.
 */
export async function collectDashboardTeams(
  ctx: Context,
  roots: readonly DashboardRoot[],
  stateDir: string,
  options: { sessionId?: string } = {},
): Promise<DashboardTeamSnapshot[]> {
  const teams: DashboardTeamSnapshot[] = []
  for (const root of roots) {
    const stateRoot = join(root.path, stateDir)
    for (const teamId of await listTeamIds(stateRoot)) {
      try {
        const team = await readTeam(stateRoot, teamId)
        if (team === undefined) continue
        teams.push(await assembleDashboardTeam(ctx, root, stateRoot, team, { sessionId: options.sessionId }))
      } catch (error: unknown) {
        ctx.logger.warn(`ctf-teams: skipped unreadable team "${teamId}" in "${root.path}": ${String(error)}`)
      }
    }
  }
  return teams
}

/**
 * Collect archived teams (the `archive/` subdirectory of each state root), so
 * a finished solve stays reviewable in the dashboard after deletion.
 * @param ctx - plugin context.
 * @param roots - workspace roots to scan.
 * @param stateDir - state directory name under each workspace.
 * @param options - the requesting session id.
 * @returns one snapshot per archived team.
 */
export async function collectArchivedDashboardTeams(
  ctx: Context,
  roots: readonly DashboardRoot[],
  stateDir: string,
  options: { sessionId?: string } = {},
): Promise<DashboardTeamSnapshot[]> {
  const teams: DashboardTeamSnapshot[] = []
  for (const root of roots) {
    const stateRoot = join(root.path, stateDir)
    const archiveRoot = join(stateRoot, 'archive')
    for (const teamId of await listArchivedTeamIds(stateRoot)) {
      try {
        const team = await readArchivedTeam(stateRoot, teamId)
        if (team === undefined) continue
        teams.push(await assembleDashboardTeam(ctx, root, archiveRoot, team, { sessionId: options.sessionId, archived: true }))
      } catch (error: unknown) {
        ctx.logger.warn(`ctf-teams: skipped unreadable archived team "${teamId}" in "${root.path}": ${String(error)}`)
      }
    }
  }
  return teams
}

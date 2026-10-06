import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { parseProfileInvocation, resolveProfileTaskPlanning, type TeamProfileConfig, type CTFTeamsInvocation } from './profiles.ts'
import { CAPTAIN_KEY, readTeamSync, sanitizeKey } from './state.ts'
import { memberActivity } from './members.ts'
import { dashboardInputFromTeam, renderDashboard, renderDashboardHeader } from './dashboard.ts'
import type { TeamState } from './types.ts'

export const CTF_TEAMS_COMMAND = 'ctf-teams'
const PROFILE_COMMAND_PREFIX = `${CTF_TEAMS_COMMAND}-`

/**
 * Command names this plugin owns outright. A generated profile alias may never
 * take one of these: `/ctf-teams` is the generic activation and
 * `/ctf-teams-board` is the dashboard, so a team profile literally named
 * `board` must not turn into a second dashboard row in the command menu.
 */
export const RESERVED_COMMAND_NAMES: readonly string[] = [CTF_TEAMS_COMMAND, `${CTF_TEAMS_COMMAND}-board`]

/** Registration options for {@link registerCTFTeamsCommand}. */
export interface CTFTeamsCommandOptions {
  /**
   * Profile the generic `/ctf-teams` command runs when it omits `--profile`.
   * Its generated alias (`/ctf-teams-<name>`) would be the very same activation
   * under a longer name, so it is left unregistered; profile aliases stay for
   * the other profiles, which the generic command cannot select on its own.
   */
  defaultProfile?: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'ctf-teams-command': { readonly kind: 'ctf-teams-command'; readonly goal?: string; readonly profile?: string }
  }
}

const GESTURE = /^\/ctf-teams(?=$|[\t\n\r ])/u

/**
 * Convert a configured profile key into a stable, closed-namespace command
 * suffix. Only lowercase ASCII letters, digits and dashes are representable;
 * this deliberately prevents accidental command aliases for ambiguous profile
 * names such as `foo bar`, `foo_bar`, or non-ASCII keys.
 */
export function profileCommandName(profileName: string): string | undefined {
  const normalized = profileName.trim().toLowerCase()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(normalized)) return undefined
  return `${PROFILE_COMMAND_PREFIX}${normalized}`
}

/** Resolve a profile command only when it maps uniquely to a live profile. */
function profileForCommand(commandName: string, profiles: Record<string, TeamProfileConfig>): string | undefined {
  const matches = Object.keys(profiles).filter((profileName) => profileCommandName(profileName) === commandName)
  return matches.length === 1 ? matches[0] : undefined
}

/** Parse either the generic command or one generated profile alias. */
function parseCommandText(text: string, profiles: Record<string, TeamProfileConfig>): CTFTeamsInvocation | undefined {
  const trimmed = text.trimStart()
  if (GESTURE.test(trimmed)) return parseProfileInvocation(trimmed.slice(CTF_TEAMS_COMMAND.length + 1).trim())
  if (!trimmed.startsWith(`/${PROFILE_COMMAND_PREFIX}`)) return undefined
  const tokenEnd = trimmed.search(/[\t\n\r ]/u)
  const commandName = trimmed.slice(1, tokenEnd === -1 ? undefined : tokenEnd)
  const profile = profileForCommand(commandName, profiles)
  if (profile === undefined) return undefined
  return { profile, goal: (tokenEnd === -1 ? '' : trimmed.slice(tokenEnd)).trim() }
}

export function invokedCTFTeamsInvocation(messages: readonly UserMessage[], getProfiles: () => Record<string, TeamProfileConfig> = () => ({})): CTFTeamsInvocation | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined || message.source.kind !== 'user') continue
    for (const block of message.content) {
      if (block.type !== 'text') continue
      const invocation = parseCommandText(block.text, getProfiles())
      if (invocation !== undefined) return invocation
    }
  }
  return undefined
}

export function invokedCTFTeamsGoal(messages: readonly UserMessage[]): string | undefined {
  return invokedCTFTeamsInvocation(messages)?.goal
}

/**
 * The directive injected when the user triggers `/ctf-teams`.
 * @param goal - the challenge text the user supplied.
 * @param profile - a team profile the user named, when any.
 * @param taskPlanning - the profile's planning mode.
 * @param autoApprove - true when teams run without a review step (the default):
 *   the directive then asks for `approval="automatic"` and tells the captain not
 *   to stop for approval.
 */
export function buildActivationDirective(
  goal: string,
  profile?: string,
  taskPlanning: 'captain' | 'seed' = 'captain',
  autoApprove = true,
): string {
  const lines = [
    'The user invoked a CTFTeams slash command. Follow the CTFTeams protocol already in your system instructions. Inspect existing team state with ctf_teams_status when needed.',
    'Respect the current team state. Continue an existing plan or team without recreating it.',
  ]
  if (autoApprove) {
    lines.push(
      'Only when no current team exists, call ctf_teams_create with approval="automatic" — the user has asked to be left out of the approval step, so the plan you submit IS the plan that runs. Do not stage it, do not ask for review, and do not wait for a confirmation turn.',
      'Build the complete roster and DAG in that one call, then immediately dispatch: work through ready tasks and member reports until a flag is verified and the writeup exists. Never end the solve while open tasks or live lanes remain.',
    )
  } else {
    lines.push(
      'Only when no current team exists, call ctf_teams_create with approval="required". Build the complete staged roster and DAG, then stop and ask the user to review the staged plan. Do not approve or start it in this same turn.',
    )
  }
  if (profile === undefined) {
    lines.push(
      'No profile was named: the configured default profile (the built-in ctf-teams squad) applies automatically — do not pass plan={members,tasks} for the roster it already supplies.',
      autoApprove
        ? 'Derive the smallest useful task graph from the goal in the same call as create: one recon/triage task first, then parallel per-domain tasks for what recon finds, then flag verification and the writeup.'
        : 'Derive the smallest useful task graph from the goal while the team is staged: one recon/triage task first, then parallel per-domain tasks for what recon finds, then flag verification and the writeup.',
    )
  } else {
    lines.push(`Use profile="${profile}" when creating a new team.`)
    if (taskPlanning === 'captain') {
      lines.push(
        'This profile supplies the roster and guardrails. After create, do not recreate members.',
        autoApprove
          ? 'Derive the smallest useful task graph from the goal in the same call as create; do not ask the user whether to split, merge, serialize, or parallelize.'
          : 'Derive the smallest useful task graph from the goal while the team is staged; do not ask the user whether to split, merge, serialize, or parallelize.',
        'Independent supplemental work must become separate ready tasks so idle members can run in parallel. Add dependencies only for genuine prerequisites and later synthesis.',
      )
    } else {
      lines.push('Do not recreate the same members or seed tasks manually.')
    }
  }
  lines.push(goal === '' ? 'The goal was not given — ask the user what the team should accomplish.' : `Goal: ${goal}`)
  return lines.join('\n')
}

export function registerCTFTeamsCommand(
  ctx: Context,
  getProfiles: () => Record<string, TeamProfileConfig> = () => ({}),
  options: CTFTeamsCommandOptions = {},
): void {
  ctx.effect(() => {
    const dispose: Array<() => void> = []
    const defaultProfile = options.defaultProfile?.trim()
    dispose.push(ctx.commands.register({
      name: CTF_TEAMS_COMMAND,
      description: 'solve a CTF challenge with a multi-agent squad (you become the captain)',
      input: { hint: '[--profile <name>] <challenge>' },
      handler(invocation: CommandInvocation): CommandResult {
        let parsed: CTFTeamsInvocation
        try { parsed = parseProfileInvocation(invocation.rawInput.trim()) } catch (error: unknown) { return { kind: 'error', text: String(error) } }
        if (parsed.profile !== undefined && !Object.keys(getProfiles()).some(key => key.trim() === parsed.profile)) return { kind: 'error', text: `unknown CTFTeams profile "${parsed.profile}"` }
        if (parsed.profile === undefined && parsed.goal === '') return { kind: 'error', text: `Usage: /${CTF_TEAMS_COMMAND} [--profile <name>] <challenge>` }
        invocation.agent.followup(createUserMessage({ content: [{ type: 'text', text: `/${CTF_TEAMS_COMMAND}${invocation.rawInput}` }], source: { kind: 'user' } }))
        return { kind: 'success', text: `CTFTeams activated${parsed.profile === undefined ? '' : ` with profile ${parsed.profile}`} — the captain will assemble the team.` }
      },
    }))
    for (const profileName of Object.keys(getProfiles())) {
      const commandName = profileCommandName(profileName)
      if (commandName === undefined) continue
      // Two generated names are deliberately skipped: the default profile's
      // alias repeats what the generic command already does, and a reserved
      // name belongs to this plugin's own commands.
      if (defaultProfile !== undefined && profileName.trim() === defaultProfile) continue
      if (RESERVED_COMMAND_NAMES.includes(commandName)) continue
      dispose.push(ctx.commands.register({
        name: commandName,
        description: `run a goal with the CTFTeams ${profileName} profile`,
        input: { hint: '<goal>' },
        handler(invocation: CommandInvocation): CommandResult {
          const profile = profileForCommand(commandName, getProfiles())
          if (profile === undefined) return { kind: 'error', text: `CTFTeams profile command "/${commandName}" is unavailable` }
          invocation.agent.followup(createUserMessage({ content: [{ type: 'text', text: `/${commandName}${invocation.rawInput}` }], source: { kind: 'user' } }))
          return { kind: 'success', text: `CTFTeams activated with profile ${profile} — the captain will assemble the team.` }
        },
      }))
    }
    return () => {
      for (const unregister of dispose.reverse()) unregister()
    }
  }, 'ctf-teams: slash commands')
}

export function installCTFTeamsGestureBoundary(
  ctx: Context,
  getProfiles: () => Record<string, TeamProfileConfig> = () => ({}),
  options: { autoApprove?: boolean } = {},
): void {
  const autoApprove = options.autoApprove ?? true
  ctx.on('agent/pre-step', async ({ messages, signal }, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    let invocation: CTFTeamsInvocation | undefined
    try { invocation = invokedCTFTeamsInvocation(messages, getProfiles) } catch (error: unknown) { return { kind: 'enter', messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text: `CTFTeams profile parsing failed: ${String(error)}` }], source: { kind: 'ctf-teams-command' } })] } }
    if (invocation === undefined) return decision
    signal.throwIfAborted()
    const profiles = getProfiles()
    const matched = invocation.profile === undefined
      ? undefined
      : Object.entries(profiles).find(([key]) => key.trim() === invocation.profile)
    const known = invocation.profile === undefined || matched !== undefined
    const text = !known
      ? `CTFTeams profile "${invocation.profile}" does not exist. Available profiles: ${Object.keys(profiles).join(', ') || '(none)'}. Do not create a team.`
      : buildActivationDirective(invocation.goal, invocation.profile, resolveProfileTaskPlanning(matched?.[1]), autoApprove)
    return { kind: 'enter', messages: [...decision.messages, createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'ctf-teams-command', ...invocation.goal === '' ? {} : { goal: invocation.goal }, ...invocation.profile === undefined ? {} : { profile: invocation.profile } } })] }
  })
}

/**
 * `/ctf-teams-board`: print the solving dashboard straight into the
 * transcript. Pure read — it never wakes the model, spawns work, or mutates
 * state, so the user can check the solve at any moment without burning a
 * captain turn. Works for captains and members alike.
 */
/** Count unread mailbox lines synchronously; best-effort dashboard signal only. */
function countUnreadSync(stateRoot: string, teamId: string, agentKey: string): number {
  let raw: string
  try {
    raw = readFileSync(join(stateRoot, teamId, 'inbox', `${sanitizeKey(agentKey)}.jsonl`), 'utf8')
  } catch {
    return 0
  }
  let count = 0
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    try {
      const value = JSON.parse(line) as { readAt?: number; discardedAt?: number }
      if (value.readAt === undefined && value.discardedAt === undefined) count += 1
    } catch {
      // A malformed line is not an unread message; the board stays readable.
    }
  }
  return count
}

export function registerCTFTeamsBoardCommand(ctx: Context, stateDir: string): void {
  ctx.effect(() => {
    const dispose = ctx.commands.register({
      name: `${CTF_TEAMS_COMMAND}-board`,
      description: 'show the CTFTeams solving dashboard (no model turn)',
      input: { hint: '(no arguments)' },
      handler(invocation: CommandInvocation): CommandResult {
        const agent = invocation.agent
        const workspace = agent?.session.header.cwd ?? process.cwd()
        const stateRoot = join(workspace, stateDir)
        let entries
        try {
          entries = readdirSync(stateRoot, { withFileTypes: true })
        } catch {
          return { kind: 'error', text: `No CTFTeams state under ${stateRoot} — start a team with /${CTF_TEAMS_COMMAND} first.` }
        }
        const teams: { team: TeamState; participating: boolean }[] = []
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name === 'archive') continue
          const team = readTeamSync(stateRoot, entry.name)
          if (team === undefined) continue
          // Show the team this session participates in; a bystander session
          // sees the workspace's latest active team read-only.
          const participating = team.captainSessionId === agent?.id
            || team.members.some((member) => member.id === agent?.id)
          teams.push({ team, participating })
        }
        if (teams.length === 0) {
          return { kind: 'error', text: 'No active CTFTeams team found. Start one with /ctf-teams <challenge>.' }
        }
        const mine = teams.find((entry) => entry.participating) ?? teams[0]
        if (mine === undefined) {
          return { kind: 'error', text: 'No active CTFTeams team found. Start one with /ctf-teams <challenge>.' }
        }
        const team = mine.team
        const activity = memberActivity(ctx, team.members.map((member) => member.id))
        const captainUnread = countUnreadSync(stateRoot, team.id, CAPTAIN_KEY)
        const openTaskByMember = new Map<string, string>()
        for (const task of team.tasks) {
          if (task.assignee === undefined || (task.status !== 'claimed' && task.status !== 'in_progress')) continue
          openTaskByMember.set(task.assignee, `${task.id} ${task.subject}`)
        }
        const panel = renderDashboard(dashboardInputFromTeam(team, {
          activity,
          openTaskByMember,
          captainUnread,
        }))
        return { kind: 'success', text: `${panel}\n\n${renderDashboardHeader(team)}` }
      },
    })
    return () => dispose()
  }, 'ctf-teams: board command')
}

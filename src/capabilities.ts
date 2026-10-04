/** Stable, agent-scoped presentation. Business authority stays in the tools. */
import { onAgentReady } from './harness-compat.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readTeamSync, readRetiredMemberIdsSync } from './state.ts'
import type { TeamState } from './types.ts'
import { MEMBER_TOOL_NAMES, TEAM_TOOL_NAMES } from './tool-names.ts'

export const TEAM_ACTIVATION_PROMPT = 'CTFTeams (CTF Teams) solves one CTF challenge with a multi-agent squad: a captain plus interchangeable full-stack CTF experts (web, pwn, reverse, crypto, forensics, misc) who attack the same challenge from parallel angles, sharing a findings board, a flag board, and a round-sync protocol. Apply these rules when the user requests it (including /ctf-teams) or when continuing an existing team. Mentioning, quoting, discussing, or declining CTFTeams alone is not a request to start work.'
export const TEAM_MEMBER_PROMPT = 'You are a CTFTeams expert agent. Follow your assigned member persona and task contract. Use ctf_teams_claim_task, ctf_teams_update_task, ctf_teams_send_message, ctf_teams_status, ctf_teams_report_finding, ctf_teams_sync, ctf_teams_submit_flag and ctf_teams_knowledge for your own work. Include the current attempt_id in updates; publish findings every round; report completion or failure to the captain. Do not create, approve, edit or resume a team, and do not mark flags verified. If your durable membership is unavailable, report that to the parent instead of creating a replacement.'

interface Exposure {
  member: boolean
  dispose: () => void
}

interface CapabilityConfig {
  stateDir: string
  isPendingMember: (agent: Agent) => boolean
  captainPrompt: () => string
  order?: number
}

function stateRoot(agent: Agent, config: CapabilityConfig): string {
  return join(agent.session.header.cwd ?? process.cwd(), config.stateDir)
}

/** Synchronous startup/HMR hydration must finish before the first assembly. */
function currentTeam(agent: Agent, config: CapabilityConfig): TeamState | undefined {
  const root = stateRoot(agent, config)
  let entries
  try { entries = readdirSync(root, { withFileTypes: true }) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let found: TeamState | undefined
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'archive') continue
    const team = readTeamSync(root, entry.name)
    if (team === undefined || (team.captainSessionId !== agent.id
      && !team.members.some(member => member.id === agent.id))) continue
    if (found !== undefined) throw new Error('ambiguous CTFTeams membership')
    found = team
  }
  return found
}

/** Call once, after all business definitions have registered. Never per member. */
export function installTeamCapabilities(ctx: Context, config: CapabilityConfig): void {
  const states = new WeakMap<Agent, Exposure>()
  const active = new Set<Exposure>()
  let mounted = true
  // Snapshot policy once: profiles, team state, and tool results must never
  // rewrite this prefix or control whether core instructions are available.
  const captainPrompt = `${TEAM_ACTIVATION_PROMPT}\n\n${config.captainPrompt()}`

  function attach(agent: Agent): Exposure {
    const prior = states.get(agent)
    if (prior !== undefined) return prior
    if (!mounted) throw new Error('CTFTeams capability provider is disposed')
    // Determine a member's role before its first request and retain it for the
    // lifetime of this scope. Team creation/archive must never rewrite the
    // captain's system/tools prefix, even after a long ordinary conversation.
    let member = config.isPendingMember(agent)
    try {
      member ||= readRetiredMemberIdsSync(stateRoot(agent, config)).has(agent.id)
      const team = currentTeam(agent, config)
      member ||= team !== undefined && team.captainSessionId !== agent.id
    } catch (error) {
      // Unrelated damaged state must not disable ordinary conversation.
      // Business tools still validate durable team state before acting.
      ctx.logger.warn(`ctf-teams: capability hydration failed: ${String(error)}`)
    }
    const state: Exposure = { member, dispose: () => undefined }
    let revoke: (() => void) | undefined
    let disposed = false
    let releaseLifetime: (() => void) | undefined
    state.dispose = () => {
      if (disposed) return
      disposed = true
      revoke?.()
      releaseLifetime?.()
      states.delete(agent)
      active.delete(state)
    }
    states.set(agent, state)
    active.add(state)
    try {
      if (member) revoke = agent.ctx.tools.restrict({
        deny: TEAM_TOOL_NAMES.filter(name => !MEMBER_TOOL_NAMES.includes(name)),
      })
      releaseLifetime = agent.ctx.effect(() => state.dispose, 'ctf-teams: capability lifetime')
      return state
    } catch (error) { state.dispose(); throw error }
  }

  ctx.systemPrompt.section({
    name: 'ctf-teams:usage', order: config.order ?? 117,
    text: ({ agent }) => {
      return agent !== undefined && states.get(agent)?.member ? TEAM_MEMBER_PROMPT : captainPrompt
    },
  })
  onAgentReady(ctx, agent => { attach(agent) })
  ctx.effect(() => () => {
    mounted = false
    for (const state of [...active]) state.dispose()
  }, 'ctf-teams: capability scopes')
  for (const agent of ctx.agents.list()) attach(agent)
}

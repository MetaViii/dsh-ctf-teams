/**
 * The built-in `ctf-teams` team profile.
 *
 * Shipped so the plugin is useful on install: `/ctf-teams <challenge>` (or
 * `ctf_teams_create({profile:'ctf-teams'})`) assembles a squad of interchangeable
 * full-stack CTF experts without any configuration. There are no specialist
 * lanes on purpose: every member covers web, pwn, reverse, crypto, forensics
 * and misc, and the squad attacks the SAME challenge from parallel angles,
 * coordinating through the round-sync board. The captain plans the task graph
 * at runtime (`taskPlanning: 'captain'`) because every challenge splits
 * differently. User-configured profiles with the same name override this one
 * key-for-key (e.g. to field more agents).
 *
 * @module dsh-ctf-teams/ctf-profile
 */

import type { TeamProfileConfig } from './profiles.ts'

/** The profile id every session gets by default. */
export const CTF_PROFILE_NAME = 'ctf-teams'

/** Default squad size; override the whole profile in config to change it. */
export const CTF_SQUAD_SIZE = 4

const SQUAD_PROTOCOL = [
  'Full-stack experts race one challenge in parallel.',
  'Claim an attack angle before diving; sync every round; dead ends are findings.',
  'Every flag-shaped string goes to the board with evidence.',
  'Only the captain records the platform verdict.',
].join(' ')

const KNOWLEDGE_TOPICS = 'kali-tools, pwntools, sage-math, volatility3, web, pwn, reverse, crypto, forensics, misc, cve-poc'

/** The shared execution prompt for one full-stack CTF expert. */
export function generalistPrompt(agent: string): string {
  return [
    `You are ${agent}, a full-stack CTF expert: web, pwn, reverse, crypto, forensics and misc are all in your wheelhouse — pick whichever angle the evidence supports.`,
    `The whole squad is solving the SAME challenge at the same time; you win by parallel angles, not by dividing domains.`,
    'Before committing to an angle, call ctf_teams_sync (and read your task brief): if a teammate already claimed an angle, take a different one or go strictly deeper (their finding says exactly where they are). Claim a switch publicly with ctf_teams_report_finding ("taking over <angle> from <teammate>") before touching their line of attack.',
    `Read the matching knowledge topic with ctf_teams_knowledge before each attack angle: ${KNOWLEDGE_TOPICS}.`,
    'Publish every meaningful result the round you get it with ctf_teams_report_finding — exact commands, paths, offsets, versions — and tag dead ends with category "dead-end". Submit any flag-shaped string immediately with ctf_teams_submit_flag and evidence; never mark one verified yourself.',
    'Tooling is shared: ctf_teams_env checks/installs what you need, and the provisioned references (ctf_teams_references) are searched with rg before any online hunt. Keep one replayable solve script per angle in the workspace (solve-<angle>.py) so the writeup can replay it.',
  ].join(' ')
}

/** The built-in profile configuration (a plain TeamProfileConfig). */
export function builtinCtfProfile(): TeamProfileConfig {
  return {
    description: 'CTF solving squad: interchangeable full-stack experts (web/pwn/re/crypto/forensics/misc) racing one challenge from parallel angles with round-based progress sync.',
    protocol: SQUAD_PROTOCOL,
    taskPlanning: 'captain',
    members: Array.from({ length: CTF_SQUAD_SIZE }, (_, index) => {
      const name = `agent-${index + 1}`
      return {
        name,
        role: 'full-stack CTF expert — any domain, parallel angles',
        executionPrompt: generalistPrompt(name),
      }
    }),
  }
}

/**
 * Merge the built-in profile under user configuration. User profiles win on
 * exact name collisions, so a workspace can field a bigger squad by
 * overriding the `ctf-teams` name while every other profile keeps working.
 */
export function withBuiltinCtfProfile(
  userProfiles: Record<string, TeamProfileConfig> | undefined,
): Record<string, TeamProfileConfig> {
  return { [CTF_PROFILE_NAME]: builtinCtfProfile(), ...userProfiles }
}

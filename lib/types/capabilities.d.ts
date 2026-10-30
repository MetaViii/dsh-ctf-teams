import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
export declare const TEAM_ACTIVATION_PROMPT = "CTFTeams (CTF Teams) solves one CTF challenge with a multi-agent squad: a captain plus interchangeable full-stack CTF experts (web, pwn, reverse, crypto, forensics, misc) who attack the same challenge from parallel angles, sharing a findings board, a flag board, and a round-sync protocol. Apply these rules when the user requests it (including /ctf-teams) or when continuing an existing team. Mentioning, quoting, discussing, or declining CTFTeams alone is not a request to start work.";
export declare const TEAM_MEMBER_PROMPT = "You are a CTFTeams expert. Follow your task/persona and current attempt_id. Use ctf_teams_hypothesis/experiment for competing explanations, cheap falsifying controls and bounded Docker experiments; inspect logs and report validity. Stop at review/budget boundaries; ask captain to change/reopen the route. Share findings and send one task-scoped report to captain. Never create, approve, edit or resume teams, verify flags, erase failed work or relabel stale attempts. If durable membership is missing, report to parent; never create a replacement.";
interface CapabilityConfig {
    stateDir: string;
    executionBackend?: 'docker' | 'native';
    isPendingMember: (agent: Agent) => boolean;
    captainPrompt: () => string;
    order?: number;
}
/** Call once, after all business definitions have registered. Never per member. */
export declare function installTeamCapabilities(ctx: Context, config: CapabilityConfig): void;
export {};

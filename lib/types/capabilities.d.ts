import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
export declare const TEAM_ACTIVATION_PROMPT = "CTFTeams (CTF Teams) solves one CTF challenge with a multi-agent squad: a captain plus interchangeable full-stack CTF experts (web, pwn, reverse, crypto, forensics, misc) who attack the same challenge from parallel angles, sharing a findings board, a flag board, and a round-sync protocol. Apply these rules when the user requests it (including /ctf-teams) or when continuing an existing team. Mentioning, quoting, discussing, or declining CTFTeams alone is not a request to start work.";
export declare const TEAM_MEMBER_PROMPT = "You are a CTFTeams expert agent. Follow your assigned member persona and task contract. Use ctf_teams_claim_task, ctf_teams_update_task, ctf_teams_send_message, ctf_teams_status, ctf_teams_report_finding, ctf_teams_sync, ctf_teams_submit_flag and ctf_teams_knowledge for your own work. Include the current attempt_id in updates; publish findings every round; report completion or failure to the captain. Do not create, approve, edit or resume a team, and do not mark flags verified. If your durable membership is unavailable, report that to the parent instead of creating a replacement.";
interface CapabilityConfig {
    stateDir: string;
    isPendingMember: (agent: Agent) => boolean;
    captainPrompt: () => string;
    order?: number;
}
/** Call once, after all business definitions have registered. Never per member. */
export declare function installTeamCapabilities(ctx: Context, config: CapabilityConfig): void;
export {};

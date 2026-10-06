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
import type { Context } from '@deepseek-ai/cordis';
import type { ChallengeInfo, FlagCandidate, TeamFinding, TeamState } from './types.ts';
/** One lane as the dashboard renders it. */
export interface DashboardMemberRow {
    id: string;
    name: string;
    role: string;
    provider: string;
    model: string;
    reasoningEffort: string;
    status: string;
    /** `working` | `idle` | `ready` | `unspawned` | `removed`. */
    activity: string;
    /** Unseen board beats (findings + flags) for this lane. */
    behind: number;
    /** Unread mailbox messages. */
    unread: number;
    /** The open task this lane owns, as `t3 subject`. */
    currentTask: string;
    done: number;
    total: number;
}
/** One task row. */
export interface DashboardTaskRow {
    id: string;
    subject: string;
    description: string;
    status: string;
    /** `open` | `blocked` | `running` | `completed` | `failed` | `cancelled`. */
    state: string;
    assignee: string;
    dependencies: string[];
    depth: number;
    updatedAt: number;
    kind?: string;
    round?: number;
    verdict?: string;
    objective?: string;
    acceptance?: string[];
    inScope?: string[];
    verify?: string[];
}
/** Everything the dashboard tab needs for one team. */
export interface DashboardTeamSnapshot {
    teamId: string;
    name: string;
    description?: string;
    workspace: string;
    workspaceTitle: string;
    captainSessionId: string;
    /** How the requesting session relates to this team. */
    role: 'captain' | 'member' | 'bystander';
    /** True for a team read from `archive/`: its history is final. */
    archived: boolean;
    /** Files under the team directory (what a delete would remove). */
    fileCount: number;
    /** Bytes under the team directory (what a delete would free). */
    diskBytes: number;
    phase: string;
    halted: boolean;
    escalated: boolean;
    round: number;
    createdAt: number;
    lastBeatAt?: number;
    solved: boolean;
    challenge: ChallengeInfo;
    nextStep: string;
    members: DashboardMemberRow[];
    tasks: DashboardTaskRow[];
    findings: TeamFinding[];
    flags: FlagCandidate[];
    captainUnread: number;
    counts: {
        members: number;
        working: number;
        tasks: number;
        done: number;
        active: number;
        pending: number;
        findings: number;
        flags: number;
        verified: number;
    };
}
/** The whole route payload. */
export interface DashboardPayload {
    generatedAt: number;
    sessionId?: string;
    workspace?: string;
    /** True for the `?archived=1` roster of finished teams. */
    archived: boolean;
    /** Configured team profile names the panel's start form can select. */
    profiles: string[];
    teams: DashboardTeamSnapshot[];
}
/** One workspace scanned by the route. */
export interface DashboardRoot {
    /** Absolute workspace path (the client's matching key). */
    path: string;
    /** Human-facing workspace title. */
    title: string;
}
/** Session-shaped input: only the id and the workspace path are read. */
export interface DashboardSessionRef {
    id: string;
    cwd?: string;
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
export declare function assembleDashboardTeam(ctx: Context, root: DashboardRoot, stateRoot: string, team: TeamState, options?: {
    sessionId?: string;
    archived?: boolean;
}): Promise<DashboardTeamSnapshot>;
/**
 * Collect the live teams of every given workspace root.
 * @param ctx - plugin context.
 * @param roots - workspace roots to scan.
 * @param stateDir - state directory name under each workspace.
 * @param options - the requesting session id.
 * @returns one snapshot per readable team, ordered by workspace then team id.
 */
export declare function collectDashboardTeams(ctx: Context, roots: readonly DashboardRoot[], stateDir: string, options?: {
    sessionId?: string;
}): Promise<DashboardTeamSnapshot[]>;
/**
 * Collect archived teams (the `archive/` subdirectory of each state root), so
 * a finished solve stays reviewable in the dashboard after deletion.
 * @param ctx - plugin context.
 * @param roots - workspace roots to scan.
 * @param stateDir - state directory name under each workspace.
 * @param options - the requesting session id.
 * @returns one snapshot per archived team.
 */
export declare function collectArchivedDashboardTeams(ctx: Context, roots: readonly DashboardRoot[], stateDir: string, options?: {
    sessionId?: string;
}): Promise<DashboardTeamSnapshot[]>;

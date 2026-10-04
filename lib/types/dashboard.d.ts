/**
 * The CTFTeams terminal dashboard.
 *
 * A pure renderer: one box-drawing panel that turns durable team state into
 * the at-a-glance solving picture (challenge, lanes, task board, findings,
 * flags). No web UI — the panel renders into the harness transcript itself,
 * as the `ctf_teams_status` tool output and as the `/ctf-teams-board` command
 * result. Alignment is display-width aware so CJK findings stay inside the
 * box.
 *
 * @module dsh-ctf-teams/dashboard
 */
import type { ChallengeInfo, FlagCandidate, TeamFinding, TeamState } from './types.ts';
/** The task fields the dashboard renders; a narrow view of TeamTask. */
export interface DashboardTask {
    id: string;
    subject: string;
    status: string;
    assignee?: string;
}
/** Panel content width (between the `│` borders), including the 1-space pads. */
export declare const PANEL_WIDTH = 78;
/** East-Asian width and emoji count as 2 columns; everything else as 1. */
export declare function displayWidth(text: string): number;
/** Cut a string to at most `width` display columns, appending `…` when cut. */
export declare function truncateToWidth(text: string, width: number): string;
/** Pad a string with spaces to exactly `width` display columns. */
export declare function padEndWidth(text: string, width: number): string;
/** One member row of the dashboard. */
export interface DashboardMember {
    name: string;
    role?: string;
    /** Durable status: `idle` | `working` | `removed`. */
    status: string;
    /** Live harness activity (`working`/`idle`/…); `unspawned` when no session yet. */
    activity?: string;
    route?: string;
    /** Board beats this member has not pulled yet (0 = live). */
    behind?: number;
    /** The open task this member currently owns, if any. */
    workingOn?: string;
}
/** Everything the dashboard needs; derived from team state plus live activity. */
export interface DashboardInput {
    teamName: string;
    description?: string;
    /** `staged` | `running` | `halted` | `escalated`. */
    phase: string;
    challenge: ChallengeInfo;
    round: number;
    findingCount: number;
    flags: FlagCandidate[];
    findings: TeamFinding[];
    members: DashboardMember[];
    tasks: DashboardTask[];
    /** Unread messages waiting in the captain's mailbox. */
    captainUnread?: number;
    /** Team creation time; enables the elapsed-time column. */
    createdAt?: number;
    /** Newest board beat (finding/flag/task update); enables `last beat`. */
    lastBeatAt?: number;
    /** Clock used for the ages; defaults to `Date.now()`. */
    now?: number;
}
/** `[██████░░░░░░] 8/12` — the one-glance progress marker. */
export declare function progressBar(done: number, total: number, width?: number): string;
/** Compact age, so a stale board reads as stale at a glance. */
export declare function formatAge(ms: number): string;
/**
 * The single most useful next action for whoever reads the panel, derived from
 * the same state the panel shows. Ordered by urgency: a human decision first,
 * then an unverified flag, then idle lanes with ready work.
 */
export declare function nextStepHint(input: DashboardInput): string;
/**
 * Render the full dashboard panel. Pure; never throws on partial state, so a
 * damaged team record still renders whatever is readable.
 */
export declare function renderDashboard(input: DashboardInput): string;
/**
 * Build the dashboard input from a durable team snapshot plus live extras.
 * `activity` maps member id → harness activity label; missing ids render as
 * `unspawned`.
 */
export declare function dashboardInputFromTeam(team: TeamState, extras?: {
    activity?: Map<string, string>;
    memberBehind?: Map<string, number>;
    captainUnread?: number;
    openTaskByMember?: Map<string, string>;
}): DashboardInput;
/** Compact single-line header for command results that do not need the panel. */
export declare function renderDashboardHeader(team: TeamState): string;

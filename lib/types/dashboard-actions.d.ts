/**
 * The dashboard's interactive half: validated panel actions.
 *
 * Every button in the 解题面板 becomes **one user turn in the session** — the
 * panel never mutates team state itself. That keeps a single authority (the
 * captain agent + the `ctf_teams_*` tools, which already enforce the protocol:
 * staged approval, flag verdicts, attachment writes) and keeps the transcript
 * honest: the panel action appears as the user's own message, so a later
 * reader can see exactly what was clicked.
 *
 * The endpoint is therefore deliberately not a generic "run this prompt"
 * gadget: the client sends an action name plus typed parameters, the host
 * validates them against durable state and composes the instruction text here.
 *
 * @module dsh-ctf-teams/dashboard-actions
 */
import type { TeamState } from './types.ts';
import type { DashboardTeamSnapshot } from './dashboard-snapshot.ts';
/** Actions the panel may request. */
export type DashboardActionName = 'start' | 'approve' | 'halt' | 'resume' | 'verify-flag' | 'nudge' | 'attachments' | 'writeup';
/** What the action needs before it may be sent. */
export type ActionAuthority = 'none' | 'participant' | 'captain';
/** The validated request payload. */
export interface DashboardActionBody {
    sessionId: string;
    action: DashboardActionName;
    teamId?: string;
    goal?: string;
    profile?: string;
    remote?: string;
    category?: string;
    points?: number;
    flagFormat?: string;
    attachments?: string[];
    flagId?: string;
    reason?: string;
}
/** A validated action, ready to become one user turn. */
export interface PreparedAction {
    action: DashboardActionName;
    /** Human-facing label echoed back to the panel. */
    label: string;
    /** Instruction text injected into the session. */
    prompt: string;
    requires: ActionAuthority;
}
/** A rejected request: the HTTP status and the reason to surface. */
export interface ActionRejection {
    status: number;
    error: string;
}
/**
 * Validate one panel request.
 * @param raw - the parsed JSON body.
 * @returns the typed body, or a rejection describing what is wrong.
 */
export declare function parseActionBody(raw: unknown): {
    ok: true;
    body: DashboardActionBody;
} | {
    ok: false;
} & ActionRejection;
/**
 * Compose the instruction for one action.
 * @param body - the validated body.
 * @param context - durable facts the composition depends on.
 * @returns the instruction text plus its authority requirement, or a rejection.
 */
export declare function prepareAction(body: DashboardActionBody, context: {
    profiles: readonly string[];
    team?: TeamState;
    captainSessionId?: string;
}): {
    ok: true;
    prepared: PreparedAction;
} | {
    ok: false;
} & ActionRejection;
/** One selectable workspace file for the attachment picker. */
export interface WorkspaceFileRow {
    path: string;
    size: number;
}
/**
 * List candidate attachment files inside one workspace, bounded on every axis.
 * The picker needs a short, relevant list — not a filesystem dump.
 * @param workspace - absolute workspace root.
 * @returns workspace-relative paths with sizes, sorted by path.
 */
export declare function listWorkspaceFiles(workspace: string): Promise<WorkspaceFileRow[]>;
/**
 * Render one team as a markdown review report (the "导出复盘" payload).
 * Pure: it formats a snapshot that was assembled from durable state.
 * @param snapshot - the assembled team snapshot.
 * @param generatedAt - the export timestamp.
 * @returns a markdown document.
 */
export declare function renderTeamReport(snapshot: DashboardTeamSnapshot, generatedAt: number): string;

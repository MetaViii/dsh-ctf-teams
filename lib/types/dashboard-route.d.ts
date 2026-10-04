/**
 * The dashboard's HTTP surface: state (read), action (one user turn), export
 * (writeup / review-report download) and files (attachment picker).
 *
 * All four go through {@link authenticatedWebRoutes}, so challenge state and
 * session control stay inside the trusted browser session. Registration is
 * lazy: a headless profile mounts neither a Web server nor a workspace
 * registry, and under concurrent activation those providers may bind after
 * this plugin, so the routes try now and again on each service bind.
 * @module dsh-ctf-teams/dashboard-route
 */
import type { Context } from '@deepseek-ai/cordis';
import type { TeamState } from './types.ts';
/** The exact path the dashboard tab polls. */
export declare const DASHBOARD_STATE_PATH = "/plugins/dsh-ctf-teams/state";
/** The panel's action endpoint: one click becomes one user turn. */
export declare const DASHBOARD_ACTION_PATH = "/plugins/dsh-ctf-teams/action";
/** Writeup / review-report download. */
export declare const DASHBOARD_EXPORT_PATH = "/plugins/dsh-ctf-teams/export";
/** Bounded workspace listing for the attachment picker. */
export declare const DASHBOARD_FILES_PATH = "/plugins/dsh-ctf-teams/files";
/** Route options resolved from the plugin config. */
export interface DashboardRouteOptions {
    /** State directory name under each workspace (`.ctf-teams`). */
    stateDir: string;
    /** Configured team profile names, offered by the panel's start form. */
    profiles?: readonly string[];
}
/** The session's team: the named one, else the team this session belongs to. */
export declare function findSessionTeam(stateRoot: string, teamId: string | undefined, sessionId: string): Promise<TeamState | undefined>;
/**
 * Install the dashboard routes. Safe to call in any profile: without a Web
 * server or workspace registry nothing registers and the plugin stays tool-only.
 * @param ctx - plugin context.
 * @param options - the resolved state directory and profile names.
 */
export declare function installDashboardRoute(ctx: Context, options: DashboardRouteOptions): void;

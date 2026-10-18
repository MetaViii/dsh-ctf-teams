import type { Agent } from '@deepseek-ai/dsh-agent';
import type { Context } from '@deepseek-ai/cordis';
import type { TeamMember, TeamState } from './types.ts';
export type ModelRoute = {
    provider: string;
    model: string;
    reasoning_effort?: string;
};
/** Observed request config, falling back to live Agent options; never wake or mutate an Agent. */
export declare function liveModelRoute(agent: Agent | undefined): ModelRoute | undefined;
export declare function memberRouteDiagnostics(ctx: Context, team: TeamState, member: TeamMember, archived?: boolean): {
    notice: string;
    differs_from_captain?: boolean | undefined;
    live_differs_from_saved?: boolean | undefined;
    captain_route?: ModelRoute | undefined;
    live_route?: ModelRoute | undefined;
    saved_route?: {
        reasoning_effort?: string | undefined;
        provider: string;
        model: string;
    } | undefined;
};

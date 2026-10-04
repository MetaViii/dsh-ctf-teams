/**
 * The audited Harness 0.1.2 / 0.1.5 / 0.1.7 subagent boundary. Keep version-specific shapes
 * here: API presence alone is not a promise of support for future versions.
 *
 * Alpha.2 owns followup/registerContinuableSetup; Alpha.5 and rc.1 own a
 * host-only FIFO queue; 0.1.5 uses a queue/steer deliverer. Both emit
 * synchronous agent/session-start with the explicit Agent. Their public
 * sendMessage instead steers a running Agent and must never carry team jobs.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ContentBlock, MessageId } from '@deepseek-ai/dsh-llm';
import type { Session, SessionEvent, SessionId } from '@deepseek-ai/dsh-session';
type Setup = (childCtx: Context, child: Agent) => () => void;
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'ctf-teams': {
            readonly kind: 'ctf-teams';
        };
    }
}
/**
 * 0.1.6 moved startup admission to serial agent/created. Older created events
 * have no source and precede session-start; ignore those until the old hook.
 * Keep the removed event's type confined to this audited compatibility seam.
 */
export declare function onAgentReady(ctx: Context, listener: (agent: Agent, vetoable: boolean) => void): () => void;
/** Read child-owned history, excluding any descriptor inherited from a parent. */
export declare function sessionOwnEvents(session: Session): readonly SessionEvent[];
/** Install before the first request, including cold resume, with HMR cleanup. */
export declare function installContinuableMemberSetup(ctx: Context, setup: Setup): void;
/** Queue a distinct host-authored turn; never substitute model-message steer. */
export declare function queueMemberPrompt(runtime: Context['subagents'], parent: Agent, childId: SessionId, content: ContentBlock[], signal: AbortSignal): Promise<MessageId>;
/** Coordination joins the nearest step, including waking an idle/cold child. */
export declare function steerMemberPrompt(runtime: Context['subagents'], parent: Agent, childId: SessionId, content: ContentBlock[], signal: AbortSignal, live?: Agent): Promise<MessageId>;
/** Guard all resumable delivery paths, preserving the native service receiver. */
export declare function guardSubagentDelivery(ctx: Context, isRetired: (sender: Agent, targetId: SessionId) => Promise<boolean>): void;
/**
 * Names the host's `tools.restrict()` would admit for this agent's layer
 * chain, or undefined when the host does not expose its registry view.
 * restrict() rejects unknown names with a hard error, so the spawn path must
 * check entries against this view before forwarding them. Source:
 * dsh-tools view()/restrict() in 0.1.5-rc.1; older Harness generations lack
 * the surface and keep the verbatim list.
 */
export declare function restrictableToolNames(agent: Agent): ReadonlySet<string> | undefined;
/**
 * Member `toolFilter` for one spawn. Captain-only names are registered by
 * this plugin itself and always resolvable; the depth-related entries name
 * HOST tools and are only known under some compositions, so they must be
 * resolved against the running host's registry: the delegation tool name is
 * host configuration (dsh-tool-subagent `toolName`, default `subagent`,
 * renamed per composition, e.g. `subagent_fork` in web-style profiles), and
 * forwarding a name the host dropped aborts every member spawn (#163, #164).
 * Depth enforcement itself does not depend on these names —
 * installMemberDelegationGuard bounds descendant creation by parent chain.
 */
export declare function memberToolFilter(maxDepth: number | undefined, knownTools: ReadonlySet<string> | undefined): {
    deny: string[];
};
/**
 * Start one member, dropping any filter name the host reports as unknown and
 * retrying.
 *
 * Resolving the filter against the registry view ({@link memberToolFilter})
 * only covers hosts that expose one. A rejected filter still leaves the member
 * without a session for the lifetime of the team, so the start must survive the
 * cases that resolution cannot see — no registry view, a name that is known but
 * not restrictable, a composition that mounted differently than expected. The
 * host names the offenders in its rejection, so they are removed and the start
 * retried; the retry only runs while the deny list strictly shrinks, and any
 * failure that is not an unknown-name report propagates untouched.
 * @param start - performs one start attempt for the given `toolFilter`.
 * @param filter - the filter to attempt first.
 * @returns the started member.
 */
export declare function startMemberWithLenientFilter<T>(start: (filter: {
    deny: string[];
}) => Promise<T>, filter: {
    deny: string[];
}): Promise<T>;
export {};

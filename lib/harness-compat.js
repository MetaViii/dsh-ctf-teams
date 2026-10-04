import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SubagentError } from '@deepseek-ai/dsh-subagent';
import { CAPTAIN_TOOL_NAMES } from "./tool-names.js";
/**
 * Exact protocol exported by dsh-subagent/internal in Alpha.5 and rc.1.
 * That subpath does not exist in Alpha.2, so importing it statically prevents
 * the plugin from loading there. This small adapter uses the same process-
 * stable symbol and call signature as upstream queueHostSubagentPrompt.
 * Source: packages/subagent/subagent/src/internal.ts at dsh-v0.1.2-rc.1.
 */
const hostPromptQueue = Symbol.for('dsh.subagent.queuePrompt');
// 0.1.5 keeps queueHostSubagentPrompt but replaces its symbol with this
// delivery-mode-aware implementation (packages/subagent/subagent/src/internal.ts).
const hostPromptDeliver = Symbol.for('dsh.subagent.deliverPrompt');
function boundary(runtime) {
    return runtime;
}
function unsupported(detail) {
    throw new Error(`ctf-teams: unsupported Harness subagent contract (${detail}); use an explicitly tested Harness version and a coherent dependency installation`);
}
/**
 * 0.1.6 moved startup admission to serial agent/created. Older created events
 * have no source and precede session-start; ignore those until the old hook.
 * Keep the removed event's type confined to this audited compatibility seam.
 */
export function onAgentReady(ctx, listener) {
    const stopCreated = ctx.on('agent/created', payload => {
        if ('source' in payload)
            listener(payload.agent, true);
        return undefined;
    });
    const legacy = ctx;
    const stopLegacy = legacy.on('agent/session-start', ({ agent }) => listener(agent, false));
    return () => { stopCreated(); stopLegacy(); };
}
/** Read child-owned history, excluding any descriptor inherited from a parent. */
export function sessionOwnEvents(session) {
    const current = session;
    if (typeof current.ownEvents === 'function')
        return current.ownEvents.call(session);
    const legacy = session;
    if (!Array.isArray(legacy.events))
        return unsupported('missing ownEvents/legacy session log');
    return legacy.events.slice(legacy.header.seedLength ?? 0);
}
/** Install before the first request, including cold resume, with HMR cleanup. */
export function installContinuableMemberSetup(ctx, setup) {
    const runtime = boundary(ctx.subagents);
    if (typeof runtime.registerContinuableSetup === 'function') {
        // Upstream owns this registration with this.ctx.effect. Cordis resolves
        // that ctx to the accessing plugin, so its disposal revokes installations
        // even while the subagents service and child Agents remain live.
        runtime.registerContinuableSetup.call(ctx.subagents, (childCtx) => {
            if (childCtx.agent === undefined)
                return unsupported('legacy setup lacks child Agent');
            return setup(childCtx, childCtx.agent);
        });
        return;
    }
    if ((typeof runtime[hostPromptQueue] !== 'function' && typeof runtime[hostPromptDeliver] !== 'function') || typeof runtime.sendMessage !== 'function') {
        return unsupported('missing continuable setup and modern host queue');
    }
    const installed = new WeakSet();
    const active = new Set();
    ctx.effect(() => {
        const stop = onAgentReady(ctx, (agent, vetoable) => {
            if (installed.has(agent))
                return;
            // Deliberately synchronous: awaiting here loses the first-request race.
            let teardown;
            try {
                teardown = setup(agent.ctx, agent);
            }
            catch (error) {
                if (vetoable)
                    throw error;
                // session-start is a notification: Harness logs a thrown listener and
                // still admits the first prompt. Reject request assembly explicitly so
                // a malformed saved route cannot silently execute on a default model.
                const failure = new Error(`ctf-teams: member initialization failed: ${String(error)}`, { cause: error });
                ctx.logger.warn(failure.message);
                teardown = agent.ctx.on('agent/request', () => { throw failure; });
            }
            installed.add(agent);
            let disposed = false;
            const dispose = () => {
                if (disposed)
                    return;
                disposed = true;
                active.delete(dispose);
                installed.delete(agent);
                teardown();
            };
            active.add(dispose);
            // Listeners contributed to agent.ctx already follow its lifetime. Also
            // release our bookkeeping and remove them if this plugin is reloaded.
            try {
                agent.ctx.effect(() => dispose, 'ctf-teams: child compatibility setup');
            }
            catch (error) {
                dispose();
                throw error;
            }
        });
        return () => {
            stop();
            for (const dispose of [...active])
                dispose();
        };
    }, 'ctf-teams: member lifecycle compatibility');
}
/** Queue a distinct host-authored turn; never substitute model-message steer. */
export async function queueMemberPrompt(runtime, parent, childId, content, signal) {
    const host = boundary(runtime);
    const source = { kind: 'ctf-teams' };
    if (typeof host.followup === 'function') {
        return host.followup.call(runtime, parent, childId, content, { source, signal });
    }
    const deliver = host[hostPromptDeliver];
    if (typeof deliver === 'function')
        return deliver.call(runtime, parent, childId, content, source, signal, 'queue');
    const queue = host[hostPromptQueue];
    if (typeof queue !== 'function')
        return unsupported('missing host FIFO delivery');
    return queue.call(runtime, parent, childId, content, source, signal);
}
/** Coordination joins the nearest step, including waking an idle/cold child. */
export async function steerMemberPrompt(runtime, parent, childId, content, signal, live) {
    const host = boundary(runtime);
    const source = { kind: 'ctf-teams' };
    const deliver = host[hostPromptDeliver];
    if (typeof deliver === 'function')
        return deliver.call(runtime, parent, childId, content, source, signal, 'steer');
    if (typeof host.sendMessage === 'function')
        return host.sendMessage.call(runtime, parent, childId, content, { signal });
    if (typeof host.followup === 'function') {
        if (live === undefined)
            return queueMemberPrompt(runtime, parent, childId, content, signal);
        if (live.id !== childId || live.session.header.parentSession !== parent.id)
            throw new Error('invalid member steering authority');
        signal.throwIfAborted();
        const message = createUserMessage({ content, source });
        live.steer(message);
        return message.id;
    }
    return unsupported('missing step-boundary message delivery');
}
/** Guard all resumable delivery paths, preserving the native service receiver. */
export function guardSubagentDelivery(ctx, isRetired) {
    const runtime = ctx.subagents;
    const host = boundary(runtime);
    const legacy = host.followup;
    const queue = host[hostPromptQueue];
    const deliver = host[hostPromptDeliver];
    const send = host.sendMessage;
    if (typeof legacy !== 'function' && ((typeof queue !== 'function' && typeof deliver !== 'function') || typeof send !== 'function')) {
        return unsupported('cannot install complete retired-member guard');
    }
    ctx.effect(() => {
        const descriptors = new Map([
            ['followup', Object.getOwnPropertyDescriptor(host, 'followup')],
            [hostPromptQueue, Object.getOwnPropertyDescriptor(host, hostPromptQueue)],
            [hostPromptDeliver, Object.getOwnPropertyDescriptor(host, hostPromptDeliver)],
            ['sendMessage', Object.getOwnPropertyDescriptor(host, 'sendMessage')],
        ]);
        let active = true;
        const check = async (sender, targetId) => {
            if (active && await isRetired(sender, targetId)) {
                throw new SubagentError(`CTFTeams member "${targetId}" was retired and cannot be resumed`, 'NOT_RESUMABLE');
            }
        };
        const guardedLegacy = async (parent, childId, content, options) => {
            await check(parent, childId);
            return legacy.call(runtime, parent, childId, content, options);
        };
        const guardedQueue = async (parent, childId, content, source, signal) => {
            await check(parent, childId);
            return queue.call(runtime, parent, childId, content, source, signal);
        };
        const guardedSend = async (sender, targetId, content, options) => {
            await check(sender, targetId);
            return send.call(runtime, sender, targetId, content, options);
        };
        const guardedDeliver = async (parent, childId, content, source, signal, delivery) => {
            await check(parent, childId);
            return deliver.call(runtime, parent, childId, content, source, signal, delivery);
        };
        if (typeof legacy === 'function')
            host.followup = guardedLegacy;
        if (typeof queue === 'function')
            host[hostPromptQueue] = guardedQueue;
        if (typeof deliver === 'function')
            host[hostPromptDeliver] = guardedDeliver;
        if (typeof send === 'function')
            host.sendMessage = guardedSend;
        // Cordis wraps method reads in fresh Proxies. Compare the actual own
        // descriptor to restore only our contribution, including prototype methods.
        const restore = (key, installed) => {
            if (Object.getOwnPropertyDescriptor(host, key)?.value !== installed)
                return;
            const original = descriptors.get(key);
            if (original === undefined)
                Reflect.deleteProperty(host, key);
            else
                Object.defineProperty(host, key, original);
        };
        return () => {
            active = false;
            if (typeof legacy === 'function')
                restore('followup', guardedLegacy);
            if (typeof queue === 'function')
                restore(hostPromptQueue, guardedQueue);
            if (typeof deliver === 'function')
                restore(hostPromptDeliver, guardedDeliver);
            if (typeof send === 'function')
                restore('sendMessage', guardedSend);
        };
    }, 'ctf-teams: retired member guard');
}
/**
 * Names the host's `tools.restrict()` would admit for this agent's layer
 * chain, or undefined when the host does not expose its registry view.
 * restrict() rejects unknown names with a hard error, so the spawn path must
 * check entries against this view before forwarding them. Source:
 * dsh-tools view()/restrict() in 0.1.5-rc.1; older Harness generations lack
 * the surface and keep the verbatim list.
 */
export function restrictableToolNames(agent) {
    const tools = agent?.ctx?.tools;
    if (typeof tools?.view !== 'function')
        return undefined;
    try {
        const names = tools.view.call(tools, agent.ctx)?.restrictableNames;
        return names instanceof Set ? names : undefined;
    }
    catch {
        return undefined;
    }
}
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
export function memberToolFilter(maxDepth, knownTools) {
    const depthDeny = maxDepth === 0 ? ['subagent', 'send_message'] : [];
    return {
        deny: [
            ...CAPTAIN_TOOL_NAMES,
            ...(knownTools === undefined ? depthDeny : depthDeny.filter(name => knownTools.has(name))),
        ],
    };
}
/**
 * Names a `tools.restrict()` rejection reported as unknown, or an empty list
 * for every other failure. The host names the offenders verbatim
 * (`tools.restrict() names unknown global tool "x"; known global tools: …`);
 * only that report may relax a filter (#164, #166).
 */
function unknownToolNames(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('unknown global tool'))
        return [];
    return [...message.matchAll(/"([^"]+)"/g)].map(match => match[1]);
}
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
export async function startMemberWithLenientFilter(start, filter) {
    let deny = [...filter.deny];
    for (;;) {
        try {
            return await start({ deny });
        }
        catch (error) {
            const unknown = unknownToolNames(error);
            const remaining = deny.filter(name => !unknown.includes(name));
            if (unknown.length === 0 || remaining.length === deny.length)
                throw error;
            deny = remaining;
        }
    }
}

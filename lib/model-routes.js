/** Observed request config, falling back to live Agent options; never wake or mutate an Agent. */
export function liveModelRoute(agent) {
    if (!agent)
        return;
    try {
        const current = agent.session?.requestHeader?.()?.config ?? agent.options;
        if (typeof current?.provider !== 'string' || !current.provider || typeof current.model !== 'string' || !current.model)
            return;
        return { provider: current.provider, model: current.model, ...typeof current.reasoningEffort === 'string' && current.reasoningEffort ? { reasoning_effort: current.reasoningEffort } : {} };
    }
    catch {
        return undefined;
    } // Diagnostics must not hide an otherwise readable team.
}
export function memberRouteDiagnostics(ctx, team, member, archived = false) {
    const saved = member.provider && member.model ? { provider: member.provider, model: member.model, ...member.reasoningEffort ? { reasoning_effort: member.reasoningEffort } : {} } : undefined;
    const get = (id) => { try {
        return id ? ctx.agents.get(id) : undefined;
    }
    catch {
        return undefined;
    } };
    const captain = archived ? undefined : liveModelRoute(get(team.captainSessionId));
    const live = archived ? undefined : liveModelRoute(get(member.id));
    const different = (a, b) => a && b ? a.provider !== b.provider || a.model !== b.model || a.reasoning_effort !== b.reasoning_effort : undefined;
    const drift = different(live, saved);
    const divergence = different(live ?? saved, captain);
    return {
        ...saved ? { saved_route: saved } : {},
        ...live ? { live_route: live } : {},
        ...captain ? { captain_route: captain } : {},
        ...drift === undefined ? {} : { live_differs_from_saved: drift },
        ...divergence === undefined ? {} : { differs_from_captain: divergence },
        notice: !live ? archived ? 'Historical saved route; no live route was queried.' : 'Live member route unavailable; saved configuration is not proof of a model request.'
            : drift ? 'Live member route differs from its saved route; inspect configuration before continuing.'
                : divergence ? 'Member route differs from the current captain. This may be intentional; captain model changes do not update existing members. Use update_member for an explicit change.'
                    : '',
    };
}

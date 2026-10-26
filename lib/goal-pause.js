export function pauseCaptainGoal(ctx, captain) {
    try {
        const goals = ctx.get('goals');
        if (!goals || typeof goals.get !== 'function' || typeof goals.pause !== 'function')
            return { status: 'unavailable' };
        const current = goals.get(captain);
        if (!current)
            return { status: 'none' };
        if (current.phase !== 'active')
            return { status: 'already_inactive', goal_id: current.id };
        goals.pause(captain, { id: current.id, revision: current.revision });
        return { status: 'paused', goal_id: current.id };
    }
    catch (error) {
        ctx.logger.warn(`ctf-teams: goal pause unavailable; team halt still applies: ${String(error).slice(0, 200)}`);
        return { status: 'failed' };
    }
}

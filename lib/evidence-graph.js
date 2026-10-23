export function boardReference(team) {
    return `${team.id}@${team.boardId ?? team.createdAt}`;
}
export function findingReference(team, finding) {
    return `${boardReference(team)}/${finding.id}`;
}
export function resolveFindingReference(team, reference) {
    const prefix = `${boardReference(team)}/`;
    if (!reference.startsWith(prefix))
        throw new Error('finding reference belongs to another team/generation; read ctf_teams_evidence first');
    const finding = team.findings?.find(item => item.id === reference.slice(prefix.length));
    if (!finding)
        throw new Error('unknown finding reference');
    return finding;
}
export function findingUsable(finding) {
    return !finding.supersededBy && !finding.recheckRequired && finding.verifications?.at(-1)?.result === 'confirmed';
}
export function findingDependencies(team, references = [], challengeId) {
    if (references.length > 16)
        throw new Error('at most 16 depends_on references');
    return [...new Set(references)].map(reference => {
        const finding = resolveFindingReference(team, reference);
        if (challengeId && finding.challengeId && finding.challengeId !== challengeId)
            throw new Error('depends_on belongs to a different challenge');
        return findingReference(team, finding);
    });
}
/** Existing dependency edges are immutable; a correction is another finding. */
export function affectedFindings(team, source) {
    const seen = new Set([findingReference(team, source)]);
    const affected = [];
    let changed = true;
    while (changed) {
        changed = false;
        for (const finding of team.findings ?? []) {
            const reference = findingReference(team, finding);
            if (!seen.has(reference) && finding.dependsOn?.some(parent => seen.has(parent))) {
                seen.add(reference);
                affected.push(finding);
                changed = true;
            }
        }
    }
    return affected;
}
export function invalidateDependents(team, source) {
    const cause = findingReference(team, source);
    const affected = affectedFindings(team, source);
    for (const finding of affected) {
        finding.recheckRequired = {
            causes: [...new Set([...(finding.recheckRequired?.causes ?? []), cause])],
            since: finding.recheckRequired?.since ?? Date.now(),
        };
    }
    return affected.map(finding => findingReference(team, finding));
}
export function validateFindingReview(team, finding, result, supersededBy) {
    if (!['confirmed', 'refuted', 'inconclusive'].includes(result))
        throw new Error('invalid finding verdict');
    const replacement = supersededBy === undefined ? undefined : resolveFindingReference(team, supersededBy);
    if (replacement) {
        if (replacement.id === finding.id || affectedFindings(team, finding).some(item => item.id === replacement.id))
            throw new Error('replacement must be independent of the superseded finding');
        if (finding.challengeId && replacement.challengeId && finding.challengeId !== replacement.challengeId)
            throw new Error('replacement belongs to a different challenge');
        const seen = new Set([findingReference(team, finding)]);
        let next = replacement;
        while (next) {
            const reference = findingReference(team, next);
            if (seen.has(reference))
                throw new Error('supersession cycle');
            seen.add(reference);
            next = next.supersededBy ? resolveFindingReference(team, next.supersededBy) : undefined;
        }
        if (result !== 'refuted')
            throw new Error('superseded_by requires a refuted verdict');
        if (finding.supersededBy && finding.supersededBy !== supersededBy)
            throw new Error('supersession is immutable; record another correction');
    }
    if (result === 'confirmed') {
        if (finding.supersededBy)
            throw new Error('superseded findings stay historical; verify their replacement');
        const blocked = (finding.dependsOn ?? []).filter(reference => !findingUsable(resolveFindingReference(team, reference)));
        if (blocked.length)
            throw new Error('confirm dependencies independently before reconfirming this finding: ' + blocked.join(', '));
    }
    return replacement;
}
export function evidenceSummary(team) {
    const findings = team.findings ?? [];
    return { total: findings.length, needs_recheck: findings.filter(finding => finding.recheckRequired).length,
        superseded: findings.filter(finding => finding.supersededBy).length, captain_confirmed: findings.filter(findingUsable).length };
}

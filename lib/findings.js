/**
 * The CTF round-sync board: shared findings, candidate flags, challenge
 * metadata, and per-participant sync cursors.
 *
 * Pure functions over the durable `TeamState` only — every caller must hold
 * the team lock and persist `writeTeam` itself. The sync contract: each board
 * beat (a reported finding or a submitted flag) advances the team round, and
 * every participant pulls its own delta against its durable cursor, so a
 * round where nothing changed produces no traffic at all.
 *
 * @module dsh-ctf-teams/findings
 */
/** Default flag shape when the challenge does not configure its own format. */
export const DEFAULT_FLAG_FORMAT = 'flag\\{[^}]+\\}';
/** Cap on one finding's content so a single report cannot flood the board. */
export const FINDING_CONTENT_MAX_CHARS = 2_000;
/** Cap on one flag's evidence note. */
export const FLAG_EVIDENCE_MAX_CHARS = 1_000;
/** Findings shown in one digest / status render. */
export const DIGEST_FINDING_LIMIT = 12;
/** Flags shown in one digest / status render. */
export const DIGEST_FLAG_LIMIT = 8;
/** The synthetic participant key for the captain's own cursor. */
export const CAPTAIN_SYNC_KEY = 'captain';
/** Normalize a flag string: trim, drop surrounding quotes models like to add. */
export function normalizeFlag(raw) {
    let flag = raw.trim();
    if (flag.length >= 2) {
        const first = flag[0];
        const last = flag[flag.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
            flag = flag.slice(1, -1).trim();
        }
    }
    return flag;
}
/** Compile the challenge flag format; falls back to the default shape. */
export function flagFormatRegex(challenge) {
    const format = challenge?.flagFormat;
    const source = Array.isArray(format) ? format.map(entry => `(?:${entry})`).join('|')
        : format?.trim() || DEFAULT_FLAG_FORMAT;
    try {
        // Case-insensitive on purpose: competitions ship `flag{...}`, `FLAG{...}`,
        // and `Flag{...}` wrappers, and a false rejection is worse than a gate
        // that is one case too lax (the platform stays the authority).
        return new RegExp(`^(?:${source})$`, 'i');
    }
    catch {
        return new RegExp(DEFAULT_FLAG_FORMAT, 'i');
    }
}
/** True when the flag string matches the challenge's configured format. */
export function flagMatchesFormat(flag, challenge) {
    if (challenge?.flagFormat === null)
        return true;
    if ((challenge?.flagFormat === undefined || challenge.flagFormat === DEFAULT_FLAG_FORMAT) && flagWrapper(flag)?.toLowerCase() === 'flag')
        return true;
    return flagFormatRegex(challenge).test(flag);
}
/** Human-readable format hint shared by the tools and dashboards. */
export function flagFormatLabel(challenge) {
    const format = challenge?.flagFormat === undefined ? DEFAULT_FLAG_FORMAT : challenge.flagFormat;
    return format === null ? 'platform decides' : Array.isArray(format) ? format.join(' | ') : format ?? DEFAULT_FLAG_FORMAT;
}
/** Infer only the wrapper; never change any bytes of a candidate. */
export function flagWrapper(flag) {
    const prefix = /^([A-Za-z][A-Za-z0-9_-]*)\{/u.exec(flag);
    if (!prefix || !flag.endsWith('}') || flag.length <= prefix[0].length + 1)
        return undefined;
    let depth = 0;
    for (let i = prefix[0].length - 1; i < flag.length; i++) {
        if (flag[i] === '{')
            depth++;
        if (flag[i] === '}' && --depth === 0 && i !== flag.length - 1)
            return undefined;
        if (depth < 0)
            return undefined;
    }
    return depth === 0 ? prefix[1] : undefined;
}
/** Opt-in candidate generation only: no variant is automatically submitted or verified. */
export function nestedFlagVariants(raw) {
    const variants = [];
    let value = normalizeFlag(raw);
    for (let i = 0; i < 16 && flagWrapper(value); i++) {
        value = value.slice(value.indexOf('{') + 1, -1);
        if (value)
            variants.push(value);
    }
    return [...new Set(variants)];
}
export function batchProgress(team) {
    const accepted = (team.flags ?? []).filter(f => f.status === 'verified');
    return { verified: new Set(accepted.flatMap(f => f.challengeId ? [f.challengeId] : [])).size, expected: team.challenge?.expectedChallenges, unscoped: accepted.filter(f => !f.challengeId).length };
}
/** Explicit batch completion, after real platform checks; flags alone never close a batch. */
export function markChallengeSolved(team, note) {
    if (!note.trim())
        throw new Error('explicit completion evidence/note is required');
    const progress = batchProgress(team);
    if (team.challenge?.multiChallenge && progress.verified === 0)
        throw new Error('batch completion needs at least one verified challenge_id; unscoped legacy flags do not count');
    if (team.challenge?.multiChallenge && progress.expected !== undefined && progress.verified < progress.expected)
        throw new Error(`batch incomplete: ${progress.verified}/${progress.expected} distinct challenges verified`);
    if (!(team.flags ?? []).some(f => f.status === 'verified'))
        throw new Error('no platform-verified flags on the board');
    team.challenge ??= {};
    team.challenge.explicitlySolved = true;
    team.challenge.solved = true;
    team.challenge.solvedAt = Date.now();
    appendFinding(team, { from: 'captain', category: 'completion', content: note, evidenceKind: 'raw_output' });
}
/** A claim is unverified even if its author supplied raw output or high confidence. */
export function findingLabel(finding) {
    const verification = finding.verifications?.at(-1);
    return `${verification?.result ?? 'unverified'}; ${finding.evidenceKind ?? 'unspecified'}${finding.confidence ? `; confidence=${finding.confidence}` : ''}`;
}
export function formatFinding(finding) {
    return `[${finding.id}] (${finding.from}${finding.category === undefined ? '' : `/${finding.category}`}) [${findingLabel(finding)}] ${finding.content}${finding.evidence ? ` — evidence: ${finding.evidence}` : ''}`;
}
export function formatFlag(flag) {
    return `[${flag.id}] ${flag.flag} — ${flag.status} by ${flag.submittedBy}${flag.challengeId ? `; challenge=${flag.challengeId}` : ''}${flag.variantOf ? `; variant of ${flag.variantOf}` : ''}${flag.verifiedFlag ? `; platform accepted: ${flag.verifiedFlag}` : ''}${flag.formatWarning ? `; FORMAT WARNING: ${flag.formatWarning}` : ''}${flag.note ? `; ${flag.note}` : ''}`;
}
/** The team's challenge info with its default flag format filled in. */
export function challengeOf(team) {
    return { flagFormat: DEFAULT_FLAG_FORMAT, ...team.challenge };
}
/** Read one participant's durable cursor; zero means "seen nothing yet". */
export function readCursor(team, participant) {
    const cursor = team.syncCursors?.[participant];
    return {
        findingSeq: cursor?.findingSeq ?? 0,
        flagSeq: cursor?.flagSeq ?? 0,
        ts: cursor?.ts ?? 0,
    };
}
/**
 * Persist one participant's cursor after a successful digest delivery.
 * `upTo` bounds the advance to exactly the sequence numbers the delivered
 * digest covered: board beats that arrive between digest computation and
 * delivery acceptance stay pending for the next round instead of being
 * skipped. Without `upTo` the cursor moves to the current board head (the
 * caller just showed everything, as the sync/report tools do).
 */
export function advanceCursor(team, participant, upTo) {
    team.syncCursors ??= {};
    const head = {
        findingSeq: team.findingSeq ?? 0,
        flagSeq: team.flagSeq ?? 0,
    };
    team.syncCursors[participant] = {
        findingSeq: Math.min(head.findingSeq, upTo?.findingSeq ?? head.findingSeq),
        flagSeq: Math.min(head.flagSeq, upTo?.flagSeq ?? head.flagSeq),
        ts: Date.now(),
    };
}
/** Append one finding; advances the team round. Caller must persist. */
export function appendFinding(team, input) {
    const content = input.content.trim();
    if (content === '')
        throw new Error('finding content must not be empty');
    const seq = (team.findingSeq ?? 0) + 1;
    const round = (team.round ?? 0) + 1;
    const finding = {
        id: `fd${seq}`,
        from: input.from,
        content: content.length > FINDING_CONTENT_MAX_CHARS
            ? `${content.slice(0, FINDING_CONTENT_MAX_CHARS)} [truncated]`
            : content,
        round,
        ts: Date.now(),
        ...input.evidenceKind === undefined ? {} : { evidenceKind: input.evidenceKind },
        ...input.confidence === undefined ? {} : { confidence: input.confidence },
        ...input.evidence?.trim() ? { evidence: input.evidence.trim().slice(0, FINDING_CONTENT_MAX_CHARS) } : {},
        ...(input.category !== undefined && input.category.trim() !== ''
            ? { category: input.category.trim() }
            : {}),
    };
    team.findingSeq = seq;
    team.round = round;
    team.findings = [...team.findings ?? [], finding];
    return finding;
}
/** Find an existing candidate that already carries this exact flag string. */
export function findFlagCandidate(team, flag) {
    return team.flags?.find((candidate) => candidate.flag === flag);
}
/** Stable across reloads and different from a recreated same-name team's reference. */
export function flagReference(team, candidate) {
    return `${team.id}@${team.boardId ?? team.createdAt}/${candidate.id}`;
}
/** Append one candidate flag. Duplicates return the existing candidate. Caller must persist. */
export function appendFlagCandidate(team, input) {
    const flag = normalizeFlag(input.flag);
    if (flag === '')
        throw new Error('flag must not be empty');
    const wrapper = flagWrapper(flag);
    const formatWarning = flagMatchesFormat(flag, team.challenge) ? undefined
        : `Does not match /${flagFormatLabel(team.challenge)}/.${wrapper ? ` Observed wrapper: ${wrapper}.` : ''} Preserve the original string; the platform decides.`;
    const existing = team.flags?.find(entry => entry.flag === flag && entry.challengeId === input.challengeId);
    if (existing !== undefined)
        return { candidate: existing, duplicate: true };
    const seq = Math.max(team.flagSeq ?? 0, ...(team.flags ?? []).map(entry => boardIdNumber(entry.id))) + 1;
    const candidate = {
        id: `f${seq}`,
        flag,
        submittedBy: input.submittedBy,
        status: 'candidate',
        ts: Date.now(),
        ...input.challengeId ? { challengeId: input.challengeId } : {},
        ...input.variantOf ? { variantOf: input.variantOf } : {},
        ...formatWarning === undefined ? {} : { formatWarning },
        ...(input.evidence !== undefined && input.evidence.trim() !== ''
            ? { evidence: input.evidence.trim().slice(0, FLAG_EVIDENCE_MAX_CHARS) }
            : {}),
    };
    team.flagSeq = seq;
    team.round = (team.round ?? 0) + 1;
    team.flags = [...team.flags ?? [], candidate];
    return { candidate, duplicate: false };
}
/** Review one candidate flag. Verified marks the challenge solved. Caller must persist. */
export function reviewFlagCandidate(team, flagId, verdict, input) {
    const localId = flagId.startsWith(`${team.id}/`) ? flagId.slice(team.id.length + 1) : flagId;
    const matchingFlags = input.flag === undefined ? [] : (team.flags ?? []).filter(entry => entry.flag === normalizeFlag(input.flag));
    if (flagId && !team.flags?.some(entry => entry.id === localId || flagReference(team, entry) === flagId) && (team.flags ?? []).filter(entry => entry.flag === flagId).length > 1)
        throw new Error('ambiguous flag content across challenges; use durable flag_ref');
    if (flagId === '' && matchingFlags.length > 1)
        throw new Error(`ambiguous flag content across challenges; use durable flag_ref: ${matchingFlags.map(f => flagReference(team, f)).join(', ')}`);
    const candidate = flagId !== '' ? team.flags?.find((entry) => entry.id === localId || flagReference(team, entry) === flagId || entry.flag === flagId) : matchingFlags[0];
    if (!candidate && flagId !== '' && matchingFlags.length)
        throw new Error('flag_id and flag identify different candidates');
    if (candidate === undefined) {
        throw new Error(`no flag candidate "${input.flag ?? flagId}" on team "${team.id}". Current ids: ${(team.flags ?? []).map(entry => `${entry.id} (${flagReference(team, entry)})`).join(', ') || '(none)'}. Use ctf_teams_status or mark by exact flag content.`);
    }
    if (input.flag !== undefined && candidate.flag !== normalizeFlag(input.flag))
        throw new Error('flag_id and flag identify different candidates');
    const verifiedFlag = input.verifiedFlag === undefined ? candidate.flag : normalizeFlag(input.verifiedFlag);
    if (verdict === 'verified' && verifiedFlag === '')
        throw new Error('verified_flag must not be empty');
    candidate.status = verdict;
    candidate.reviewedBy = input.by;
    candidate.reviewedAt = Date.now();
    if (verdict === 'verified')
        candidate.verifiedFlag = verifiedFlag;
    else
        delete candidate.verifiedFlag;
    if (input.note !== undefined && input.note.trim() !== '')
        candidate.note = input.note.trim();
    candidate.reviews ??= [];
    candidate.reviews.push({ verdict, by: input.by, ts: candidate.reviewedAt, ...input.note ? { note: input.note } : {}, ...verdict === 'verified' ? { verifiedFlag } : {} });
    candidate.updateSeq = Math.max(team.flagSeq ?? 0, ...(team.flags ?? []).map(entry => boardIdNumber(entry.id))) + 1;
    team.flagSeq = candidate.updateSeq;
    team.round = (team.round ?? 0) + 1;
    const accepted = team.flags?.find(entry => entry.status === 'verified');
    team.challenge ??= {};
    const progress = batchProgress(team);
    const solved = team.challenge.multiChallenge ? team.challenge.explicitlySolved === true && progress.verified > 0 && (progress.expected === undefined || progress.verified >= progress.expected) : accepted !== undefined;
    team.challenge.solved = solved;
    if (accepted && solved && !team.challenge.multiChallenge) {
        team.challenge.solvedAt = accepted.reviewedAt ?? accepted.ts;
        team.challenge.solvedBy = accepted.submittedBy;
    }
    else if (!solved) {
        delete team.challenge.solvedAt;
        delete team.challenge.solvedBy;
    }
    return { candidate, solved };
}
/** Record a captain's reproducibility check and publish a new audit beat. */
export function verifyFinding(team, findingId, input) {
    const finding = team.findings?.find(entry => entry.id === findingId);
    if (!finding)
        throw new Error(`no finding "${findingId}"; current ids: ${(team.findings ?? []).map(entry => entry.id).join(', ') || '(none)'}`);
    const method = input.method.trim();
    if (!method)
        throw new Error('verification method must not be empty');
    finding.verifications ??= [];
    finding.verifications.push({ ...input, method, ts: Date.now() });
    appendFinding(team, { from: input.by, category: 'verification', evidenceKind: 'raw_output', content: `${finding.id}: ${input.result}; method: ${method}${input.note ? `; result: ${input.note}` : ''}` });
    return finding;
}
/** Captain-owned challenge metadata update; merges into existing info. */
export function updateChallenge(team, patch) {
    if (patch.expectedChallenges !== undefined && (!Number.isSafeInteger(patch.expectedChallenges) || patch.expectedChallenges < 1))
        throw new Error('expected_challenges must be a positive integer');
    if (patch.flagFormat !== undefined && patch.flagFormat !== null) {
        const formats = Array.isArray(patch.flagFormat) ? patch.flagFormat : [patch.flagFormat];
        if (formats.length === 0 || formats.some(entry => entry.trim() === ''))
            throw new Error('flag_format must contain nonempty regex sources, or null');
        for (const source of formats) {
            try {
                new RegExp(source);
            }
            catch {
                throw new Error(`invalid flag_format regex: ${source}`);
            }
        }
    }
    const challenge = challengeOf(team);
    const next = {
        ...challenge,
        ...patch.title !== undefined ? { title: patch.title.trim() } : {},
        ...patch.category !== undefined ? { category: patch.category.trim() } : {},
        ...patch.points !== undefined ? { points: patch.points } : {},
        ...patch.description !== undefined ? { description: patch.description } : {},
        ...patch.attachments !== undefined ? { attachments: patch.attachments } : {},
        ...patch.remote !== undefined ? { remote: patch.remote.trim() } : {},
        ...patch.environmentId !== undefined ? { environmentId: patch.environmentId.trim() } : {},
        ...patch.multiChallenge !== undefined ? { multiChallenge: patch.multiChallenge } : {},
        ...patch.expectedChallenges !== undefined ? { expectedChallenges: patch.expectedChallenges } : {},
        ...patch.requiresRunningTargetForSubmit !== undefined ? { requiresRunningTargetForSubmit: patch.requiresRunningTargetForSubmit } : {},
        ...patch.practiceGroundId !== undefined ? { practiceGroundId: patch.practiceGroundId.trim() } : {},
        ...patch.flagFormat !== undefined ? { flagFormat: patch.flagFormat } : {},
    };
    for (const [key, value] of Object.entries(next)) {
        if (value === undefined || (typeof value === 'string' && value.trim() === '')) {
            delete next[key];
        }
    }
    team.challenge = next;
    if (next.multiChallenge) {
        const progress = batchProgress(team);
        next.solved = next.explicitlySolved === true && (progress.expected === undefined || progress.verified >= progress.expected) && progress.verified > 0;
        if (!next.solved) {
            delete next.solvedAt;
            delete next.solvedBy;
        }
    }
    return next;
}
export function deltaSince(team, participant) {
    const cursor = readCursor(team, participant);
    const findings = (team.findings ?? []).filter((finding) => boardIdNumber(finding.id) > cursor.findingSeq);
    const flags = (team.flags ?? []).filter((flag) => (flag.updateSeq ?? boardIdNumber(flag.id)) > cursor.flagSeq);
    return {
        hasUpdates: findings.length > 0 || flags.length > 0,
        findings,
        flags,
        round: team.round ?? 0,
        solved: team.challenge?.solved === true,
        ...team.challenge?.multiChallenge ? { batch: batchProgress(team) } : {},
    };
}
/** Convenience used by callers that only need the boolean. */
export function hasNewProgress(team, participant) {
    return deltaSince(team, participant).hasUpdates;
}
/** Parse the numeric part of a stable board id (`fd3` → 3, `f12` → 12). */
export function boardIdNumber(id) {
    const match = /^f[dp]?(\d+)$/u.exec(id);
    return match === null ? 0 : Number(match[1] ?? 0);
}
/** Render one digest block for a prompt or tool result. Empty when no delta. */
export function formatBoardDelta(delta) {
    if (!delta.hasUpdates && !delta.solved)
        return '';
    const lines = [];
    if (delta.solved)
        lines.push('*** THE CHALLENGE IS SOLVED — a flag was verified. Wrap up: stop exploring, help finalize the writeup. ***');
    else if (delta.batch)
        lines.push(`BATCH PROGRESS: ${delta.batch.verified}/${delta.batch.expected ?? '?'} challenges verified${delta.batch.unscoped ? `; ${delta.batch.unscoped} verified flags lack challenge_id` : ''}. Continue remaining lanes; do NOT converge on a batch writeup yet.`);
    if (delta.findings.length > 0) {
        lines.push('New teammate findings:');
        for (const finding of delta.findings.slice(-DIGEST_FINDING_LIMIT)) {
            lines.push(`  - ${formatFinding(finding)}`);
        }
    }
    if (delta.flags.length > 0) {
        lines.push('Flag board updates:');
        for (const flag of delta.flags.slice(-DIGEST_FLAG_LIMIT)) {
            lines.push(`  - ${formatFlag(flag)}`);
        }
    }
    return lines.join('\n');
}

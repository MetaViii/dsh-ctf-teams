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
    const source = challenge?.flagFormat?.trim() || DEFAULT_FLAG_FORMAT;
    try {
        // Case-insensitive on purpose: competitions ship `flag{...}`, `FLAG{...}`,
        // and `Flag{...}` wrappers, and a false rejection is worse than a gate
        // that is one case too lax (the platform stays the authority).
        return new RegExp(source, 'i');
    }
    catch {
        return new RegExp(DEFAULT_FLAG_FORMAT, 'i');
    }
}
/** True when the flag string matches the challenge's configured format. */
export function flagMatchesFormat(flag, challenge) {
    return flagFormatRegex(challenge).test(flag);
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
    return team.flags?.find((candidate) => candidate.flag.toLowerCase() === flag.toLowerCase());
}
/** Append one candidate flag. Duplicates return the existing candidate. Caller must persist. */
export function appendFlagCandidate(team, input) {
    const flag = normalizeFlag(input.flag);
    if (flag === '')
        throw new Error('flag must not be empty');
    if (!flagMatchesFormat(flag, team.challenge)) {
        throw new Error(`flag does not match the challenge format /${challengeOf(team).flagFormat}/ — confirm the wrapper (e.g. flag{...}) before submitting`);
    }
    const existing = findFlagCandidate(team, flag);
    if (existing !== undefined)
        return { candidate: existing, duplicate: true };
    const seq = (team.flagSeq ?? 0) + 1;
    const candidate = {
        id: `f${seq}`,
        flag,
        submittedBy: input.submittedBy,
        status: 'candidate',
        ts: Date.now(),
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
    const candidate = team.flags?.find((entry) => entry.id === flagId || entry.flag === flagId);
    if (candidate === undefined) {
        throw new Error(`no flag candidate "${flagId}" on the board — use ctf_teams_status to list candidates`);
    }
    candidate.status = verdict;
    candidate.reviewedBy = input.by;
    if (input.note !== undefined && input.note.trim() !== '')
        candidate.note = input.note.trim();
    let solved = false;
    if (verdict === 'verified') {
        solved = true;
        team.challenge ??= {};
        team.challenge.solved = true;
        team.challenge.solvedAt = Date.now();
        team.challenge.solvedBy = candidate.submittedBy;
    }
    return { candidate, solved };
}
/** Captain-owned challenge metadata update; merges into existing info. */
export function updateChallenge(team, patch) {
    const challenge = challengeOf(team);
    const next = {
        ...challenge,
        ...patch.title !== undefined ? { title: patch.title.trim() } : {},
        ...patch.category !== undefined ? { category: patch.category.trim() } : {},
        ...patch.points !== undefined ? { points: patch.points } : {},
        ...patch.description !== undefined ? { description: patch.description } : {},
        ...patch.attachments !== undefined ? { attachments: patch.attachments } : {},
        ...patch.remote !== undefined ? { remote: patch.remote.trim() } : {},
        ...patch.flagFormat !== undefined && patch.flagFormat.trim() !== ''
            ? { flagFormat: patch.flagFormat.trim() }
            : {},
    };
    for (const [key, value] of Object.entries(next)) {
        if (value === undefined || (typeof value === 'string' && value.trim() === '')) {
            delete next[key];
        }
    }
    team.challenge = next;
    return next;
}
export function deltaSince(team, participant) {
    const cursor = readCursor(team, participant);
    const findings = (team.findings ?? []).filter((finding) => boardIdNumber(finding.id) > cursor.findingSeq);
    const flags = (team.flags ?? []).filter((flag) => boardIdNumber(flag.id) > cursor.flagSeq);
    return {
        hasUpdates: findings.length > 0 || flags.length > 0,
        findings,
        flags,
        round: team.round ?? 0,
        solved: team.challenge?.solved === true,
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
    if (delta.findings.length > 0) {
        lines.push('New teammate findings:');
        for (const finding of delta.findings.slice(-DIGEST_FINDING_LIMIT)) {
            lines.push(`  - [${finding.id}] (${finding.from}${finding.category === undefined ? '' : `/${finding.category}`}) ${finding.content}`);
        }
    }
    if (delta.flags.length > 0) {
        lines.push('Flag board updates:');
        for (const flag of delta.flags.slice(-DIGEST_FLAG_LIMIT)) {
            lines.push(`  - [${flag.id}] ${flag.flag} — ${flag.status} by ${flag.submittedBy}${flag.note === undefined ? '' : `: ${flag.note}`}`);
        }
    }
    return lines.join('\n');
}

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
import type { ChallengeInfo, FlagCandidate, FlagStatus, SyncCursor, TeamFinding, TeamState } from './types.ts';
/** Default flag shape when the challenge does not configure its own format. */
export declare const DEFAULT_FLAG_FORMAT = "flag\\{[^}]+\\}";
/** Cap on one finding's content so a single report cannot flood the board. */
export declare const FINDING_CONTENT_MAX_CHARS = 2000;
/** Cap on one flag's evidence note. */
export declare const FLAG_EVIDENCE_MAX_CHARS = 1000;
/** Findings shown in one digest / status render. */
export declare const DIGEST_FINDING_LIMIT = 12;
/** Flags shown in one digest / status render. */
export declare const DIGEST_FLAG_LIMIT = 8;
/** The synthetic participant key for the captain's own cursor. */
export declare const CAPTAIN_SYNC_KEY = "captain";
/** Normalize a flag string: trim, drop surrounding quotes models like to add. */
export declare function normalizeFlag(raw: string): string;
/** Compile the challenge flag format; falls back to the default shape. */
export declare function flagFormatRegex(challenge: ChallengeInfo | undefined): RegExp;
/** True when the flag string matches the challenge's configured format. */
export declare function flagMatchesFormat(flag: string, challenge: ChallengeInfo | undefined): boolean;
/** Human-readable format hint shared by the tools and dashboards. */
export declare function flagFormatLabel(challenge: ChallengeInfo | undefined): string;
/** Infer only the wrapper; never change any bytes of a candidate. */
export declare function flagWrapper(flag: string): string | undefined;
/** Opt-in candidate generation only: no variant is automatically submitted or verified. */
export declare function nestedFlagVariants(raw: string): string[];
export declare function batchProgress(team: TeamState): {
    verified: number;
    expected?: number;
    unscoped: number;
};
/** Explicit batch completion, after real platform checks; flags alone never close a batch. */
export declare function markChallengeSolved(team: TeamState, note: string): void;
/** A claim is unverified even if its author supplied raw output or high confidence. */
export declare function findingLabel(finding: TeamFinding): string;
export declare function formatFinding(finding: TeamFinding): string;
export declare function formatFlag(flag: FlagCandidate): string;
/** The team's challenge info with its default flag format filled in. */
export declare function challengeOf(team: TeamState): ChallengeInfo;
/** Read one participant's durable cursor; zero means "seen nothing yet". */
export declare function readCursor(team: TeamState, participant: string): SyncCursor;
/**
 * Persist one participant's cursor after a successful digest delivery.
 * `upTo` bounds the advance to exactly the sequence numbers the delivered
 * digest covered: board beats that arrive between digest computation and
 * delivery acceptance stay pending for the next round instead of being
 * skipped. Without `upTo` the cursor moves to the current board head (the
 * caller just showed everything, as the sync/report tools do).
 */
export declare function advanceCursor(team: TeamState, participant: string, upTo?: {
    findingSeq: number;
    flagSeq: number;
}): void;
/** Append one finding; advances the team round. Caller must persist. */
export declare function appendFinding(team: TeamState, input: {
    from: string;
    category?: string;
    content: string;
    evidenceKind?: TeamFinding['evidenceKind'];
    confidence?: TeamFinding['confidence'];
    evidence?: string;
}): TeamFinding;
/** Find an existing candidate that already carries this exact flag string. */
export declare function findFlagCandidate(team: TeamState, flag: string): FlagCandidate | undefined;
/** Stable across reloads and different from a recreated same-name team's reference. */
export declare function flagReference(team: TeamState, candidate: FlagCandidate): string;
/** Append one candidate flag. Duplicates return the existing candidate. Caller must persist. */
export declare function appendFlagCandidate(team: TeamState, input: {
    flag: string;
    submittedBy: string;
    evidence?: string;
    challengeId?: string;
    variantOf?: string;
}): {
    candidate: FlagCandidate;
    duplicate: boolean;
};
/** Review one candidate flag. Verified marks the challenge solved. Caller must persist. */
export declare function reviewFlagCandidate(team: TeamState, flagId: string, verdict: Exclude<FlagStatus, 'candidate'>, input: {
    by: string;
    note?: string;
    flag?: string;
    verifiedFlag?: string;
}): {
    candidate: FlagCandidate;
    solved: boolean;
};
/** Record a captain's reproducibility check and publish a new audit beat. */
export declare function verifyFinding(team: TeamState, findingId: string, input: {
    by: string;
    method: string;
    result: 'confirmed' | 'refuted' | 'inconclusive';
    note?: string;
}): TeamFinding;
/** Captain-owned challenge metadata update; merges into existing info. */
export declare function updateChallenge(team: TeamState, patch: ChallengeInfo): ChallengeInfo;
/** Everything one participant has not seen yet, oldest first. */
export interface BoardDelta {
    hasUpdates: boolean;
    findings: TeamFinding[];
    flags: FlagCandidate[];
    /** The team round when the delta was computed. */
    round: number;
    /** The challenge is solved — overrides everything else in the digest. */
    solved: boolean;
    batch?: {
        verified: number;
        expected?: number;
        unscoped: number;
    };
}
export declare function deltaSince(team: TeamState, participant: string): BoardDelta;
/** Convenience used by callers that only need the boolean. */
export declare function hasNewProgress(team: TeamState, participant: string): boolean;
/** Parse the numeric part of a stable board id (`fd3` → 3, `f12` → 12). */
export declare function boardIdNumber(id: string): number;
/** Render one digest block for a prompt or tool result. Empty when no delta. */
export declare function formatBoardDelta(delta: BoardDelta): string;

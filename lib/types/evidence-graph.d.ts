/** Finding provenance and invalidation. Reports are not promoted by repetition. */
import type { TeamFinding, TeamState } from './types.ts';
export declare function boardReference(team: TeamState): string;
export declare function findingReference(team: TeamState, finding: TeamFinding): string;
export declare function resolveFindingReference(team: TeamState, reference: string): TeamFinding;
export declare function findingUsable(finding: TeamFinding): boolean;
export declare function findingDependencies(team: TeamState, references?: readonly string[], challengeId?: string): string[];
/** Existing dependency edges are immutable; a correction is another finding. */
export declare function affectedFindings(team: TeamState, source: TeamFinding): TeamFinding[];
export declare function invalidateDependents(team: TeamState, source: TeamFinding): string[];
export declare function validateFindingReview(team: TeamState, finding: TeamFinding, result: string, supersededBy?: string): TeamFinding | undefined;
export declare function evidenceSummary(team: TeamState): {
    total: number;
    needs_recheck: number;
    superseded: number;
    captain_confirmed: number;
};

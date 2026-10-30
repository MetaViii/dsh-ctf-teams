import type { EvidenceFile } from './evidence-files.ts';
import type { TeamState } from './types.ts';
import type { HypothesisReview } from './research.ts';
export interface HypothesisTest {
    id: string;
    key: string;
    by: string;
    method: string;
    observation: string;
    outcome: 'supports' | 'refutes' | 'inconclusive';
    basis: 'construction' | 'measurement' | 'observation';
    nextStep?: string;
    files: EvidenceFile[];
    ts: number;
    validity?: 'valid' | 'infrastructure' | 'invalid';
    experimentRef?: string;
}
export interface ChallengeHypothesis {
    id: string;
    challengeId: string;
    statement: string;
    prediction: string;
    by: string;
    ts: number;
    revision: number;
    tests: HypothesisTest[];
    reviews?: HypothesisReview[];
}
export declare function requireHypothesis(team: TeamState, id: string | undefined): ChallengeHypothesis;
export declare function proposeHypothesis(team: TeamState, input: {
    by: string;
    challengeId: string;
    statement: string;
    prediction: string;
}): {
    hypothesis: ChallengeHypothesis;
    duplicate: boolean;
};
export interface RecordTestInput {
    by: string;
    hypothesisId: string;
    expectedRevision: number;
    key: string;
    method: string;
    observation: string;
    outcome: HypothesisTest['outcome'];
    basis: HypothesisTest['basis'];
    nextStep?: string;
    files: EvidenceFile[];
    validity?: HypothesisTest['validity'];
    experimentRef?: string;
}
export declare function recordHypothesisTest(team: TeamState, input: RecordTestInput): {
    hypothesis: ChallengeHypothesis;
    test: HypothesisTest;
    duplicate: boolean;
};
/** Counts describe reports only. Conflicting reports remain visible and never solve a challenge. */
export declare function hypothesisSummary(team: TeamState): {
    total: number;
    untested: number;
    tests: number;
    conflicts: number;
};
export declare function hypothesisArchive(team: TeamState): string[];

import type { EvidenceFile } from './evidence-files.ts';
import type { TeamState } from './types.ts';
export interface CaptainCheckpoint {
    revision: number;
    boardRef: string;
    stateRef: string;
    capturedAt: number;
    facts: ReturnType<typeof runtimeBrief>['facts'];
    notes: {
        assessment: string;
        disputes: string[];
        nextSteps: string[];
    };
    files: EvidenceFile[];
}
export declare function runtimeBrief(team: TeamState): {
    state_ref: string;
    facts: {
        team_id: string;
        board_ref: string;
        phase: string;
        halted: boolean;
        solved: boolean;
        round: number;
        pending_candidate_count: number;
        pending_candidates: {
            id: string;
            challenge_id: string | null;
        }[];
        open_task_count: number;
        open_tasks: {
            id: string;
            subject: string;
            status: import("./types.ts").TaskStatus;
            assignee: string | null;
            attempt_id: string | null;
            challenge_id: string | null;
            resource_key: string | null;
        }[];
        resources: {
            task_id: string;
            resource_key: string | undefined;
            owner: string | undefined;
        }[];
        research: {
            plans: number;
            focused: number;
            needs_review: number;
        };
        evidence: {
            total: number;
            needs_recheck: number;
            superseded: number;
            captain_confirmed: number;
        };
        needs_recheck: string[];
        max_parallel_lanes: number | null;
        truncated: boolean;
    };
};
export declare function saveCaptainCheckpoint(team: TeamState, input: {
    boardRef: string;
    stateRef: string;
    expectedRevision: number;
    assessment: string;
    disputes?: string[];
    nextSteps: string[];
    files: EvidenceFile[];
}): {
    checkpoint: CaptainCheckpoint;
    duplicate: boolean;
};
export declare function checkpointSummary(team: TeamState): {
    revision: number;
    captured_at: number;
    stale: boolean;
    next_steps: string[];
} | null;
/** Read-only planning signals; repeated ordinary reports do not count as experiments. */
export declare function planningSignals(team: TeamState): {
    challenge_id: string | null;
    active_lanes: number;
    queued_tasks: number;
    max_parallel_lanes: number | null;
    reported_experiments: number;
    last_reported_experiment_at: number | null;
    needs_recheck: number;
    next_counterchecks: string[];
    guidance: string;
}[];

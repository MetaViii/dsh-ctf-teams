import { type HypothesisTest } from './hypotheses.ts';
import type { EvidenceFile } from './evidence-files.ts';
import type { TeamState } from './types.ts';
export interface HypothesisReview {
    revision: number;
    testIds: string[];
    verdict: 'supported' | 'refuted' | 'inconclusive';
    reason: string;
    ts: number;
}
export interface ExperimentPlan {
    id: string;
    challengeId: string;
    hypothesisId: string;
    alternatives: string[];
    coverageKey: string;
    owner: string;
    taskId?: string;
    attemptId?: string;
    method: string;
    ifTrue: string;
    ifFalse: string;
    kind: 'control' | 'discriminator' | 'exploit';
    estimatedSeconds: number;
    budgetSeconds: number;
    maxRuns: number;
    revision: number;
    state: 'planned' | 'running' | 'reported' | 'stopped' | 'closed';
    createdAt: number;
    spentMs: number;
    clockStarted?: number;
    cycle: number;
    runs: {
        jobId: string;
        ts: number;
        timeoutMs: number;
        cycle: number;
    }[];
    report?: {
        testId: string;
        validity: 'valid' | 'infrastructure' | 'invalid';
        ts: number;
    };
    decisions: {
        action: string;
        by: string;
        reason: string;
        ts: number;
        revision: number;
    }[];
}
export declare const RESEARCH_PROMPT = "For a difficult or uncertain challenge, use ctf_teams_hypothesis for competing explanations, then ctf_teams_experiment(action=\"plan\") before expensive exploitation or brute force. State a reproducible method, a positive observable, a falsifying observable, a stable coverage_key for the same input/target/parameters, estimated cost and a bounded run/time budget. Include a cheap control that can disprove the shared premise; a 500, timeout or failed tool is not scientific refutation. action=\"next\" gives a transparent cost-first shortlist, not a probability of success. Test distinct hypotheses instead of assigning several agents the same premise. Use the returned experiment_ref in ctf_teams_exec. Once focused, omitting/changing the reference cannot bypass that owner's review boundary. Docker admission limits runs and caps each command to the remaining experiment time. Read jobs/logs and report observation, validity and evidence. The captain reviews named test IDs and reasons, not a vote count. Reviewed refutation and repeated valid inconclusive tests require review before further experiments. Only the captain may release/reopen a route with a reason; reopen preserves history and cannot erase a refutation. Team pause freezes the clock and preserves plans, without granting old task attempts new authority. Native shells and other tools are not governed by Docker experiment budgets.";
export declare const experimentRef: (team: TeamState, plan: ExperimentPlan) => string;
export declare function requireExperiment(team: TeamState, ref: string | undefined): ExperimentPlan;
export declare function hypothesisGate(team: TeamState, id: string): string | undefined;
export declare function remainingMs(plan: ExperimentPlan, now?: number): number;
export declare function pauseExperiments(team: TeamState, now?: number): void;
export declare function planExperiment(team: TeamState, input: {
    owner: string;
    taskId?: string;
    attemptId?: string;
    hypothesisId: string;
    alternatives?: string[];
    coverageKey: string;
    method: string;
    ifTrue: string;
    ifFalse: string;
    kind: ExperimentPlan['kind'];
    estimatedSeconds: number;
    budgetSeconds?: number;
    maxRuns?: number;
}): {
    plan: ExperimentPlan;
    duplicate: boolean;
};
export interface ResearchActor {
    owner: string;
    taskId?: string;
    attemptId?: string;
}
export declare function focusedExperiment(team: TeamState, actor: ResearchActor, ref?: string): ExperimentPlan | undefined;
export declare function reserveExperimentRun(team: TeamState, actor: ResearchActor, ref: string | undefined, jobId: string, requestedTimeoutMs: number): {
    timeoutMs: number;
    experimentRef?: undefined;
} | {
    timeoutMs: number;
    experimentRef: string;
};
export declare function reportExperiment(team: TeamState, plan: ExperimentPlan, input: {
    by: string;
    expectedHypothesisRevision: number;
    observation: string;
    outcome: HypothesisTest['outcome'];
    basis: HypothesisTest['basis'];
    nextStep?: string;
    validity: 'valid' | 'infrastructure' | 'invalid';
    files: EvidenceFile[];
}): {
    hypothesis: import("./hypotheses.ts").ChallengeHypothesis;
    test: HypothesisTest;
    duplicate: boolean;
};
export declare function reviewHypothesis(team: TeamState, id: string, input: {
    testIds: string[];
    verdict: HypothesisReview['verdict'];
    reason: string;
    expectedRevision: number;
}): {
    review: HypothesisReview;
    duplicate: boolean;
    stopped: ExperimentPlan[];
};
export declare function decideExperiment(team: TeamState, plan: ExperimentPlan, input: {
    action: 'stop' | 'release' | 'reopen';
    by: string;
    captain: boolean;
    reason: string;
    expectedRevision: number;
    bindTaskId?: string;
    bindAttemptId?: string;
    owner?: string;
}): void;
export declare function experimentView(team: TeamState, plan: ExperimentPlan): {
    experiment_ref: string;
    id: string;
    hypothesis_id: string;
    challenge_id: string;
    owner: string;
    task_id: string | undefined;
    attempt_id: string | undefined;
    coverage_key: string;
    state: "planned" | "running" | "reported" | "stopped" | "closed";
    revision: number;
    kind: "control" | "discriminator" | "exploit";
    estimated_seconds: number;
    remaining_ms: number;
    runs_used: number;
    max_runs: number;
    task_scope_current: boolean;
    focus_ref: string | undefined;
    gate: string | null;
};
export declare function experimentFrontier(team: TeamState, challengeId?: string): {
    policy: string;
    candidates: {
        distinguishes: string[];
        if_true: string;
        if_false: string;
        method: string;
        experiment_ref: string;
        id: string;
        hypothesis_id: string;
        challenge_id: string;
        owner: string;
        task_id: string | undefined;
        attempt_id: string | undefined;
        coverage_key: string;
        state: "planned" | "running" | "reported" | "stopped" | "closed";
        revision: number;
        kind: "control" | "discriminator" | "exploit";
        estimated_seconds: number;
        remaining_ms: number;
        runs_used: number;
        max_runs: number;
        task_scope_current: boolean;
        focus_ref: string | undefined;
        gate: string | null;
    }[];
    needs_review: {
        experiment_ref: string;
        id: string;
        hypothesis_id: string;
        challenge_id: string;
        owner: string;
        task_id: string | undefined;
        attempt_id: string | undefined;
        coverage_key: string;
        state: "planned" | "running" | "reported" | "stopped" | "closed";
        revision: number;
        kind: "control" | "discriminator" | "exploit";
        estimated_seconds: number;
        remaining_ms: number;
        runs_used: number;
        max_runs: number;
        task_scope_current: boolean;
        focus_ref: string | undefined;
        gate: string | null;
    }[];
    total: number;
};
export declare function researchSummary(team: TeamState): {
    plans: number;
    focused: number;
    needs_review: number;
};

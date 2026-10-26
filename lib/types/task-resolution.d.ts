import type { TeamState } from './types.ts';
export declare function resolveFailedTask(team: TeamState, input: {
    taskId: string;
    expectedAttempt: number;
    flagRef: string;
    evidence: string;
}): {
    task: import("./types.ts").TeamTask;
    duplicate: boolean;
};

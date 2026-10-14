import type { TeamState, TeamTask } from './types.ts';
export declare function validatePreflight(values: readonly string[]): void;
/** Pure admission over fresh read-only platform facts; unknown never means passed. */
export declare function taskBlockReason(team: TeamState, task: TeamTask, now?: number): string | undefined;
export declare function dispatchState(team: TeamState, task: TeamTask): {
    dispatch_state: string;
    dispatch_reason?: string;
};

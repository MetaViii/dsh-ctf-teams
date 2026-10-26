/** Explicit captain reconciliation, never automatic completion from a shared challenge id. */
import { flagReference } from "./findings.js";
export function resolveFailedTask(team, input) {
    const task = team.tasks.find(row => row.id === input.taskId);
    if (!task)
        throw new Error('unknown task_id');
    if (!input.evidence.trim() || input.evidence.length > 4000)
        throw new Error('evidence requires 1..4000 characters describing the fulfilled task contract');
    if (!Number.isSafeInteger(input.expectedAttempt) || input.expectedAttempt !== (task.attempt ?? 0))
        throw new Error('stale expected_attempt; read current task before resolving');
    if (task.resolution?.flagRef === input.flagRef && task.resolution.evidence === input.evidence.trim() && task.status === 'completed')
        return { task, duplicate: true };
    if (task.status !== 'failed' || (task.kind ?? 'work') !== 'work')
        throw new Error('only failed ordinary work can be reconciled; review/repair/requirements gates remain strict');
    if (task.reassigning || !task.challengeId)
        throw new Error('task needs a stable challenge_id and no active handoff');
    const flag = team.flags?.find(row => flagReference(team, row) === input.flagRef);
    if (!flag || flag.status !== 'verified' || flag.challengeId !== task.challengeId)
        throw new Error('flag_ref must identify a platform-verified candidate for this exact team generation and challenge');
    task.resolution = { by: 'captain', at: Date.now(), flagRef: input.flagRef, evidence: input.evidence.trim(), failedOutput: task.output ?? '', attempt: task.attempt ?? 0 };
    task.status = 'completed';
    task.output = input.evidence.trim();
    task.updatedAt = Date.now();
    delete task.attemptId;
    return { task, duplicate: false };
}

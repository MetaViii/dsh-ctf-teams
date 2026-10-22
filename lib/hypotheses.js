/** Append-only challenge hypotheses and reported experiments. Caller holds team lock. */
import { appendFinding } from "./findings.js";
function text(value, name, max = 4000) {
    if (!value?.trim() || value.length > max)
        throw new Error(`${name} must contain 1..${max} characters`);
    return value.trim();
}
export function requireHypothesis(team, id) {
    const hypothesis = team.hypotheses?.find(item => item.id === id);
    if (!hypothesis)
        throw new Error('unknown hypothesis_id; list the current team ledger first');
    return hypothesis;
}
export function proposeHypothesis(team, input) {
    const challengeId = text(input.challengeId, 'challenge_id', 200);
    const statement = text(input.statement, 'statement', 2000);
    const prediction = text(input.prediction, 'prediction', 2000);
    const existing = team.hypotheses?.find(item => item.challengeId === challengeId && item.statement === statement && item.prediction === prediction);
    if (existing)
        return { hypothesis: existing, duplicate: true };
    const id = `h${(team.hypothesisSeq ?? 0) + 1}`;
    const hypothesis = { id, challengeId, statement, prediction, by: input.by, ts: Date.now(), revision: 1, tests: [] };
    team.hypothesisSeq = (team.hypothesisSeq ?? 0) + 1;
    (team.hypotheses ??= []).push(hypothesis);
    appendFinding(team, { from: input.by, category: 'hypothesis', evidenceKind: 'guess', content: `[${id}; challenge=${challengeId}] ${statement}; prediction: ${prediction}. Consult ctf_teams_hypothesis for complete history.` });
    return { hypothesis, duplicate: false };
}
export function recordHypothesisTest(team, input) {
    const hypothesis = requireHypothesis(team, input.hypothesisId);
    const data = { by: input.by, key: text(input.key, 'test_key', 160), method: text(input.method, 'method'), observation: text(input.observation, 'observation'), outcome: input.outcome, basis: input.basis,
        ...(input.nextStep === undefined ? {} : { nextStep: text(input.nextStep, 'next_step', 2000) }), files: input.files };
    if (!['supports', 'refutes', 'inconclusive'].includes(data.outcome) || !['construction', 'measurement', 'observation'].includes(data.basis))
        throw new Error('invalid outcome or basis');
    if (data.basis === 'measurement' && data.outcome === 'refutes' && !data.nextStep)
        throw new Error('measurement-based refutation requires next_step to distinguish uncertainty from a constructive counterexample');
    const same = hypothesis.tests.find(test => test.by === data.by && test.key === data.key);
    if (same) {
        const comparable = (test) => JSON.stringify({ ...test, files: test.files.map(({ path, sha256, bytes }) => ({ path, sha256, bytes })) });
        const { id: _id, ts: _ts, ...original } = same;
        if (comparable(original) !== comparable(data))
            throw new Error('test_key already recorded with different content; use a new key for a correction');
        return { hypothesis, test: same, duplicate: true };
    }
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== hypothesis.revision)
        throw new Error(`stale expected_revision; list and reconcile current revision ${hypothesis.revision}`);
    const test = { ...data, id: `e${hypothesis.tests.length + 1}`, ts: Date.now() };
    hypothesis.tests.push(test);
    hypothesis.revision++;
    appendFinding(team, { from: data.by, category: 'experiment', evidenceKind: 'inference', content: `[${hypothesis.id}/${test.id}; challenge=${hypothesis.challengeId}] REPORTED ${test.outcome} (${test.basis}); ${test.observation}; next: ${test.nextStep ?? 'independent reproduction required'}`, evidence: test.method });
    return { hypothesis, test, duplicate: false };
}
/** Counts describe reports only. Conflicting reports remain visible and never solve a challenge. */
export function hypothesisSummary(team) {
    const hypotheses = team.hypotheses ?? [];
    return { total: hypotheses.length, untested: hypotheses.filter(item => !item.tests.length).length, tests: hypotheses.reduce((n, item) => n + item.tests.length, 0),
        conflicts: hypotheses.filter(item => item.tests.some(test => test.outcome === 'supports') && item.tests.some(test => test.outcome === 'refutes')).length };
}
export function hypothesisArchive(team) {
    return (team.hypotheses ?? []).flatMap(item => [
        `- ${item.id} [challenge=${item.challengeId}; revision=${item.revision}] ${item.statement}`,
        `  Prediction: ${item.prediction}; proposed by ${item.by}`,
        ...item.tests.flatMap(test => [`  - ${test.id}: REPORTED ${test.outcome}; basis=${test.basis}; by=${test.by}; method: ${test.method}; observation: ${test.observation}${test.nextStep ? `; next: ${test.nextStep}` : ''}`,
            ...test.files.map(file => `    File snapshot: ${file.path}; sha256=${file.sha256}; bytes=${file.bytes}; captured_at=${file.capturedAt} (integrity only)`)]),
    ]);
}

/** Bounded experiments. Reports and captain judgments remain claims, never platform verdicts. */
import { boardReference } from "./evidence-graph.js";
import { appendFinding } from "./findings.js";
import { requireHypothesis, recordHypothesisTest } from "./hypotheses.js";
export const RESEARCH_PROMPT = `For a difficult or uncertain challenge, use ctf_teams_hypothesis for competing explanations, then ctf_teams_experiment(action="plan") before expensive exploitation or brute force. State a reproducible method, a positive observable, a falsifying observable, a stable coverage_key for the same input/target/parameters, estimated cost and a bounded run/time budget. Include a cheap control that can disprove the shared premise; a 500, timeout or failed tool is not scientific refutation. action="next" gives a transparent cost-first shortlist, not a probability of success. Test distinct hypotheses instead of assigning several agents the same premise. Use the returned experiment_ref in ctf_teams_exec. Once focused, omitting/changing the reference cannot bypass that owner's review boundary. Docker admission limits runs and caps each command to the remaining experiment time. Read jobs/logs and report observation, validity and evidence. The captain reviews named test IDs and reasons, not a vote count. Reviewed refutation and repeated valid inconclusive tests require review before further experiments. Only the captain may release/reopen a route with a reason; reopen preserves history and cannot erase a refutation. Team pause freezes the clock and preserves plans, without granting old task attempts new authority. Native shells and other tools are not governed by Docker experiment budgets.`;
function text(value, name, max = 2000) {
    if (!value?.trim() || value.length > max)
        throw new Error(`${name} must contain 1..${max} characters`);
    return value.trim();
}
function integer(value, name, max) {
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
        throw new Error(`invalid ${name}`);
    return value;
}
export const experimentRef = (team, plan) => boardReference(team) + '/' + plan.id;
export function requireExperiment(team, ref) {
    const plan = team.experiments?.find(p => experimentRef(team, p) === ref);
    if (!plan)
        throw new Error('unknown or stale experiment_ref; list current team plans');
    return plan;
}
export function hypothesisGate(team, id) {
    const h = requireHypothesis(team, id), review = h.reviews?.at(-1);
    if (review?.verdict === 'refuted')
        return 'captain-reviewed refutation; revise the premise or explicitly reconsider its named evidence';
    const valid = h.tests.filter(t => !t.validity || t.validity === 'valid');
    if (valid.slice(-2).length === 2 && valid.slice(-2).every(t => t.outcome === 'inconclusive') && review?.revision !== h.revision)
        return 'two valid inconclusive reports; captain review required before more work on this hypothesis';
    return undefined;
}
export function remainingMs(plan, now = Date.now()) {
    return Math.max(0, plan.budgetSeconds * 1000 - plan.spentMs - (plan.clockStarted === undefined ? 0 : Math.max(0, now - plan.clockStarted)));
}
function freeze(plan, now = Date.now()) {
    if (plan.clockStarted !== undefined) {
        plan.spentMs += Math.max(0, now - plan.clockStarted);
        delete plan.clockStarted;
    }
}
export function pauseExperiments(team, now = Date.now()) {
    for (const plan of team.experiments ?? [])
        freeze(plan, now);
}
export function planExperiment(team, input) {
    const h = requireHypothesis(team, input.hypothesisId), alternatives = [...new Set(input.alternatives ?? [])];
    if (alternatives.length > 5 || alternatives.includes(h.id) || alternatives.some(id => requireHypothesis(team, id).challengeId !== h.challengeId))
        throw new Error('alternatives must reference 0..5 other hypotheses of the same challenge');
    const data = { challengeId: h.challengeId, hypothesisId: h.id, alternatives, coverageKey: text(input.coverageKey, 'coverage_key', 160),
        method: text(input.method, 'method'), ifTrue: text(input.ifTrue, 'if_true'), ifFalse: text(input.ifFalse, 'if_false'), kind: input.kind,
        estimatedSeconds: integer(input.estimatedSeconds, 'estimated_seconds', 3600), budgetSeconds: integer(input.budgetSeconds ?? 300, 'budget_seconds', 3600), maxRuns: integer(input.maxRuns ?? 3, 'max_runs', 20) };
    if (!['control', 'discriminator', 'exploit'].includes(data.kind) || data.ifTrue === data.ifFalse || data.estimatedSeconds > data.budgetSeconds)
        throw new Error('distinct observables and a valid kind/cost within budget are required');
    const duplicate = team.experiments?.find(p => p.challengeId === h.challengeId && p.coverageKey === data.coverageKey);
    if (duplicate)
        return { plan: duplicate, duplicate: true };
    const plan = { ...data, id: `xp${(team.experimentSeq ?? 0) + 1}`, owner: input.owner, taskId: input.taskId, attemptId: input.attemptId,
        revision: 1, state: 'planned', createdAt: Date.now(), spentMs: 0, cycle: 1, runs: [], decisions: [] };
    team.experimentSeq = (team.experimentSeq ?? 0) + 1;
    (team.experiments ??= []).push(plan);
    return { plan, duplicate: false };
}
function focusOf(team, owner) {
    return team.experimentFocus && Object.hasOwn(team.experimentFocus, owner) ? team.experimentFocus[owner] : undefined;
}
function currentScope(team, plan) {
    if (!plan.taskId)
        return plan.owner === 'captain';
    return team.tasks.some(t => t.id === plan.taskId && t.assignee === plan.owner && t.attemptId === plan.attemptId && !t.reassigning && ['claimed', 'in_progress'].includes(t.status));
}
export function focusedExperiment(team, actor, ref) {
    const focused = focusOf(team, actor.owner);
    const plan = ref ? requireExperiment(team, ref) : focused ? requireExperiment(team, focused) : undefined;
    if (focused && plan && focused !== experimentRef(team, plan))
        throw new Error('current experiment requires report/review; changing experiment_ref cannot bypass it');
    if (!plan)
        return undefined;
    if (plan.owner !== actor.owner || plan.taskId !== actor.taskId || plan.attemptId !== actor.attemptId)
        throw new Error('experiment belongs to another owner or task attempt; captain release/replan required');
    if (!['planned', 'running'].includes(plan.state))
        throw new Error(`experiment ${plan.state}; captain review/release required`);
    const reason = hypothesisGate(team, plan.hypothesisId);
    if (reason)
        throw new Error(reason);
    if (remainingMs(plan) <= 0 || plan.runs.filter(r => r.cycle === plan.cycle).length >= plan.maxRuns)
        throw new Error('experiment stop-loss reached; read logs, report evidence and ask captain to review/release or explicitly reopen');
    return plan;
}
export function reserveExperimentRun(team, actor, ref, jobId, requestedTimeoutMs) {
    const plan = focusedExperiment(team, actor, ref);
    if (!plan)
        return { timeoutMs: requestedTimeoutMs };
    const now = Date.now(), timeoutMs = Math.min(requestedTimeoutMs, Math.floor(remainingMs(plan, now)));
    if (timeoutMs < 1)
        throw new Error('experiment time budget exhausted');
    plan.clockStarted ??= now;
    plan.state = 'running';
    plan.revision++;
    plan.runs.push({ jobId, ts: now, timeoutMs, cycle: plan.cycle });
    Object.defineProperty(team.experimentFocus ??= {}, actor.owner, { value: experimentRef(team, plan), enumerable: true, configurable: true, writable: true });
    return { timeoutMs, experimentRef: experimentRef(team, plan) };
}
export function reportExperiment(team, plan, input) {
    if (!['valid', 'infrastructure', 'invalid'].includes(input.validity) || input.validity !== 'valid' && input.outcome !== 'inconclusive')
        throw new Error('invalid/infrastructure experiments must be inconclusive, never scientific refutation');
    if (!plan.runs.length || !['running', 'stopped', 'reported'].includes(plan.state))
        throw new Error('experiment must have a recorded execution before reporting');
    if (!plan.runs.some(r => r.cycle === plan.cycle))
        throw new Error('current cycle has no execution');
    const result = recordHypothesisTest(team, { by: input.by, hypothesisId: plan.hypothesisId, expectedRevision: input.expectedHypothesisRevision,
        key: `${plan.id}-cycle-${plan.cycle}`, method: plan.method, observation: input.observation, outcome: input.outcome, basis: input.basis, nextStep: input.nextStep, files: input.files, validity: input.validity, experimentRef: experimentRef(team, plan) });
    if (!result.duplicate) {
        freeze(plan);
        plan.state = 'reported';
        plan.report = { testId: result.test.id, validity: input.validity, ts: Date.now() };
        plan.revision++;
    }
    return result;
}
export function reviewHypothesis(team, id, input) {
    const h = requireHypothesis(team, id), testIds = [...new Set(input.testIds)], reason = text(input.reason, 'reason');
    if (input.expectedRevision !== h.revision || !testIds.length || testIds.length > 20 || testIds.some(id => !h.tests.some(t => t.id === id)) || !['supported', 'refuted', 'inconclusive'].includes(input.verdict))
        throw new Error('review requires current hypothesis revision and 1..20 existing test IDs');
    if (input.verdict !== 'inconclusive' && h.tests.some(t => testIds.includes(t.id) && t.validity && t.validity !== 'valid'))
        throw new Error('infrastructure/invalid reports cannot establish support or refutation');
    if (input.verdict !== 'inconclusive' && !h.tests.some(t => testIds.includes(t.id) && t.outcome === (input.verdict === 'refuted' ? 'refutes' : 'supports')))
        throw new Error('review requires a named test reporting the matching outcome');
    const review = { revision: h.revision, testIds, verdict: input.verdict, reason, ts: Date.now() }, previous = h.reviews?.at(-1);
    if (previous && JSON.stringify({ ...previous, ts: 0 }) === JSON.stringify({ ...review, ts: 0 }))
        return { review: previous, duplicate: true, stopped: [] };
    (h.reviews ??= []).push(review);
    appendFinding(team, { from: 'captain', challengeId: h.challengeId, category: 'hypothesis-review', claimType: 'decision', evidenceKind: 'inference', content: `[${h.id}; revision=${h.revision}] Captain REPORTED ${review.verdict}; tests=${testIds.join(',')}; ${reason}. Inspect ctf_teams_hypothesis history before reusing this premise.`, evidence: 'Named experiment IDs: ' + testIds.join(',') });
    const stopped = input.verdict === 'refuted' ? (team.experiments ?? []).filter(p => p.hypothesisId === h.id && p.state === 'running') : [];
    for (const plan of stopped)
        decideExperiment(team, plan, { action: 'stop', by: 'captain', captain: true, reason: `Reviewed counterevidence ${h.id}/${testIds.join(',')}: ${reason}`, expectedRevision: plan.revision });
    return { review, duplicate: false, stopped };
}
export function decideExperiment(team, plan, input) {
    const reason = text(input.reason, 'reason');
    if (input.expectedRevision !== plan.revision)
        throw new Error('stale experiment expected_revision');
    if (!input.captain && (input.action !== 'stop' || plan.owner !== input.by))
        throw new Error('only captain may release/reopen a route');
    if (input.action === 'reopen' && hypothesisGate(team, plan.hypothesisId))
        throw new Error('review the hypothesis evidence before reopening this route');
    const binding = { ...plan, owner: input.owner ?? plan.owner, taskId: input.bindTaskId ?? plan.taskId, attemptId: input.bindAttemptId ?? plan.attemptId };
    if (input.action === 'reopen' && (!currentScope(team, binding) || focusOf(team, binding.owner) && focusOf(team, binding.owner) !== experimentRef(team, plan)))
        throw new Error('reopen requires an available owner/current task attempt without another focused experiment; supply bind_task_id/bind_attempt_id when needed');
    freeze(plan);
    if (input.action === 'reopen') {
        if (team.experimentFocus && focusOf(team, plan.owner) === experimentRef(team, plan))
            delete team.experimentFocus[plan.owner];
        plan.owner = binding.owner;
        plan.taskId = binding.taskId;
        plan.attemptId = binding.attemptId;
        plan.cycle++;
        plan.spentMs = 0;
        plan.state = 'planned';
        delete plan.report;
        Object.defineProperty(team.experimentFocus ??= {}, plan.owner, { value: experimentRef(team, plan), enumerable: true, configurable: true, writable: true });
    }
    else
        plan.state = input.action === 'stop' ? 'stopped' : 'closed';
    plan.revision++;
    plan.decisions.push({ action: input.action, by: input.by, reason: reason + (input.action === 'reopen' ? `; binding=${JSON.stringify({ owner: plan.owner, task_id: plan.taskId, attempt_id: plan.attemptId })}` : ''), ts: Date.now(), revision: plan.revision });
    if (input.action === 'release' && team.experimentFocus?.[plan.owner] === experimentRef(team, plan))
        delete team.experimentFocus[plan.owner];
}
export function experimentView(team, plan) {
    return { experiment_ref: experimentRef(team, plan), id: plan.id, hypothesis_id: plan.hypothesisId, challenge_id: plan.challengeId, owner: plan.owner, task_id: plan.taskId, attempt_id: plan.attemptId,
        coverage_key: plan.coverageKey, state: plan.state, revision: plan.revision, kind: plan.kind, estimated_seconds: plan.estimatedSeconds, remaining_ms: remainingMs(plan), runs_used: plan.runs.filter(r => r.cycle === plan.cycle).length, max_runs: plan.maxRuns,
        task_scope_current: currentScope(team, plan), focus_ref: focusOf(team, plan.owner),
        gate: !currentScope(team, plan) ? 'stale_task_attempt' : hypothesisGate(team, plan.hypothesisId) ?? (focusOf(team, plan.owner) && focusOf(team, plan.owner) !== experimentRef(team, plan) ? 'another_experiment_focused' : remainingMs(plan) <= 0 || plan.runs.filter(r => r.cycle === plan.cycle).length >= plan.maxRuns ? 'budget_review_required' : null) };
}
export function experimentFrontier(team, challengeId) {
    const all = (team.experiments ?? []).filter(p => challengeId === undefined || p.challengeId === challengeId);
    const tier = (p) => p.estimatedSeconds <= 30 ? 0 : p.estimatedSeconds <= 120 ? 1 : 2;
    const ready = all.filter(p => p.state === 'planned' && !experimentView(team, p).gate).sort((a, b) => tier(a) - tier(b) || (a.kind === 'control' ? 0 : 1) - (b.kind === 'control' ? 0 : 1) || b.alternatives.length - a.alternatives.length || a.estimatedSeconds - b.estimatedSeconds || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    return { policy: 'cost bands <=30s, <=120s, >120s; then controls, declared alternatives, estimated seconds, creation order. Estimates/observables are claims, not probabilities.',
        candidates: ready.slice(0, 5).map(p => ({ ...experimentView(team, p), distinguishes: [p.hypothesisId, ...p.alternatives], if_true: p.ifTrue, if_false: p.ifFalse, method: p.method })),
        needs_review: all.filter(p => p.state !== 'closed' && (!!hypothesisGate(team, p.hypothesisId) || ['reported', 'stopped'].includes(p.state) || remainingMs(p) <= 0 || p.runs.filter(r => r.cycle === p.cycle).length >= p.maxRuns)).slice(0, 10).map(p => experimentView(team, p)), total: all.length };
}
export function researchSummary(team) {
    const plans = team.experiments ?? [];
    return { plans: plans.length, focused: Object.keys(team.experimentFocus ?? {}).length, needs_review: plans.filter(p => p.state !== 'closed' && (!!hypothesisGate(team, p.hypothesisId) || ['reported', 'stopped'].includes(p.state) || remainingMs(p) <= 0 || p.runs.filter(r => r.cycle === p.cycle).length >= p.maxRuns)).length };
}

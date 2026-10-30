import { defineTool } from '@deepseek-ai/dsh-tools';
import { captureEvidenceFiles } from "./evidence-files.js";
import { boardReference } from "./evidence-graph.js";
import { requireExecutionPolicy } from "./execution-tools.js";
import { runtimeScope, readRuntimeJob, cancelRuntimeJob } from "./docker-runtime.js";
import { planExperiment, requireExperiment, experimentView, experimentFrontier, focusedExperiment, reserveExperimentRun, reportExperiment, reviewHypothesis, decideExperiment, researchSummary } from "./research.js";
const json = (value) => JSON.parse(JSON.stringify(value));
export function registerResearchTools(ctx, authorize) {
    const hooks = {
        async check(exec, taskId, attemptId, ref) {
            await authorize(exec, { mutate: true, command: true, taskId, attemptId, updateState: a => {
                    requireExecutionPolicy(a.agent);
                    focusedExperiment(a.team, a, ref);
                    return false;
                } });
        },
        async reserve(exec, jobId, timeoutMs, taskId, attemptId, ref) {
            let result = { timeoutMs };
            await authorize(exec, { mutate: true, command: true, taskId, attemptId, updateState: a => {
                    requireExecutionPolicy(a.agent);
                    result = reserveExperimentRun(a.team, a, ref, jobId, timeoutMs);
                    return !!result.experimentRef;
                } });
            return result;
        },
    };
    async function jobs(a, p) {
        const scope = runtimeScope(a.workspace, a.team);
        const out = [];
        for (const run of p.runs.filter(r => r.cycle === p.cycle))
            out.push(await readRuntimeJob(scope, run.jobId, p.owner, true));
        return out;
    }
    ctx.tools.register(defineTool({
        name: 'ctf_teams_experiment',
        description: 'Choose and bound difficult-challenge experiments. next/list are read-only. plan records distinct positive/falsifying observables, coverage key and cost; it never executes. Use experiment_ref in ctf_teams_exec for Docker run/time stop-loss. report links finished jobs to unverified hypothesis evidence. Only captain reviews named tests or releases/reopens a route with a reason. stop cancels owned jobs and retains work. No timers/model wakeups or automatic solve verdicts. Old unplanned commands retain compatibility; once focused, an owner cannot omit/change the reference to evade review.',
        parameters: {
            action: { type: 'string', required: true, enum: ['next', 'list', 'plan', 'report', 'review', 'stop', 'release', 'reopen'] },
            ledger_ref: { type: 'string', description: 'All mutations: exact current ledger_ref. Read next/list first.' },
            experiment_ref: { type: 'string', description: 'Exact generation-bound reference from plan/list; report/stop/release/reopen.' },
            challenge_id: { type: 'string', description: 'Optional read filter.' },
            hypothesis_id: { type: 'string', description: 'plan/review: existing hypothesis in the same team.' },
            alternatives: { type: 'array', items: { type: 'string' }, description: 'plan: up to 5 other hypotheses distinguished by this test; same challenge.' },
            coverage_key: { type: 'string', description: 'plan: stable input/target/parameter identity, 1..160 chars. Cross-member duplicate work returns the original plan.' },
            method: { type: 'string', description: 'plan: reproducible test method, at most 2000 chars. Data only.' },
            if_true: { type: 'string', description: 'plan: expected observable if the main hypothesis holds.' },
            if_false: { type: 'string', description: 'plan: observable that would falsify the main hypothesis.' },
            kind: { type: 'string', enum: ['control', 'discriminator', 'exploit'] },
            estimated_seconds: { type: 'number', description: 'plan: estimated cost, 1..3600, not a success probability.' },
            budget_seconds: { type: 'number', description: 'plan: active wall-time budget from first launch, default 300; 1..3600. Team halt freezes it.' },
            max_runs: { type: 'number', description: 'plan: max Docker commands this cycle, default 3, max 20.' },
            task_id: { type: 'string' }, attempt_id: { type: 'string' },
            bind_task_id: { type: 'string', description: 'captain reopen: explicit current task binding after pause/reassignment.' },
            bind_attempt_id: { type: 'string' }, owner: { type: 'string', description: 'captain reopen: explicitly transfer to this current task owner; history remains.' },
            expected_revision: { type: 'number', description: 'stop/release/reopen: current experiment revision. review/report: current hypothesis revision.' },
            observation: { type: 'string', description: 'report: actual observation, at most 4000 chars.' },
            outcome: { type: 'string', enum: ['supports', 'refutes', 'inconclusive'] },
            basis: { type: 'string', enum: ['construction', 'measurement', 'observation'] },
            validity: { type: 'string', enum: ['valid', 'infrastructure', 'invalid'], description: 'report: non-valid tests must be inconclusive.' },
            next_step: { type: 'string' }, evidence_files: { type: 'array', items: { type: 'string' } },
            test_ids: { type: 'array', items: { type: 'string' }, description: 'review: 1..20 hypothesis test IDs inspected by captain.' },
            verdict: { type: 'string', enum: ['supported', 'refuted', 'inconclusive'] },
            reason: { type: 'string', description: 'review/stop/release/reopen: concrete justification, at most 2000 chars.' },
            offset: { type: 'number' }, limit: { type: 'number', description: 'list: default 10, max 20.' },
        },
        output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }] },
        async execute(args, exec) {
            const read = args.action === 'list' || args.action === 'next', cleanup = args.action === 'stop';
            const a = await authorize(exec, { mutate: !read && !cleanup, taskId: args.task_id, attemptId: args.attempt_id, command: args.action === 'plan' });
            if (!read && args.ledger_ref !== boardReference(a.team))
                throw new Error('missing or stale ledger_ref; read next/list first');
            if (read) {
                const base = { ledger_ref: boardReference(a.team), summary: researchSummary(a.team), note: 'Plans, observations, cost estimates and captain judgments are claims. No task or flag is completed by this tool.' };
                if (args.action === 'next')
                    return json({ ...base, ...experimentFrontier(a.team, args.challenge_id) });
                if (args.experiment_ref) {
                    const p = requireExperiment(a.team, args.experiment_ref);
                    return json({ ...base, plan: { ...p, ...experimentView(a.team, p), runs: p.runs.slice(-20), decisions: p.decisions.slice(-10), history_truncated: p.runs.length > 20 || p.decisions.length > 10 } });
                }
                const offset = args.offset ?? 0, limit = args.limit ?? 10;
                if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20)
                    throw new Error('invalid offset/limit');
                const all = (a.team.experiments ?? []).filter(p => args.challenge_id === undefined || p.challengeId === args.challenge_id);
                return json({ ...base, plans: all.slice(offset, offset + limit).map(p => experimentView(a.team, p)), total: all.length, next_offset: offset + limit < all.length ? offset + limit : null });
            }
            let before;
            if (['report', 'stop', 'release', 'reopen'].includes(args.action)) {
                before = requireExperiment(a.team, args.experiment_ref);
                if (before.owner !== a.owner && (!a.captain || args.action === 'report'))
                    throw new Error('experiment owner mismatch');
                if (args.action !== 'stop' && (await jobs(a, before)).some(j => ['running', 'starting'].includes(j.status)))
                    throw new Error('experiment still has active jobs; inspect or stop them before report/release/reopen');
            }
            const files = args.action === 'report' ? await captureEvidenceFiles(a.workspace, args.evidence_files) : [];
            let output;
            const reviewStops = [];
            await authorize(exec, { mutate: !cleanup, taskId: args.task_id, attemptId: args.attempt_id, command: args.action === 'plan', updateState: fresh => {
                    if (args.ledger_ref !== boardReference(fresh.team))
                        throw new Error('stale ledger_ref');
                    if (!cleanup)
                        requireExecutionPolicy(fresh.agent);
                    const p = args.experiment_ref ? requireExperiment(fresh.team, args.experiment_ref) : undefined;
                    if (p && before && p.revision !== before.revision)
                        throw new Error('experiment changed during inspection; reload before writing');
                    let changed = true;
                    if (args.action === 'plan') {
                        const result = planExperiment(fresh.team, { owner: fresh.owner, taskId: fresh.taskId, attemptId: fresh.attemptId, hypothesisId: args.hypothesis_id ?? '', alternatives: args.alternatives,
                            coverageKey: args.coverage_key ?? '', method: args.method ?? '', ifTrue: args.if_true ?? '', ifFalse: args.if_false ?? '', kind: args.kind, estimatedSeconds: args.estimated_seconds, budgetSeconds: args.budget_seconds, maxRuns: args.max_runs });
                        output = { ...experimentView(fresh.team, result.plan), duplicate: result.duplicate };
                        changed = !result.duplicate;
                    }
                    else if (args.action === 'report' && p) {
                        if (p.owner !== fresh.owner)
                            throw new Error('experiment owner mismatch');
                        const result = reportExperiment(fresh.team, p, { by: fresh.owner, expectedHypothesisRevision: args.expected_revision ?? -1, observation: args.observation ?? '', outcome: args.outcome, basis: args.basis, nextStep: args.next_step, validity: args.validity, files });
                        output = { ...experimentView(fresh.team, p), test_id: result.test.id, hypothesis_revision: result.hypothesis.revision, duplicate: result.duplicate };
                        changed = !result.duplicate;
                    }
                    else if (args.action === 'review') {
                        if (!fresh.captain)
                            throw new Error('only captain reviews hypothesis evidence');
                        const result = reviewHypothesis(fresh.team, args.hypothesis_id ?? '', { testIds: args.test_ids ?? [], verdict: args.verdict, reason: args.reason ?? '', expectedRevision: args.expected_revision ?? -1 });
                        for (const p of result.stopped)
                            for (const run of p.runs.filter(r => r.cycle === p.cycle))
                                reviewStops.push({ owner: p.owner, jobId: run.jobId });
                        output = { review: result.review, duplicate: result.duplicate, stopped_count: result.stopped.length, stopped_experiment_refs: result.stopped.slice(0, 20).map(p => experimentView(fresh.team, p).experiment_ref) };
                        changed = !result.duplicate;
                    }
                    else if (p && ['stop', 'release', 'reopen'].includes(args.action)) {
                        decideExperiment(fresh.team, p, { action: args.action, by: fresh.owner, captain: fresh.captain, reason: args.reason ?? '', expectedRevision: args.expected_revision ?? -1, bindTaskId: args.bind_task_id, bindAttemptId: args.bind_attempt_id, owner: args.owner });
                        output = experimentView(fresh.team, p);
                    }
                    else
                        throw new Error('invalid experiment action or missing experiment_ref');
                    return changed;
                } });
            if (cleanup && before || reviewStops.length) {
                const scope = runtimeScope(a.workspace, a.team), errors = [];
                const stops = cleanup && before ? before.runs.filter(r => r.cycle === before.cycle).map(r => ({ owner: before.owner, jobId: r.jobId })) : reviewStops;
                for (const run of stops) {
                    try {
                        await cancelRuntimeJob(scope, run.jobId, run.owner, true);
                    }
                    catch (error) {
                        errors.push(String(error));
                    }
                }
                return json({ result: output, cleanup_complete: !errors.length, errors });
            }
            return json({ ledger_ref: boardReference(a.team), result: output });
        },
    }));
    return hooks;
}

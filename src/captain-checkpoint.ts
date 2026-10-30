/** Compact, versioned handover. Runtime facts are separate from captain claims. */
import { createHash } from 'node:crypto'
import type { EvidenceFile } from './evidence-files.ts'
import { boardReference, evidenceSummary, findingReference } from './evidence-graph.ts'
import type { TeamState } from './types.ts'
import { researchSummary } from './research.ts'

export interface CaptainCheckpoint {
  revision: number
  boardRef: string
  stateRef: string
  capturedAt: number
  facts: ReturnType<typeof runtimeBrief>['facts']
  notes: { assessment: string; disputes: string[]; nextSteps: string[] }
  files: EvidenceFile[]
}

export function runtimeBrief(team: TeamState) {
  const openTasks = team.tasks.filter(task => ['pending', 'claimed', 'in_progress'].includes(task.status))
  const candidates = (team.flags ?? []).filter(flag => flag.status === 'candidate')
  const rechecks = (team.findings ?? []).filter(finding => finding.recheckRequired)
  const facts = {
    team_id: team.id, board_ref: boardReference(team), phase: team.halted ? 'halted' : team.phase ?? 'running', halted: team.halted === true,
    solved: team.challenge?.solved === true, round: team.round ?? 0,
    pending_candidate_count: candidates.length,
    pending_candidates: candidates.slice(0, 20).map(flag => ({ id: flag.id, challenge_id: flag.challengeId ?? null })),
    open_task_count: openTasks.length,
    open_tasks: openTasks.slice(0,40).map(task => ({ id: task.id, subject: task.subject.slice(0,160), status: task.status, assignee: task.assignee ?? null, attempt_id: task.attemptId ?? null, challenge_id: task.challengeId ?? null, resource_key: task.resourceKey ?? null })),
    // Count and hash all rows, including those omitted from the compact presentation.
    resources: team.tasks.filter(task => task.resourceKey && ['claimed','in_progress'].includes(task.status)).slice(0,40).map(task => ({task_id:task.id, resource_key:task.resourceKey, owner:task.assignee})),
    research: researchSummary(team),
    evidence: evidenceSummary(team), needs_recheck: rechecks.slice(0,20).map(finding => findingReference(team, finding)),
    max_parallel_lanes: team.challenge?.maxParallelLanes ?? null,
    truncated: openTasks.length > 40 || candidates.length > 20 || rechecks.length > 20 || team.tasks.filter(task=>task.resourceKey && ['claimed','in_progress'].includes(task.status)).length > 40,
  }
  const stateRef = createHash('sha256').update(JSON.stringify({
    facts, tasks: team.tasks, flags: team.flags ?? [], findings: team.findings ?? [], hypotheses: team.hypotheses ?? [], experiments: team.experiments ?? [], experiment_focus: team.experimentFocus ?? {},
    challenge: team.challenge ?? {}, members: team.members,
  })).digest('hex')
  return { state_ref: stateRef, facts }
}

function boundedText(value: string | undefined, name: string, max: number): string {
  if (!value?.trim() || value.length > max) throw new Error(`${name} must contain 1..${max} characters`)
  return value.trim()
}

function lines(values: readonly string[], name: string, required = false): string[] {
  if (values.length > 10 || (required && !values.length)) throw new Error(`${name} requires ${required ? '1' : '0'}..10 entries`)
  return values.map(value => boundedText(value,name,500))
}

export function saveCaptainCheckpoint(team: TeamState, input: {
  boardRef: string; stateRef: string; expectedRevision: number; assessment: string; disputes?: string[]; nextSteps: string[]; files: EvidenceFile[]
}) {
  if (input.boardRef !== boardReference(team)) throw new Error('stale ledger_ref for captain checkpoint')
  const notes = {assessment:boundedText(input.assessment,'assessment',2000),disputes:lines(input.disputes??[],'disputes'),nextSteps:lines(input.nextSteps,'next_steps',true)}
  const current = team.captainCheckpoints?.at(-1)
  const filesForComparison = (files: EvidenceFile[]) => files.map(({path,sha256,bytes})=>({path,sha256,bytes}))
  if (current?.stateRef === input.stateRef && JSON.stringify(current.notes) === JSON.stringify(notes) && JSON.stringify(filesForComparison(current.files)) === JSON.stringify(filesForComparison(input.files))) return {checkpoint:current,duplicate:true}
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== (current?.revision ?? 0)) throw new Error('stale expected_revision; load checkpoint before saving')
  const runtime = runtimeBrief(team)
  if (input.stateRef !== runtime.state_ref) throw new Error('runtime state changed; reload before saving a handover')
  const checkpoint: CaptainCheckpoint = {revision:(current?.revision??0)+1,boardRef:boardReference(team),stateRef:runtime.state_ref,capturedAt:Date.now(),facts:runtime.facts,notes,files:input.files}
  ;(team.captainCheckpoints??=[]).push(checkpoint)
  return {checkpoint,duplicate:false}
}

export function checkpointSummary(team: TeamState) {
  const checkpoint=team.captainCheckpoints?.at(-1)
  return checkpoint ? { revision:checkpoint.revision,captured_at:checkpoint.capturedAt,stale:checkpoint.stateRef!==runtimeBrief(team).state_ref,next_steps:checkpoint.notes.nextSteps } : null
}

/** Read-only planning signals; repeated ordinary reports do not count as experiments. */
export function planningSignals(team: TeamState) {
  const ids=[...new Set([...team.tasks.map(task=>task.challengeId??''),...(team.hypotheses??[]).map(item=>item.challengeId)])]
  return ids.slice(0,20).map(challengeId=>{
    const tasks=team.tasks.filter(task=>(task.challengeId??'')===challengeId)
    const tests=(team.hypotheses??[]).filter(item=>item.challengeId===challengeId).flatMap(item=>item.tests)
    return {challenge_id:challengeId||null,active_lanes:tasks.filter(task=>['claimed','in_progress'].includes(task.status)).length,
      queued_tasks:tasks.filter(task=>task.status==='pending').length,max_parallel_lanes:team.challenge?.maxParallelLanes??null,
      reported_experiments:tests.length,last_reported_experiment_at:tests.length?Math.max(...tests.map(test=>test.ts)):null,
      needs_recheck:(team.findings??[]).filter(item=>(item.challengeId??'')===challengeId && item.recheckRequired).length,
      next_counterchecks:tests.flatMap(test=>test.nextStep?[test.nextStep]:[]).slice(-3),
      guidance:'Resolve invalid assumptions and run a cheap falsifying check before adding another angle. Experiment reports are not independent proof; no automatic dispatch or model switch.'}
  })
}

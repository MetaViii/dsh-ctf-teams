import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,mkdir,rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { appendFinding,verifyFinding,formatFinding,updateChallenge } from '../lib/findings.js'
import { findingUsable,findingReference,evidenceSummary } from '../lib/evidence-graph.js'
import { runtimeBrief,saveCaptainCheckpoint,checkpointSummary,planningSignals } from '../lib/captain-checkpoint.js'
import { taskBlockReason } from '../lib/task-admission.js'
import { readTeam,writeTeam } from '../lib/state.js'

const team=()=>({id:'evidence',boardId:'generation-1',name:'evidence',captainSessionId:'captain',createdAt:1,members:[],tasks:[],taskSeq:0})
const claim=(state,content,parents=[],claimType='interpretation')=>appendFinding(state,{from:'worker',content,challengeId:'ch-a',claimType,dependsOn:parents.map(parent=>findingReference(state,parent))})
const review=(state,finding,result='confirmed',extra={})=>verifyFinding(state,findingReference(state,finding),{by:'captain',method:'independent reproduction',result,...extra})

test('refuted premises invalidate transitive conclusions without deleting observations or emitting duplicate beats',()=>{
  const state=team()
  const observation=claim(state,'request returned 500',[],'observation')
  review(state,observation)
  const explanation=claim(state,'input parser is broken',[observation]);review(state,explanation)
  const decision=claim(state,'skip login input tests',[explanation],'decision');review(state,decision)
  const raw=observation.content
  review(state,observation,'refuted',{method:'change one input at a time',note:'single-row input yields success'})
  assert.equal(findingUsable(explanation),false)
  assert.equal(findingUsable(decision),false)
  assert.equal(explanation.verifications.at(-1).result,'confirmed')
  assert.equal(observation.content,raw)
  assert.match(formatFinding(explanation),/needs_recheck/)
  assert.equal(evidenceSummary(state).needs_recheck,2)
  assert.match(taskBlockReason(state,{id:'t1',preflight:['offline_verified'],preflightFindingId:explanation.id}),/rechecked/)
  const before=JSON.stringify(state)
  review(state,observation,'refuted',{method:'change one input at a time',note:'single-row input yields success'})
  assert.equal(JSON.stringify(state),before)
  assert.throws(()=>review(state,decision),/confirm dependencies/)
  review(state,observation)
  assert.equal(findingUsable(explanation),false,'restoring a premise must not auto-confirm a dependent claim')
  assert.throws(()=>review(state,decision),/confirm dependencies/)
  review(state,explanation);review(state,decision)
  assert.equal(findingUsable(decision),true)
  review(state,observation,'inconclusive',{note:'the new environment has not been reproduced'})
  assert.equal(findingUsable(explanation),false)
})

test('generation fencing, cross-challenge edges, supersession independence and cycles fail atomically',()=>{
  const state=team(),first=claim(state,'first observation',[],'observation')
  review(state,first)
  const derived=claim(state,'derived',[first])
  for(const input of [{dependsOn:['evidence@generation-old/fd1']},{dependsOn:['fd1']},{dependsOn:Array(17).fill(findingReference(state,first))},{challengeId:'ch-b',dependsOn:[findingReference(state,first)]}]){
    const before=JSON.stringify(state)
    assert.throws(()=>appendFinding(state,{from:'worker',content:'bad edge',...input}))
    assert.equal(JSON.stringify(state),before)
  }
  assert.throws(()=>review(state,first,'refuted',{supersededBy:findingReference(state,derived)}),/independent/)
  const replacement=claim(state,'new independent observation',[],'observation')
  review(state,first,'refuted',{supersededBy:findingReference(state,replacement)})
  assert.equal(first.supersededBy,findingReference(state,replacement))
  assert.throws(()=>review(state,first),/historical/)
  assert.throws(()=>review(state,replacement,'refuted',{supersededBy:findingReference(state,first)}),/cycle/)
  const late=claim(state,'late inference from stale source',[first])
  assert.ok(late.recheckRequired)
})

test('handover captures runtime facts, preserves notes/history and rejects stale work or revisions',()=>{
  const state=team()
  state.halted=true
  state.tasks.push({id:'t1',subject:'Inspect input',status:'in_progress',assignee:'worker',dependencies:[],attemptId:'attempt-1',resourceKey:'target',createdAt:1,updatedAt:1})
  state.flags=[{id:'f1',flag:'flag{synthetic}',submittedBy:'worker',status:'candidate',ts:1}]
  const loaded=runtimeBrief(state)
  const input={boardRef:loaded.facts.board_ref,stateRef:loaded.state_ref,expectedRevision:0,assessment:'Need a low-cost counterexample',disputes:['500 does not prove broken parser'],nextSteps:['vary row count and capture output'],files:[]}
  const saved=saveCaptainCheckpoint(state,input)
  assert.equal(saved.checkpoint.facts.pending_candidate_count,1)
  assert.equal(saved.checkpoint.facts.resources[0].owner,'worker')
  assert.equal(saved.checkpoint.facts.halted,true)
  assert.equal(state.round,undefined)
  assert.equal(checkpointSummary(state).stale,false)
  const original=JSON.stringify(state)
  assert.equal(saveCaptainCheckpoint(state,input).duplicate,true)
  assert.equal(JSON.stringify(state),original)
  assert.throws(()=>saveCaptainCheckpoint(state,{...input,assessment:'changed without reload'}),/expected_revision/)
  state.tasks[0].attemptId='attempt-2'
  assert.equal(checkpointSummary(state).stale,true)
  assert.throws(()=>saveCaptainCheckpoint(state,{...input,assessment:'new plan',expectedRevision:1}),/state changed/)
  assert.equal(state.tasks[0].attemptId,'attempt-2')
  const current=runtimeBrief(state)
  saveCaptainCheckpoint(state,{...input,stateRef:current.state_ref,expectedRevision:1,assessment:'Observe the new execution generation'})
  assert.equal(state.captainCheckpoints.length,2)
  assert.equal(state.captainCheckpoints[0].facts.open_tasks[0].attempt_id,'attempt-1')
  assert.throws(()=>saveCaptainCheckpoint(state,{...input,boardRef:'other@generation',expectedRevision:2}),/ledger_ref/)
  assert.equal(state.halted,true)
})

test('brief output is bounded while the state digest covers omitted rows and ordinary reports are not experiments',()=>{
  const state=team()
  state.tasks=Array.from({length:45},(_,i)=>({id:'t'+i,subject:'work',status:'pending',dependencies:[],challengeId:'ch-a',createdAt:1,updatedAt:1}))
  const before=runtimeBrief(state)
  assert.equal(before.facts.open_tasks.length,40)
  assert.equal(before.facts.truncated,true)
  state.tasks[44].status='claimed'
  assert.notEqual(runtimeBrief(state).state_ref,before.state_ref)
  const signals=planningSignals(state)
  claim(state,'ordinary repeated report')
  assert.deepEqual(planningSignals(state),signals)
  assert.equal(signals[0].reported_experiments,0)
})

test('per-challenge active-lane admission is opt-in, independent of other targets and releases on terminal states',()=>{
  const state=team()
  state.tasks=[{id:'t1',status:'claimed',challengeId:'A'},{id:'t2',status:'in_progress',challengeId:'A'},{id:'t3',status:'claimed',challengeId:'B'}]
  const candidate={id:'t4',status:'pending',challengeId:'A'}
  assert.equal(taskBlockReason(state,candidate),undefined)
  updateChallenge(state,{maxParallelLanes:2})
  assert.match(taskBlockReason(state,candidate),/2\/2 active lanes/)
  assert.equal(taskBlockReason(state,{...candidate,challengeId:'B'}),undefined)
  state.tasks[0].status='failed'
  assert.equal(taskBlockReason(state,candidate),undefined)
  for(const maxParallelLanes of [-1,17,1.5])assert.throws(()=>updateChallenge(state,{maxParallelLanes}),/1\.\.16/)
  updateChallenge(state,{maxParallelLanes:0})
  assert.equal(state.challenge.maxParallelLanes,undefined)
})

test('legacy state and all dependency/handover metadata survive durable reload',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ctf-handover-'))
  try{
    const state=team();await mkdir(join(root,state.id))
    await writeTeam(root,state)
    assert.equal(checkpointSummary(await readTeam(root,state.id)),null)
    const observation=claim(state,'output',[],'observation');review(state,observation)
    const runtime=runtimeBrief(state)
    saveCaptainCheckpoint(state,{boardRef:runtime.facts.board_ref,stateRef:runtime.state_ref,expectedRevision:0,assessment:'Continue from output',nextSteps:['independently reproduce'],files:[]})
    await writeTeam(root,state)
    assert.deepEqual(await readTeam(root,state.id),state)
  }finally{await rm(root,{recursive:true,force:true})}
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {proposeHypothesis,recordHypothesisTest} from '../lib/hypotheses.js'
import {planExperiment,experimentRef,experimentFrontier,focusedExperiment,reserveExperimentRun,remainingMs,pauseExperiments,reportExperiment,reviewHypothesis,decideExperiment,hypothesisGate} from '../lib/research.js'
import {registerCTFTeamsTools} from '../lib/tools.js'
import {createTeamDir,writeTeam,readTeam} from '../lib/state.js'
const fresh=()=>({id:'research',name:'research',captainSessionId:'captain',boardId:'generation-a',createdAt:1,tasks:[],taskSeq:0,members:[]})
const hypothesis=(t,statement='All login errors mean the target is broken',challengeId='web-a')=>proposeHypothesis(t,{by:'captain',challengeId,statement,prediction:'A one-row control also fails'}).hypothesis
const plan=(t,h,patch={})=>planExperiment(t,{owner:'captain',hypothesisId:h.id,coverageKey:'login-one-row-v1',method:'Compare identical input with/without LIMIT 1 on a synthetic fixture',ifTrue:'single-row control fails',ifFalse:'single-row control succeeds',kind:'control',estimatedSeconds:1,budgetSeconds:10,maxRuns:1,...patch}).plan
const actor={owner:'captain'}
const decision=(p,action,patch={})=>({action,by:'captain',captain:true,reason:'Inspected the exact output; change input and retain the previous result',expectedRevision:p.revision,...patch})
test('cost-first frontier picks cheap discriminating controls and deduplicates cross-member coverage',()=>{
  const t=fresh(),h=hypothesis(t),alt=hypothesis(t,'Multiple rows trigger the exception')
  const expensive=plan(t,h,{coverageKey:'cracker',kind:'exploit',estimatedSeconds:200,budgetSeconds:300})
  const cheap=plan(t,h,{alternatives:[alt.id]})
  const before=JSON.stringify(t),frontier=experimentFrontier(t,'web-a')
  assert.equal(frontier.candidates[0].experiment_ref,experimentRef(t,cheap));assert.equal(frontier.candidates[1].id,expensive.id)
  assert.deepEqual(frontier.candidates[0].distinguishes,[h.id,alt.id]);assert.match(frontier.policy,/claims, not probabilities/)
  assert.equal(JSON.stringify(t),before)
  assert.equal(planExperiment(t,{...cheap,owner:'another',coverageKey:cheap.coverageKey,ifTrue:cheap.ifTrue,ifFalse:cheap.ifFalse}).duplicate,true)
  assert.equal(JSON.stringify(t),before)
})
test('invalid plans are atomic; generation, ownership, omitted references and run limits are fenced',()=>{
  const t=fresh(),h=hypothesis(t),other=hypothesis(t,'Other challenge','other')
  for(const patch of [{ifFalse:'single-row control fails'},{maxRuns:0},{budgetSeconds:0},{estimatedSeconds:11},{alternatives:[other.id]},{kind:'guess'}]){
    const before=JSON.stringify(t);assert.throws(()=>plan(t,h,patch));assert.equal(JSON.stringify(t),before)
  }
  const p=plan(t,h),ref=experimentRef(t,p),second=plan(t,h,{coverageKey:'changed-input'})
  assert.throws(()=>reserveExperimentRun(t,actor,ref.replace('generation-a','old'),'a',30000),/stale/)
  assert.throws(()=>reserveExperimentRun(t,{owner:'worker'},ref,'a',30000),/owner/)
  const r=reserveExperimentRun(t,actor,ref,'job-a',30000);assert.ok(r.timeoutMs<=10000)
  assert.throws(()=>focusedExperiment(t,actor),/stop-loss/)
  assert.throws(()=>focusedExperiment(t,actor,experimentRef(t,second)),/cannot bypass/)
  assert.equal(t.experiments[0].runs.length,1);assert.equal(t.tasks.length,0);assert.equal(t.flags,undefined)
})
test('active clock freezes across pause/reload and old task attempts require explicit captain rebinding',()=>{
  const t=fresh(),h=hypothesis(t)
  t.tasks=[{id:'t1',assignee:'worker',status:'in_progress',attemptId:'old'}]
  const p=plan(t,h,{owner:'worker',taskId:'t1',attemptId:'old',maxRuns:3})
  reserveExperimentRun(t,{owner:'worker',taskId:'t1',attemptId:'old'},experimentRef(t,p),'a',10000)
  const start=p.clockStarted;pauseExperiments(t,start+500)
  assert.equal(remainingMs(p,start+999999),9500)
  const restored=JSON.parse(JSON.stringify(t)),q=restored.experiments[0]
  assert.equal(remainingMs(q,Date.now()+999999),9500)
  restored.tasks[0].attemptId='new'
  assert.throws(()=>focusedExperiment(restored,{owner:'worker',taskId:'t1',attemptId:'new'}),/attempt/)
  assert.throws(()=>decideExperiment(restored,q,decision(q,'reopen')),/current task/)
  decideExperiment(restored,q,decision(q,'reopen',{bindTaskId:'t1',bindAttemptId:'new'}))
  assert.equal(q.cycle,2);assert.equal(q.runs.length,1);assert.match(q.decisions[0].reason,/new/)
  assert.doesNotThrow(()=>focusedExperiment(restored,{owner:'worker',taskId:'t1',attemptId:'new'}))
})
test('invalid/infrastructure results cannot refute, and low-yield scientific trials require fresh review',()=>{
  const t=fresh(),h=hypothesis(t)
  const record=(key,validity='valid',outcome='inconclusive')=>recordHypothesisTest(t,{by:'worker',hypothesisId:h.id,expectedRevision:h.revision,key,method:'synthetic control',observation:'no distinction',outcome,basis:'observation',files:[],validity})
  assert.throws(()=>record('bad','infrastructure','refutes'),/inconclusive/)
  record('infra1','infrastructure');record('infra2','invalid');assert.equal(hypothesisGate(t,h.id),undefined)
  record('low1');record('low2');assert.match(hypothesisGate(t,h.id),/two valid inconclusive/)
  assert.throws(()=>reviewHypothesis(t,h.id,{testIds:['e1'],expectedRevision:h.revision,verdict:'refuted',reason:'network timeout'}),/infrastructure/)
  reviewHypothesis(t,h.id,{testIds:['e3','e4'],expectedRevision:h.revision,verdict:'inconclusive',reason:'Change the control input before a bounded retry'})
  assert.equal(hypothesisGate(t,h.id),undefined)
  record('low3');assert.match(hypothesisGate(t,h.id),/review required/)
})
test('named counterevidence blocks further plans until captain reconsiders; reports remain unverified and idempotent',()=>{
  const t=fresh(),h=hypothesis(t),p=plan(t,h),ref=experimentRef(t,p)
  reserveExperimentRun(t,actor,ref,'a',1000)
  const data={by:'captain',expectedHypothesisRevision:h.revision,observation:'two rows fail, one row succeeds on the same backend',outcome:'refutes',basis:'construction',validity:'valid',files:[]}
  const report=reportExperiment(t,p,data),snapshot=JSON.stringify(t)
  assert.equal(reportExperiment(t,p,data).duplicate,true);assert.equal(JSON.stringify(t),snapshot)
  assert.throws(()=>reportExperiment(t,p,{...data,observation:'rewrite old evidence'}),/different content/)
  reviewHypothesis(t,h.id,{testIds:[report.test.id],expectedRevision:h.revision,verdict:'refuted',reason:'Cardinality changes the result, falsifying the universal claim'})
  decideExperiment(t,p,decision(p,'release'))
  const next=plan(t,h,{coverageKey:'more-bruteforce'})
  assert.throws(()=>focusedExperiment(t,actor,experimentRef(t,next)),/reviewed refutation/)
  assert.throws(()=>decideExperiment(t,p,decision(p,'reopen')),/review the hypothesis/)
  assert.equal(t.flags,undefined);assert.equal(t.challenge,undefined)
  assert.ok(t.findings.every(f=>!f.verifications))
})
test('captain counterevidence stops all running bound branches once and preserves tasks and judgment history',()=>{
  const t=fresh(),h=hypothesis(t)
  t.tasks=[{id:'t',assignee:'worker',attemptId:'a',status:'in_progress'}]
  const p=plan(t,h,{owner:'worker',taskId:'t',attemptId:'a',maxRuns:3})
  reserveExperimentRun(t,{owner:'worker',taskId:'t',attemptId:'a'},experimentRef(t,p),'job',30000)
  const e=recordHypothesisTest(t,{by:'captain',hypothesisId:h.id,expectedRevision:h.revision,key:'control',method:'actual control',observation:'counterexample',outcome:'refutes',basis:'construction',files:[]})
  const review={testIds:[e.test.id],expectedRevision:h.revision,verdict:'refuted',reason:'Constructive counterexample falsifies the shared premise'}
  const r=reviewHypothesis(t,h.id,review)
  assert.equal(r.stopped[0].id,p.id);assert.equal(p.state,'stopped');assert.equal(p.clockStarted,undefined)
  assert.equal(t.tasks[0].status,'in_progress');assert.match(p.decisions[0].reason,/counterevidence/)
  const before=JSON.stringify(t);assert.equal(reviewHypothesis(t,h.id,review).duplicate,true);assert.equal(JSON.stringify(t),before)
})
test('special owner names stay ordinary own properties and cannot inherit a focus',()=>{
  const t=fresh(),h=hypothesis(t);t.tasks=[{id:'t',status:'claimed',assignee:'__proto__',attemptId:'a'}]
  const p=plan(t,h,{owner:'__proto__',taskId:'t',attemptId:'a'}),a={owner:'__proto__',taskId:'t',attemptId:'a'}
  assert.equal(focusedExperiment(t,a),undefined)
  reserveExperimentRun(t,a,experimentRef(t,p),'job',1000)
  assert.ok(Object.hasOwn(t.experimentFocus,'__proto__'));assert.equal(Object.getPrototypeOf(t.experimentFocus),Object.prototype)
})
test('real tool transactions preserve read-only/paused state and reject stale members, ledger and route bypass before Docker',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'ctf-research-authority-')),root=join(workspace,'.ctf-teams'),definitions=new Map(),noop=()=>{}
  let mode='workspace-write'
  const agent={id:'captain',session:{header:{cwd:workspace}},ctx:{get:()=>({resolve:()=>({mode})})}}
  const ctx={on:()=>noop,effect:setup=>setup(),logger:{warn:noop,debug:noop},tools:{register:tool=>definitions.set(tool.name,tool)},agents:{get:()=>undefined},subagents:{followup:async()=>{},registerContinuableSetup:()=>noop}}
  registerCTFTeamsTools(ctx,{stateDir:'.ctf-teams',memberProvider:'spawn',maxMembers:8,profiles:{},execution:{backend:'docker'}})
  const call=(name,args)=>definitions.get(name).execute(args,{agent,signal:new AbortController().signal})
  try{
    const t=fresh(),h=hypothesis(t);await createTeamDir(root,t)
    const before=JSON.stringify(await readTeam(root,t.id)),read=await call('ctf_teams_experiment',{action:'next'})
    assert.equal(read.ledger_ref,'research@generation-a');assert.equal(JSON.stringify(await readTeam(root,t.id)),before)
    const args={action:'plan',ledger_ref:read.ledger_ref,hypothesis_id:h.id,coverage_key:'synthetic',method:'control',if_true:'fail',if_false:'pass',kind:'control',estimated_seconds:1,budget_seconds:5,max_runs:1}
    mode='read-only';await assert.rejects(call('ctf_teams_experiment',args),/read-only/);assert.equal(JSON.stringify(await readTeam(root,t.id)),before)
    mode='workspace-write';await assert.rejects(call('ctf_teams_experiment',{...args,ledger_ref:'old'}),/stale/)
    const created=await call('ctf_teams_experiment',args);assert.ok(created.result.experiment_ref)
    const saved=await readTeam(root,t.id);reserveExperimentRun(saved,actor,created.result.experiment_ref,'reserved',1000);await writeTeam(root,saved)
    await assert.rejects(call('ctf_teams_exec',{command:'touch cannot-run'}),/stop-loss/)
    saved.halted=true;await writeTeam(root,saved)
    await assert.rejects(call('ctf_teams_experiment',{...args,coverage_key:'other'}),/halted/)
    agent.id='retired-session';await assert.rejects(call('ctf_teams_experiment',{action:'next'}),/do not lead or belong/)
  }finally{await rm(workspace,{recursive:true,force:true})}
})

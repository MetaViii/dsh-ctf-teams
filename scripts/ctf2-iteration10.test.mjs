import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,mkdir,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { classifyFailure,recordMemberFault,memberAvailable,recoveryAdvice } from '../lib/availability.js'
import { pauseCaptainGoal } from '../lib/goal-pause.js'
import { resolveFailedTask } from '../lib/task-resolution.js'
import { flagReference,flagMatchesFormat,flagFormatLabel,updateChallenge } from '../lib/findings.js'
import { readTeam,writeTeam } from '../lib/state.js'
import { diagnosePlan } from '../lib/plan-diagnostics.js'

const team=()=>({id:'iteration10',boardId:'generation-1',name:'iteration10',captainSessionId:'captain',createdAt:1,members:[{id:'worker',name:'worker',joinedAt:1,status:'idle'}],tasks:[{id:'t1',subject:'solve',challengeId:'ch-a',assignee:'worker',status:'failed',dependencies:[],attempt:2,attemptId:'old-capability',output:'TRANSPORT: previous failure',checkpoint:'partial solver',remainingItems:['document output'],createdAt:1,updatedAt:2}],taskSeq:1,flags:[{id:'f1',challengeId:'ch-a',flag:'flag{synthetic}',submittedBy:'worker',status:'verified',ts:2}]})

test('transport and maintenance reports retain infrastructure policy; IP and plan failures require repair',()=>{
  for(const message of ['Connection error (TRANSPORT)','MAINTENANCE_MODE','HTTP 502 bad gateway','HTTP 503 Service Unavailable','HTTP 504'])assert.equal(classifyFailure({code:'TRANSPORT',message}),'transient')
  assert.equal(classifyFailure({code:'TRANSPORT',message:"provider's network firewall blocked requests from this IP"}),'configuration')
  assert.equal(classifyFailure({code:'TRANSPORT',message:'coding plan required'}),'configuration')
  const ambiguous=team().members[0];recordMemberFault(ambiguous,{code:'TRANSPORT',message:'Start Plan still turned this request away'});assert.notEqual(recoveryAdvice(ambiguous).reason,'plan_missing','a plan name alone is not evidence of missing entitlement')
  assert.equal(classifyFailure({code:'TASK_FAILED',message:'solver produced no result'}),'task')
})

test('unknown quota resets are not invented; concurrency and frequency have different actionable advice',()=>{
  for(const [message,reason] of [['同一密钥在途请求已达上限 4 (concurrency_limit_exceeded)','concurrency_limited'],['请求过于频繁 (60s 内超过 30 次) rate_limit_exceeded','frequency_limited']]){
    const member=team().members[0];recordMemberFault(member,{code:'RATE_LIMIT',message},1000)
    const advice=recoveryAdvice(member);assert.equal(advice.reason,reason);assert.equal(advice.retry_at,null);assert.equal(memberAvailable(member,9999999),false);assert.match(advice.next_action,/wake:false/)
  }
})

test('maintenance retries remain bounded instead of creating an unbounded retry loop',()=>{
  const member=team().members[0]
  recordMemberFault(member,{code:'TRANSPORT',message:'MAINTENANCE_MODE'},1000)
  assert.equal(member.fault.retryAt,31000)
  recordMemberFault(member,{code:'TRANSPORT',message:'MAINTENANCE_MODE'},32000)
  assert.equal(member.fault.retryAt,undefined);assert.equal(memberAvailable(member,9999999),false)
})

test('dispatch pause survives persistence and overrides even an expired fault cooldown',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ctf-hold-'))
  try{const value=team();value.members[0].dispatchPaused=true;value.members[0].fault={code:'RATE_LIMIT',message:'429',kind:'rate_limit',count:1,firstAt:1,lastAt:1,retryAt:2};await mkdir(join(dir,value.id));await writeTeam(dir,value);const restored=await readTeam(dir,value.id);assert.equal(memberAvailable(restored.members[0],99999),false);assert.equal(recoveryAdvice(restored.members[0]).reason,'dispatch_paused')}finally{await rm(dir,{recursive:true,force:true})}
})

test('human stop pauses only the exact live captain goal with its current revision',()=>{
  const captain={id:'captain'},calls=[]
  const goal={id:'g1',revision:7,phase:'active'}
  const ctx={get:name=>name==='goals'?{get:agent=>{assert.equal(agent,captain);return goal},pause:(agent,ref)=>{calls.push({agent,ref});goal.phase='paused';return goal}}:undefined,logger:{warn(){}}}
  assert.equal(pauseCaptainGoal(ctx,captain).status,'paused')
  assert.deepEqual(calls[0],{agent:captain,ref:{id:'g1',revision:7}})
  assert.equal(pauseCaptainGoal(ctx,captain).status,'already_inactive');assert.equal(calls.length,1)
})

test('missing or failing goal capability is explicit; no unrelated goal or session is created',()=>{
  assert.equal(pauseCaptainGoal({get:()=>undefined,logger:{warn(){}}},{id:'c'}).status,'unavailable')
  assert.equal(pauseCaptainGoal({get:()=>({get:()=>undefined,pause:()=>assert.fail('no goal to pause')}),logger:{warn(){}}},{id:'c'}).status,'none')
  assert.equal(pauseCaptainGoal({get:()=>({get:()=>{throw Error('inactive service')}}),logger:{warn(){}}},{id:'c'}).status,'unavailable')
})

test('serialized regex arrays normalize on update and legacy read without changing a candidate',()=>{
  const value=team(),format=JSON.stringify(['flag\\{[^}]+\\}','n1book\\{[^}]+\\}'])
  updateChallenge(value,{flagFormat:format});assert.ok(Array.isArray(value.challenge.flagFormat))
  assert.equal(flagMatchesFormat('n1book{ok}',value.challenge),true)
  assert.equal(flagMatchesFormat('n1book{ok}',{flagFormat:format}),true)
  assert.equal(flagFormatLabel({flagFormat:format}),'flag\\{[^}]+\\} | n1book\\{[^}]+\\}')
  assert.equal(value.flags[0].flag,'flag{synthetic}')
  assert.equal(flagMatchesFormat('x',{flagFormat:'[xyz]'}),true,'a literal regex character class must still work')
})

test('inline task diagnostics accept CTF context and retain strict array/boolean types',()=>{
  const plan={members:[],tasks:[{id:'a',subject:'solve',challenge_id:'a',resource_key:'slot',preflight:['access_ready'],preflight_finding_id:'fd1',allow_duplicate_challenge:true}]}
  assert.equal(diagnosePlan(plan),undefined)
  assert.match(diagnosePlan({...plan,tasks:[{...plan.tasks[0],preflight:'bad'}]}),/string array/)
  assert.match(diagnosePlan({...plan,tasks:[{...plan.tasks[0],allow_duplicate_challenge:'yes'}]}),/boolean/)
})

test('explicit verified-result reconciliation preserves original failure and is idempotent and generation-fenced',()=>{
  const value=team(),ref=flagReference(value,value.flags[0]),input={taskId:'t1',expectedAttempt:2,flagRef:ref,evidence:'platform receipt and solver output fulfill the task contract'}
  const before=JSON.stringify(value)
  for(const bad of [{...input,expectedAttempt:1},{...input,flagRef:'iteration10@old/f1'},{...input,evidence:''}]){assert.throws(()=>resolveFailedTask(value,bad));assert.equal(JSON.stringify(value),before)}
  assert.equal(resolveFailedTask(value,input).duplicate,false)
  assert.equal(value.tasks[0].status,'completed');assert.equal(value.tasks[0].resolution.failedOutput,'TRANSPORT: previous failure');assert.equal(value.tasks[0].checkpoint,'partial solver');assert.equal(value.tasks[0].attemptId,undefined)
  const after=JSON.stringify(value);assert.equal(resolveFailedTask(value,input).duplicate,true);assert.equal(JSON.stringify(value),after)
})

test('one accepted challenge flag never auto-resolves siblings or bypasses quality gates',()=>{
  for(const change of [value=>{value.tasks[0].kind='review'},value=>{value.flags[0].status='candidate'},value=>{value.flags[0].challengeId='other'},value=>{value.tasks[0].reassigning=true}]){
    const value=team();change(value);const before=JSON.stringify(value);assert.throws(()=>resolveFailedTask(value,{taskId:'t1',expectedAttempt:2,flagRef:flagReference(value,value.flags[0]),evidence:'a receipt'}));assert.equal(JSON.stringify(value),before)
  }
  const value=team();value.tasks.push({...value.tasks[0],id:'t2'});resolveFailedTask(value,{taskId:'t1',expectedAttempt:2,flagRef:flagReference(value,value.flags[0]),evidence:'t1 completed only'});assert.equal(value.tasks[1].status,'failed')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanUnsolved } from '../lib/ctf2-scan.js'
import { appendFlagCandidate, reviewFlagCandidate, deltaSince, advanceCursor, formatFlag, batchProgress } from '../lib/findings.js'
import { createTeamDir, readTeam, writeTeam, readMailbox } from '../lib/state.js'
import { failMemberOpenAttempt } from '../lib/members.js'
import { classifyFailure, memberAvailable } from '../lib/availability.js'
import { textCandidates } from '../lib/text-candidates.js'

const team = () => ({id:'batch',name:'batch',createdAt:1,captainSessionId:'cap',members:[],tasks:[],taskSeq:0,challenge:{multiChallenge:true}})

test('open-ended batch progress remains lossless JSON for the real Code Mode bridge',()=>{
  const progress=batchProgress(team())
  assert.equal(Object.hasOwn(progress,'expected'),false)
  assert.deepEqual(progress,JSON.parse(JSON.stringify(progress)))
  assert.equal(batchProgress({...team(),challenge:{multiChallenge:true,expectedChallenges:3}}).expected,3)
})

test('scan paginates the unfiltered set, deduplicates and preserves challenge objects', async () => {
  const calls = []
  const result = await scanUnsolved({practice_ground_id:'g',category:'MISC',limit:2,unsolved_only:true}, async args => {
    calls.push(args)
    return {items: args.page === 1 ? [{id:'a',is_solved:false,title:'A'},{id:'b',is_solved:true}] : [{id:'a',is_solved:false,title:'A'},{id:'c',is_solved:false}],total_page:2}
  })
  assert.equal(calls.length,2)
  assert.equal(calls.every(args => args.unsolved_only === false && args.category === 'MISC' && !('max_pages' in args)),true)
  assert.deepEqual(result.items.map(item => item.id),['a','c'])
  assert.equal(result.duplicates,1)
  assert.equal(result.complete,true)
  assert.equal(result.items[0].title,'A')
})

test('scan bounds repeated pages, inconsistent totals and unknown identities/statuses', async () => {
  const repeated = await scanUnsolved({practice_ground_id:'g',limit:1}, async () => ({items:[{id:'a',is_solved:false}],total_page:40}))
  assert.equal(repeated.pages_scanned,2); assert.equal(repeated.complete,false)
  const bounded = await scanUnsolved({practice_ground_id:'g',max_pages:2,limit:1},async args => ({items:[{id:String(args.page),is_solved:false}],total_page:10}))
  assert.equal(bounded.complete,false); assert.equal(bounded.pages_scanned,2)
  assert.match(bounded.warnings.join(),/max_pages/)
  const unknown = await scanUnsolved({practice_ground_id:'g'},async () => ({data:{items:[{id:'a'},{id:'b',is_solved:'false'},{title:'missing'}],total_page:1}}))
  assert.equal(unknown.complete,false); assert.equal(unknown.unknown_status,2); assert.deepEqual(unknown.items,[])
  const conflict = await scanUnsolved({practice_ground_id:'g'},async () => ({items:[{id:'a',is_solved:true},{id:'a',is_solved:false}],total_page:1}))
  assert.equal(conflict.conflicts,1); assert.equal(conflict.complete,false); assert.deepEqual(conflict.items,[])
  await assert.rejects(scanUnsolved({practice_ground_id:'g',max_pages:501},async () => null),/max_pages/)
  await assert.rejects(scanUnsolved({practice_ground_id:'g'},async () => ({error:'bad shape'})),/array/)
})

test('scan reports an early empty page or changing total as partial, normal empty ground is complete', async () => {
  const early = await scanUnsolved({practice_ground_id:'g'},async () => ({items:[],total_page:5}))
  assert.equal(early.complete,false)
  const empty = await scanUnsolved({practice_ground_id:'g'},async () => ({items:[],total_page:0}))
  assert.equal(empty.complete,true)
  const changed = await scanUnsolved({practice_ground_id:'g'},async args => ({items:[{id:String(args.page),is_solved:false}],total_page:args.page === 1 ? 2 : 3}))
  assert.equal(changed.complete,false); assert.equal(changed.pages_scanned,3)
})

test('flag provenance survives reload and duplicate evidence retains id and independent verdict history', async t => {
  const root = await mkdtemp(join(tmpdir(),'ctf-source-')); t.after(()=>rm(root,{recursive:true,force:true}))
  const state = team()
  const first = appendFlagCandidate(state,{flag:'flag{original0}',submittedBy:'one',challengeId:'ch1',sourceKind:'index',sourceUrl:'https://example.org/index/1',evidence:'event/year attachment match not confirmed'}).candidate
  advanceCursor(state,'captain')
  const retry = appendFlagCandidate(state,{flag:first.flag,submittedBy:'two',challengeId:'ch1',sourceKind:'local_output',evidence:'python solve.py'})
  assert.equal(retry.duplicate,true); assert.equal(retry.candidate.id,first.id); assert.equal(first.sources.length,2)
  assert.equal(deltaSince(state,'captain').flags.length,1)
  appendFlagCandidate(state,{flag:first.flag,submittedBy:'two',challengeId:'ch1',sourceKind:'local_output',evidence:'python solve.py'})
  assert.equal(first.sources.length,2,'identical retry does not add another provenance row')
  reviewFlagCandidate(state,first.id,'rejected',{by:'captain',note:'actual platform rejection'})
  const other = appendFlagCandidate(state,{flag:'flag{other}',submittedBy:'one',challengeId:'ch2',sourceKind:'writeup',sourceUrl:'https://example.org/writeup/2'}).candidate
  assert.equal(other.status,'candidate','one rejected answer does not blacklist the domain')
  await createTeamDir(root,state); const saved = await readTeam(root,state.id)
  assert.equal(saved.flags[0].sources[1].kind,'local_output'); assert.equal(saved.flags[0].reviews[0].verdict,'rejected')
  assert.match(formatFlag(saved.flags[0]),/challenge=ch1.*unverified sources/)
  assert.equal(appendFlagCandidate(state,{flag:'unknown source',submittedBy:'one',sourceUrl:'https://example.org/'}).candidate.sources[0].kind,'unknown')
  assert.throws(()=>appendFlagCandidate(state,{flag:'x',submittedBy:'one',sourceUrl:'https://user:secret@example.org/'}),/credentials/)
  await writeTeam(root,saved)
})

test('401 unknown-code errors pause and preserve the current attempt without duplicating notices', async t => {
  const root = await mkdtemp(join(tmpdir(),'ctf-auth-')); t.after(()=>rm(root,{recursive:true,force:true}))
  const state = team(); state.members=[{name:'worker',id:'worker',joinedAt:1,status:'working'}]
  state.tasks=[{id:'t1',subject:'batch',assignee:'worker',status:'in_progress',dependencies:[],createdAt:1,updatedAt:1,attempt:1,attemptId:'current',output:'script and progress',remainingItems:['ch-next']}]
  await createTeamDir(root,state)
  const ctx={agents:{get(){}},logger:{debug(){},warn(){}}}
  const observed={captainSessionId:'cap',memberId:'worker',task:{id:'t1',attempt:1,attemptId:'current'}}
  for(let n=0;n<20;n++) await failMemberOpenAttempt(ctx,root,state.id,'worker',{code:'UNKNOWN',message:'401: {"code":"invalid_api_key"}'},{append(){}},observed)
  const saved=await readTeam(root,state.id)
  assert.equal(saved.members[0].fault.kind,'configuration'); assert.equal(memberAvailable(saved.members[0]),false)
  assert.equal(saved.tasks[0].status,'in_progress'); assert.equal(saved.tasks[0].checkpoint,'script and progress')
  assert.equal(saved.tasks[0].attemptId,'current'); assert.deepEqual(saved.tasks[0].remainingItems,['ch-next'])
  assert.equal((await readMailbox(root,state.id,'captain')).length,1)
  assert.equal(classifyFailure({code:'OTHER',status:401,message:'invalid'}),'configuration')
  assert.equal(classifyFailure({code:'QUOTA',status:403,message:'weekly limit'}),'rate_limit')
})

test('2/Z variants stay opt-in, bounded and keep the original first',()=>{
  const variants=textCandidates({text:'2Z',max_candidates:3})
  assert.equal(variants.candidates[0].text,'2Z'); assert.equal(variants.total_variants,'4'); assert.equal(variants.truncated,true)
})

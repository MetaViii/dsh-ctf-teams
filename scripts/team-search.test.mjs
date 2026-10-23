import test from 'node:test'
import assert from 'node:assert/strict'
import { searchTeamRecords } from '../lib/team-search.js'
const fixture=()=>({id:'search',boardId:'gen-1',name:'search',captainSessionId:'captain',createdAt:1,members:[],taskSeq:1,
  tasks:[{id:'t1',subject:'接手检查',status:'failed',dependencies:[],createdAt:1,updatedAt:4,checkpoint:'保留 SSH 隧道，下一步检查权限',attemptId:'PRIVATE_EXECUTION_CAPABILITY'}],
  findings:[{id:'fd1',content:'SSH 返回 500；这只是观察',from:'worker',round:1,ts:3,verifications:[{method:'old check',result:'confirmed'}],recheckRequired:{causes:['search@gen-1/fd0'],since:3}}],
  hypotheses:[{id:'h1',challengeId:'a',statement:'SSH 服务可达',prediction:'握手成功',by:'worker',ts:1,revision:2,tests:[{id:'e1',by:'worker',method:'SSH handshake',observation:'timeout',outcome:'inconclusive',basis:'measurement',nextStep:'检查跳板',files:[],ts:2}]}]})

test('literal report search spans checkpoints, findings, hypotheses and experiments without state mutation',()=>{
  const team=fixture(),before=JSON.stringify(team)
  const found=searchTeamRecords(team,{action:'search',query:'sSh',limit:2})
  assert.equal(found.total,4);assert.equal(found.next_offset,2)
  const rest=searchTeamRecords(team,{action:'search',query:'SSH',offset:2,limit:2})
  assert.equal(rest.next_offset,null)
  assert.equal(new Set([...found.results,...rest.results].map(row=>row.record_ref)).size,4)
  assert.equal(found.results.find(row=>row.source==='finding').status,'needs_recheck')
  const task=searchTeamRecords(team,{action:'get',record_ref:found.results.find(row=>row.source==='task').record_ref})
  assert.match(task.content,/保留 SSH 隧道/)
  assert.ok(!task.content.includes('PRIVATE_EXECUTION_CAPABILITY'))
  assert.equal(JSON.stringify(team),before)
})

test('detail pagination preserves all Unicode characters and exposes changes between pages',()=>{
  const team=fixture();team.tasks[0].checkpoint='🧩中文🔒'.repeat(80)
  const hit=searchTeamRecords(team,{action:'search',query:'🧩中文',source:'task'}).results[0]
  let offset=0,content='',hash
  do { const page=searchTeamRecords(team,{action:'get',record_ref:hit.record_ref,content_offset:offset,content_limit:7});content+=page.content;hash??=page.content_sha256;assert.equal(page.content_sha256,hash);offset=page.next_content_offset } while(offset!==null)
  assert.equal(JSON.parse(content).checkpoint,team.tasks[0].checkpoint)
  assert.equal(content.includes('\ufffd'),false)
  assert.ok(Array.from(hit.snippet).length<=240)
  team.tasks[0].checkpoint+='changed'
  assert.notEqual(searchTeamRecords(team,{action:'get',record_ref:hit.record_ref}).content_sha256,hash)
})

test('source and challenge filters preserve typed experiment process, not just final outcomes',()=>{
  const team=fixture()
  const found=searchTeamRecords(team,{action:'search',query:'检查跳板',source:'experiment',challenge_id:'a'})
  assert.equal(found.total,1);assert.equal(found.results[0].status,'reported_inconclusive')
  const detail=searchTeamRecords(team,{action:'get',record_ref:found.results[0].record_ref})
  assert.match(detail.content,/SSH handshake/);assert.match(detail.content,/timeout/)
  assert.equal(searchTeamRecords(team,{action:'search',query:'SSH',challenge_id:'other'}).total,0)
})

test('generation references and strict bounds reject stale, private or malformed requests',()=>{
  const team=fixture()
  for(const args of [{action:'get',record_ref:'search@old/task/t1'},{action:'get',record_ref:'other@gen-1/task/t1'},{action:'get',record_ref:'search@gen-1/inbox/x'},{action:'search',query:''},{action:'search',query:'x'.repeat(201)},{action:'search',query:'SSH',limit:21},{action:'search',query:'SSH',offset:-1},{action:'search',query:'SSH',source:'transcript'},{action:'get',record_ref:'search@gen-1/task/t1',content_limit:8001}]) assert.throws(()=>searchTeamRecords(team,args))
  assert.equal(searchTeamRecords(team,{action:'search',query:'.*'}).total,0,'query must not become a regex')
  assert.equal(searchTeamRecords({...team,findings:undefined,hypotheses:undefined},{action:'search',query:'SSH'}).total,1,'legacy team records remain readable')
})

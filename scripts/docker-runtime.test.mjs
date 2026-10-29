import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runtimeScope, stageRuntimeInput } from '../lib/docker-runtime.js'
import { requireExecutionPolicy, bashQuote } from '../lib/execution-tools.js'
import { registerCTFTeamsTools } from '../lib/tools.js'
import { createTeamDir, writeTeam, readTeam } from '../lib/state.js'
import { createServer } from 'node:http'
import { callPlatformBridge, registerCtf2Bridge } from '../lib/ctf2-tools.js'

test('runtime identity fences workspace, captain and board generation', () => {
  const team={id:'same',captainSessionId:'captain-a',boardId:'generation-a',createdAt:1}
  const a=runtimeScope('a',team)
  for(const other of [runtimeScope('b',team),runtimeScope('a',{...team,captainSessionId:'b'}),runtimeScope('a',{...team,boardId:'b'})])assert.notEqual(other.key,a.key)
  assert.match(a.container,/^ctft-[0-9a-f]{32}$/)
  assert.equal(runtimeScope('a',team).key,a.key)
})
test('attachment staging preserves originals, rejects overwrite, traversal, private dirs and junctions',async()=>{
  const root=await mkdtemp(join(tmpdir(),'ctf-input-')),scope=runtimeScope(root,{id:'t',captainSessionId:'c',createdAt:1})
  try{
    await writeFile(join(root,'附件.bin'),Buffer.from([0,255,128,10]))
    const staged=await stageRuntimeInput(scope,'附件.bin')
    assert.deepEqual(await readFile(staged.host_path),await readFile(join(root,'附件.bin')))
    assert.match(staged.container_path,/^\/work\/input\//)
    await assert.rejects(stageRuntimeInput(scope,'附件.bin'),/already exists/)
    await assert.rejects(stageRuntimeInput(scope,'../outside'),/explicit/)
    await assert.rejects(stageRuntimeInput(scope,'附件.bin','../../escape'),/Invalid/)
    await mkdir(join(root,'.ctf2-agent'));await writeFile(join(root,'.ctf2-agent','oauth-token.json'),'private')
    await assert.rejects(stageRuntimeInput(scope,'.ctf2-agent'),/private/)
    await symlink(join(root,'.ctf2-agent'),join(root,'alias'),process.platform==='win32'?'junction':'dir')
    await assert.rejects(stageRuntimeInput(scope,'alias/oauth-token.json'),/private|symlink|junction/)
    await mkdir(join(root,'source'));await symlink(join(root,'.ctf2-agent'),join(root,'source','shortcut'),process.platform==='win32'?'junction':'dir')
    await assert.rejects(stageRuntimeInput(scope,'source'),/symlink|junction/)
  }finally{await rm(root,{recursive:true,force:true})}
})
test('runtime uses effective host policy and never interprets absent/broken services as full access',()=>{
  const agent=mode=>({session:{},ctx:{get:()=>mode===undefined?undefined:{resolve:()=>({mode})}}})
  for(const mode of ['workspace-write','danger-full-access'])assert.doesNotThrow(()=>requireExecutionPolicy(agent(mode)))
  for(const mode of ['read-only','unknown',undefined])assert.throws(()=>requireExecutionPolicy(agent(mode)))
  assert.throws(()=>requireExecutionPolicy({session:{},ctx:{get(){throw Error('inactive context')}}}),/inactive context/)
})
test('Bash quoting preserves literal dollar signs, newlines, quotes and substitutions',()=>{
  assert.equal(bashQuote("a'b$()`\n"),"'a'\\''b$()`\n'")
})

test('member command execution rejects stale capabilities, paused teams and held members before Docker admission',async()=>{
  const workspace=await mkdtemp(join(tmpdir(),'ctf-command-authority-')),stateRoot=join(workspace,'.ctf-teams')
  const definitions=new Map(),noop=()=>{},agent={id:'member-session',session:{header:{cwd:workspace}},ctx:{get:()=>{throw Error('Docker policy must not be reached')}}}
  const ctx={on:()=>noop,effect:setup=>setup(),logger:{warn:noop,debug:noop},tools:{register:tool=>definitions.set(tool.name,tool)},agents:{get:()=>undefined},subagents:{followup:async()=>{},registerContinuableSetup:()=>noop}}
  registerCTFTeamsTools(ctx,{stateDir:'.ctf-teams',memberProvider:'spawn',maxMembers:8,profiles:{},execution:{backend:'docker'}})
  const team={id:'authority',name:'authority',captainSessionId:'captain',createdAt:1,taskSeq:1,members:[{id:agent.id,name:'worker',joinedAt:1,status:'working'}],tasks:[{id:'t1',subject:'test',status:'claimed',assignee:'worker',dependencies:[],createdAt:1,updatedAt:1,attempt:1,attemptId:'current-attempt'}]}
  try{
    await createTeamDir(stateRoot,team);assert.ok(await readTeam(stateRoot,team.id))
    const exec=definitions.get('ctf_teams_exec')
    const call=args=>exec.execute({command:'touch cannot-run',...args},{agent,signal:new AbortController().signal})
    await assert.rejects(call({task_id:'t1'}),/current attempt_id/)
    await assert.rejects(call({task_id:'t1',attempt_id:'old-attempt'}),/old attempts/)
    team.halted=true;await writeTeam(stateRoot,team)
    await assert.rejects(call({task_id:'t1',attempt_id:'current-attempt'}),/halted/)
    team.halted=false;team.members[0].dispatchPaused=true;await writeTeam(stateRoot,team)
    await assert.rejects(call({task_id:'t1',attempt_id:'current-attempt'}),/suspended/)
    team.members[0].dispatchPaused=false;team.tasks[0].status='completed';await writeTeam(stateRoot,team)
    await assert.rejects(call({task_id:'t1',attempt_id:'current-attempt'}),/No current owned task/)
    team.members[0].id='replacement-session';await writeTeam(stateRoot,team)
    await assert.rejects(call({task_id:'t1',attempt_id:'current-attempt'}),/do not lead or belong/)
  }finally{await rm(workspace,{recursive:true,force:true})}
})

test('typed CTF2 bridge preserves verdicts and exact candidates without shells, retries or local verdict writes',async()=>{
  const requests=[];let businessError=false
  const server=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk
    const rpc=JSON.parse(body);requests.push(rpc)
    res.setHeader('content-type','application/json')
    const payload=businessError?{code:'RATE_LIMITED',message:'synthetic rate limit',retry_after_ms:1000}:rpc.params.name==='ctf2_submit_flag'?{accepted:false}:{agent:{solved_count:7}}
    res.end(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result:{content:[{type:'text',text:JSON.stringify(payload)}]}}))
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  const config={proxyUrl:`http://127.0.0.1:${server.address().port}/mcp`},signal=new AbortController().signal
  const definitions=new Map();let captain=true,halted=false,mode='workspace-write';const operations=[]
  const ctx={effect:setup=>setup(),tools:{register:tool=>definitions.set(tool.name,tool)}}
  const authorize=async(_exec,options)=>{operations.push(options);if(options?.mutate&&halted)throw Error('halted');return{captain,workspace:process.cwd(),agent:{ctx:{get:()=>({resolve:()=>({mode})})},session:{}}}}
  registerCtf2Bridge(ctx,config,authorize)
  const tool=definitions.get('ctf_teams_ctf2'),exec={signal}
  try{
    assert.deepEqual(await callPlatformBridge(config,'whoami',{},signal),{agent:{solved_count:7}})
    const flag="flag{A$'`\\n中}";const outcome=await tool.execute({action:'submit',challenge_id:'challenge-a',practice_ground_id:'ground-a',flag},exec)
    assert.equal(outcome.result.accepted,false);assert.equal(outcome.local_verdict_recorded,false)
    assert.equal(requests.at(-1).params.arguments.flag,flag);assert.equal(requests.at(-1).params.arguments.confirmation,true)
    assert.equal(operations.at(-1).mutate,true)
    const count=requests.length;captain=false
    await assert.rejects(tool.execute({action:'whoami'},exec),/captain/)
    captain=true;halted=true
    await assert.rejects(tool.execute({action:'submit',challenge_id:'a',practice_ground_id:'g',flag:'f'},exec),/halted/)
    halted=false;mode='read-only'
    await assert.rejects(tool.execute({action:'submit',challenge_id:'a',practice_ground_id:'g',flag:'f'},exec),/read-only/)
    assert.equal(requests.length,count)
    businessError=true
    await assert.rejects(callPlatformBridge(config,'submit',{flag:'f'},signal),/RATE_LIMITED/)
    assert.equal(requests.length,count+1,'a write error is never retried')
    await assert.rejects(callPlatformBridge({proxyUrl:'https://example.com/mcp'},'whoami',{},signal),/loopback/)
  }finally{await new Promise(r=>server.close(r))}
})

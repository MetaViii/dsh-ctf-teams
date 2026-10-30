/** Actual Loader -> model -> Code Mode -> packaged tools -> real Docker. */
import assert from 'node:assert/strict'
import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
const require=createRequire(import.meta.url)
const plugin=dirname(require.resolve('@nanmicoder/dsh-ctf-teams'))
const {runtimeScope,dockerCommand}=await import(pathToFileURL(join(plugin,'docker-runtime.js')))
const {haltTeamWork}=await import(pathToFileURL(join(plugin,'tools.js')))
const {bashQuote}=await import(pathToFileURL(join(plugin,'execution-tools.js')))
const writeBinary='python3 -c '+bashQuote("from pathlib import Path; Path('proof.bin').write_bytes(bytes([0,255,128])); print('ACTUAL_CONTAINER_BYTES')")
const readBinary='python3 -c '+bashQuote("from pathlib import Path; assert Path('proof.bin').read_bytes()==bytes([0,255,128]); print('PRESERVED')")
const model={provider:'runtime-lab',id:'fixture-model',name:'Docker proof',context:{contextWindow:262144},defaultMaxTokens:8192}
const cold=process.env.LAB_DOCKER_COLD==='1'
const native=process.env.LAB_SCENARIO==='native-execution'
let code='',expected='',called=false,lastToolResult
class Adapter extends LlmAdapter{
  async listModels(){return[model]}
  async resolveModel(provider,id){return{...model,provider,id}}
  async *stream(options){
    if(options.purpose||called){
      if(!options.purpose){
        const last=options.messages.at(-1)
        lastToolResult=last
        appendFileSync(process.env.LAB_TRACE,JSON.stringify({event:'docker-tool-result',last})+'\n')
        assert.ok(JSON.stringify(last).includes(expected),'The real tool bridge did not return the expected outcome: '+JSON.stringify(last).slice(-5000))
      }
      yield{type:'block-start',index:0,blockType:'text'};yield{type:'text-delta',index:0,text:expected};yield{type:'block-end',index:0,block:{type:'text',text:expected}};yield{type:'finish',reason:{kind:'stop'}};return
    }
    called=true
    appendFileSync(process.env.LAB_TRACE,JSON.stringify({event:'docker-model-call',codeMode:true})+'\n')
    const id=ToolCallId('docker-'+randomUUID()),args=JSON.stringify({code,description:'Run the authorized isolated Docker acceptance probe'})
    yield{type:'block-start',index:0,blockType:'tool-call'};yield{type:'tool-call-delta',index:0,id,name:'run_code',argumentsDelta:args};yield{type:'block-end',index:0,block:{type:'tool-call',id,name:'run_code',arguments:args}};yield{type:'finish',reason:{kind:'tool-calls'}}
  }
}
export const name='runtime-lab-docker'
export const inject=['llm','agents','sessions','tools','permissionPresets']
export function apply(ctx){
  ctx.llm.registerAdapter(['runtime-lab'],new Adapter())
  void(async()=>{
    await ctx.get('loader').await()
    const cwd=process.cwd(),teamFile=join(cwd,'.ctf-teams/docker-proof/team.json')
    const saved=cold?JSON.parse(readFileSync(teamFile,'utf8')):undefined
    const handle=cold?await ctx.agents.resume({resumeSessionId:saved.captainSessionId,agentOptions:{provider:'runtime-lab',model:'fixture-model'}}):await ctx.agents.create({sessionId:'docker-'+randomUUID(),meta:{cwd,agentPreset:'ctf-teams'},agentOptions:{provider:'runtime-lab',model:'fixture-model'}})
    ctx.effect(()=>()=>handle.dispose())
    const agent=handle.agent;await agent.whenIdle();agent.ctx.tools.presentAs('ptc')
    async function turn(program,marker){
      code=program;expected=marker;called=false;lastToolResult=undefined
      agent.followup(createUserMessage({content:[{type:'text',text:cold?'Explicitly resume this isolated test team and verify its preserved files.':'Run the authorized Docker runtime test: '+marker}],source:{kind:'user'}}))
      await new Promise(r=>setImmediate(r));await agent.whenIdle()
      assert.equal(called,true)
      assert.equal(lastToolResult?.role,'tool','missing actual tool result')
      assert.equal(lastToolResult.isError,false,JSON.stringify(lastToolResult))
      assert.ok(JSON.stringify(lastToolResult.content).includes(marker),'actual tool result marker missing')
    }
    if(native){
      const shell=process.platform==='win32'?'pwsh':'bash'
      const cmd=process.platform==='win32'?"Write-Output 'NATIVE_RUNTIME_OK'; [System.IO.File]::WriteAllBytes('native-proof.bin', [byte[]](0,255,128))":"printf NATIVE_RUNTIME_OK; printf '\\000\\377\\200' > native-proof.bin"
      await turn(`await tools.ctf_teams_create({name:'native-proof',mode:'solo',approval:'automatic'});let rejected=false;try{await tools.ctf_teams_exec({command:'echo no'});}catch(e){rejected=e.message.includes('native');}if(!rejected)throw Error('native backend did not identify itself');const r=await tools.${shell}({command:${JSON.stringify(cmd)},description:'Verify explicit advanced native execution in the isolated workspace',workdir:${JSON.stringify(cwd)}});if(!JSON.stringify(r).includes('NATIVE_RUNTIME_OK'))throw Error(JSON.stringify(r));return 'NATIVE_RUNTIME_PASSED';`,'NATIVE_RUNTIME_PASSED')
      assert.deepEqual(readFileSync(join(cwd,'native-proof.bin')),Buffer.from([0,255,128]))
      await ctx.sessions.flush(agent.session);await handle.dispose()
      appendFileSync(process.env.LAB_TRACE,JSON.stringify({event:'native-product-passed',actualFile:true})+'\n')
      console.log('NATIVE_PRODUCT_PASSED');process.exit(0)
    }
    if(!cold){
      await turn(`
await tools.ctf_teams_create({name:'docker-proof',mode:'solo',approval:'automatic'});
const prepared=await tools.ctf_teams_runtime({action:'prepare'});
if(!prepared.running)throw Error('container not started');
const result=await tools.ctf_teams_exec({command:${JSON.stringify(writeBinary)},wait_ms:10000});
if(result.exit_code!==0||!result.stdout.includes('ACTUAL_CONTAINER_BYTES'))throw Error(JSON.stringify(result));
const bg=await tools.ctf_teams_exec({command:'while true; do printf x >> ticks; sleep .1; done',wait_ms:0});
if(!bg.job_id)throw Error('no durable background job');
return 'DOCKER_REAL_EXEC_PASSED';`,'DOCKER_REAL_EXEC_PASSED')
      const team=JSON.parse(readFileSync(teamFile,'utf8')),scope=runtimeScope(cwd,team)
      assert.deepEqual(readFileSync(join(scope.host_workdir,'proof.bin')),Buffer.from([0,255,128]))
      ctx.permissionPresets.set(agent.session,'workspace-write')
      await turn(`const r=await tools.ctf_teams_exec({command:'printf workspace-mode',wait_ms:10000});if(r.exit_code!==0)throw Error('workspace execution failed');return 'DOCKER_WORKSPACE_PASSED';`,'DOCKER_WORKSPACE_PASSED')
      const control='python3 -c '+bashQuote("import sqlite3; from pathlib import Path; c=sqlite3.connect(':memory:'); c.execute('create table users(id int)'); c.executemany('insert into users values(?)',[(1,),(2,)]); assert len(c.execute('select * from users where 1=1').fetchall())==2; assert len(c.execute('select * from users where 1=1 LIMIT 1').fetchall())==1; Path('research-count.txt').open('a').write('1'); print('ONE_ROW_CONTROL_OK')")
      await turn(`
const h=await tools.ctf_teams_hypothesis({action:'propose',challenge_id:'synthetic-login',statement:'A login 500 always means this backend is unusable',prediction:'Changing only row cardinality cannot make a query return one row'});
const ledger=h.ledger_ref;
const expensive=await tools.ctf_teams_experiment({action:'plan',ledger_ref:ledger,hypothesis_id:h.hypothesis_id,coverage_key:'synthetic-cracker-v1',method:'Try a large secret key space',if_true:'no valid key',if_false:'a valid key',kind:'exploit',estimated_seconds:200,budget_seconds:300,max_runs:1});
const cheap=await tools.ctf_teams_experiment({action:'plan',ledger_ref:ledger,hypothesis_id:h.hypothesis_id,coverage_key:'synthetic-row-cardinality-v1',method:'Compare SQL row counts with identical conditions and LIMIT 1 on a two-row SQLite fixture',if_true:'single-row control cannot succeed',if_false:'single-row control succeeds',kind:'control',estimated_seconds:1,budget_seconds:10,max_runs:1});
const frontier=await tools.ctf_teams_experiment({action:'next'});
if(frontier.candidates[0].experiment_ref!==cheap.result.experiment_ref)throw Error('cheap control was not prioritized');
const runs=await Promise.allSettled([tools.ctf_teams_exec({command:${JSON.stringify(control)},experiment_ref:cheap.result.experiment_ref,wait_ms:10000}),tools.ctf_teams_exec({command:${JSON.stringify(control)},experiment_ref:cheap.result.experiment_ref,wait_ms:10000})]);
if(runs.filter(x=>x.status==='fulfilled').length!==1||!runs.find(x=>x.status==='fulfilled').value.stdout.includes('ONE_ROW_CONTROL_OK'))throw Error('run budget race: '+JSON.stringify(runs));
let denied=false;try{await tools.ctf_teams_exec({command:'touch research-bypass'});}catch(e){denied=e.message.includes('stop-loss');}if(!denied)throw Error('omitting experiment_ref bypassed the budget');
const report=await tools.ctf_teams_experiment({action:'report',ledger_ref:ledger,experiment_ref:cheap.result.experiment_ref,expected_revision:h.revision,observation:'Same table/condition: unrestricted returns two rows; LIMIT 1 returns one row. Synthetic control succeeded.',outcome:'refutes',basis:'construction',validity:'valid'});
await tools.ctf_teams_experiment({action:'review',ledger_ref:ledger,hypothesis_id:h.hypothesis_id,test_ids:[report.result.test_id],expected_revision:report.result.hypothesis_revision,verdict:'refuted',reason:'The cardinality control falsifies the universal broken-backend premise; this does not prove a live login exploit.'});
await tools.ctf_teams_experiment({action:'release',ledger_ref:ledger,experiment_ref:cheap.result.experiment_ref,expected_revision:report.result.revision,reason:'Preserve counterevidence and change the working premise'});
denied=false;try{await tools.ctf_teams_exec({command:'touch research-repeat',experiment_ref:expensive.result.experiment_ref});}catch(e){denied=e.message.includes('reviewed refutation');}if(!denied)throw Error('reviewed counterevidence did not gate the expensive route');
const timed=await tools.ctf_teams_hypothesis({action:'propose',challenge_id:'synthetic-timing',statement:'A bounded wait produces a distinguishing output',prediction:'Observe output before the deadline'});
const bounded=await tools.ctf_teams_experiment({action:'plan',ledger_ref:ledger,hypothesis_id:timed.hypothesis_id,coverage_key:'synthetic-sleep-v1',method:'sleep 10 with a one-second route budget',if_true:'output before deadline',if_false:'valid control distinguishes no output',kind:'control',estimated_seconds:1,budget_seconds:1,max_runs:3});
const deadline=Date.now();const output=await tools.ctf_teams_exec({command:'sleep 10',experiment_ref:bounded.result.experiment_ref,timeout_ms:20000,wait_ms:10000});
if(output.status!=='timed_out'||Date.now()-deadline>6000)throw Error('experiment deadline did not cap the real process: '+JSON.stringify(output));
const timeoutReport=await tools.ctf_teams_experiment({action:'report',ledger_ref:ledger,experiment_ref:bounded.result.experiment_ref,expected_revision:timed.revision,observation:'Deadline stopped the command; no scientific distinction was observed',outcome:'inconclusive',basis:'observation',validity:'infrastructure',next_step:'Repair or redesign the control instead of claiming refutation'});
await tools.ctf_teams_experiment({action:'release',ledger_ref:ledger,experiment_ref:bounded.result.experiment_ref,expected_revision:timeoutReport.result.revision,reason:'Preserve inconclusive infrastructure outcome; return to ordinary workspace probes'});
const premise=await tools.ctf_teams_hypothesis({action:'propose',challenge_id:'synthetic-running',statement:'The earlier synthetic cardinality control returned no rows',prediction:'No successful one-row result exists'});
const active=await tools.ctf_teams_experiment({action:'plan',ledger_ref:ledger,hypothesis_id:premise.hypothesis_id,coverage_key:'running-branch-v1',method:'A long-running branch based on a false shared premise',if_true:'branch yields a result',if_false:'existing control is a counterexample',kind:'exploit',estimated_seconds:10,budget_seconds:30,max_runs:2});
const background=await tools.ctf_teams_exec({command:'sleep 20; touch research-should-stop',experiment_ref:active.result.experiment_ref,wait_ms:0});
const counter=await tools.ctf_teams_hypothesis({action:'record_test',ledger_ref:ledger,hypothesis_id:premise.hypothesis_id,expected_revision:premise.revision,test_key:'existing-one-row-control',method:'Inspect the earlier actual SQLite control output',observation:'ONE_ROW_CONTROL_OK established one returned row',outcome:'refutes',basis:'construction'});
const stopped=await tools.ctf_teams_experiment({action:'review',ledger_ref:ledger,hypothesis_id:premise.hypothesis_id,test_ids:[counter.test_id],expected_revision:counter.revision,verdict:'refuted',reason:'The actual earlier control disproves this premise; stop bound work and retain its logs'});
if(!stopped.cleanup_complete||stopped.result.stopped_count!==1)throw Error('counterevidence did not stop the running branch');
const job=await tools.ctf_teams_runtime({action:'job',job_id:background.job_id});if(job.status!=='cancelled')throw Error('review did not cancel actual job: '+JSON.stringify(job));
const last=await tools.ctf_teams_experiment({action:'list',experiment_ref:active.result.experiment_ref});
await tools.ctf_teams_experiment({action:'release',ledger_ref:ledger,experiment_ref:active.result.experiment_ref,expected_revision:last.plan.revision,reason:'Keep the cancelled branch as an audited dead end'});
const continuity=await tools.ctf_teams_experiment({action:'plan',ledger_ref:ledger,hypothesis_id:timed.hypothesis_id,coverage_key:'pause-continuity-v1',method:'Keep a bounded experiment focused across explicit team pause',if_true:'file is preserved',if_false:'file changed',kind:'control',estimated_seconds:1,budget_seconds:300,max_runs:3});
await tools.ctf_teams_exec({command:'printf PAUSE_LEDGER_OK',experiment_ref:continuity.result.experiment_ref,wait_ms:10000});
return 'RESEARCH_REAL_EXEC_PASSED';`,'RESEARCH_REAL_EXEC_PASSED')
      assert.equal(readFileSync(join(scope.host_workdir,'research-count.txt'),'utf8'),'1')
      assert.equal(existsSync(join(scope.host_workdir,'research-bypass')),false)
      assert.equal(existsSync(join(scope.host_workdir,'research-repeat')),false)
      assert.equal(existsSync(join(scope.host_workdir,'research-should-stop')),false)
      // Host permission and normal tool guard both apply; no native fallback.
      const sandbox=await import('@deepseek-ai/dsh-sandbox-policy');sandbox.setSandboxMode(agent.session,'read-only')
      await turn(`let denied=false;try{await tools.ctf_teams_exec({command:'touch read-only-bypass'});}catch(e){denied=e.message.includes('read-only');}if(!denied)throw Error('permission bypass');return 'DOCKER_READ_ONLY_REJECTED';`,'DOCKER_READ_ONLY_REJECTED')
      assert.equal(existsSync(join(scope.host_workdir,'read-only-bypass')),false)
      ctx.permissionPresets.set(agent.session,'danger-full-access')
      const stop=await haltTeamWork({ctx,stateRoot:join(cwd,'.ctf-teams'),teamId:team.id,captain:agent,preserveTasks:true})
      assert.equal(stop.runtimeStop.stopped,true)
      const tick=readFileSync(join(scope.host_workdir,'ticks'));await new Promise(r=>setTimeout(r,250));assert.deepEqual(readFileSync(join(scope.host_workdir,'ticks')),tick)
      const pausedPlan=JSON.parse(readFileSync(teamFile,'utf8')).experiments.at(-1)
      assert.equal(pausedPlan.clockStarted,undefined)
      writeFileSync(join(cwd,'docker-before-cold.json'),JSON.stringify({captain:agent.id,ticks:tick.toString('hex'),container:scope.container,workdir:scope.host_workdir,experimentRef:team.id+'@'+team.boardId+'/'+pausedPlan.id,experimentRemaining:pausedPlan.budgetSeconds*1000-pausedPlan.spentMs}))
      assert.equal(JSON.parse(readFileSync(teamFile,'utf8')).halted,true)
      await ctx.sessions.flush(agent.session);await handle.dispose()
      appendFileSync(process.env.LAB_TRACE,JSON.stringify({event:'docker-product-passed',bytes:true,workspaceMode:true,readOnlyDenied:true,pauseStopsJobs:true,captain:agent.id,research:{cheapControlFirst:true,concurrentBudgetStopsDuplicate:true,omissionCannotBypass:true,reviewedRefutationGatesRoute:true,realDeadline:true,invaliditySeparated:true,refutationCancelsActualJob:true,pauseBudgetFrozen:true}})+'\n')
      console.log('DOCKER_PRODUCT_PASSED');process.exit(0)
    }
    const before=JSON.parse(readFileSync(join(cwd,'docker-before-cold.json'),'utf8')),scope=runtimeScope(cwd,saved)
    await turn(`const s=await tools.ctf_teams_runtime({action:'status'});if(s.running)throw Error('cold read restarted container');const e=await tools.ctf_teams_experiment({action:'list',experiment_ref:${JSON.stringify(before.experimentRef)}});if(e.plan.clockStarted!==undefined||e.plan.remaining_ms!==${before.experimentRemaining})throw Error('cold pause consumed experiment budget');await tools.ctf_teams_resume({reason:'explicit user request in isolated cold recovery test'});const r=await tools.ctf_teams_exec({command:${JSON.stringify(readBinary)},wait_ms:10000});if(r.exit_code!==0)throw Error(JSON.stringify(r));return 'DOCKER_COLD_FILES_PRESERVED';`,'DOCKER_COLD_FILES_PRESERVED')
    assert.equal(agent.id,before.captain);assert.equal(readFileSync(join(scope.host_workdir,'ticks')).toString('hex'),before.ticks)
    assert.equal(JSON.parse(readFileSync(teamFile,'utf8')).experiments.length,5)
    const fresh=JSON.parse(readFileSync(teamFile,'utf8'));await haltTeamWork({ctx,stateRoot:join(cwd,'.ctf-teams'),teamId:fresh.id,captain:agent,preserveTasks:true})
    await ctx.sessions.flush(agent.session);await handle.dispose()
    assert.equal((await dockerCommand(['rm',scope.container])).code,0)
    appendFileSync(process.env.LAB_TRACE,JSON.stringify({event:'docker-cold-passed',sameCaptain:true,filesPreserved:true,noOldJobReplay:true,researchLedgerPreserved:true,pausedBudgetPreserved:true})+'\n')
    console.log('DOCKER_COLD_PASSED');process.exit(0)
  })().catch(error=>{console.error(error);process.exit(1)})
}

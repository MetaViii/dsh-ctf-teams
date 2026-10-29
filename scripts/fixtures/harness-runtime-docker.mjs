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
let code='',expected='',called=false
class Adapter extends LlmAdapter{
  async listModels(){return[model]}
  async resolveModel(provider,id){return{...model,provider,id}}
  async *stream(options){
    if(options.purpose||called){
      if(!options.purpose)assert.ok(JSON.stringify(options.messages).includes(expected),'The real tool bridge did not return the expected outcome')
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
      code=program;expected=marker;called=false
      agent.followup(createUserMessage({content:[{type:'text',text:cold?'Explicitly resume this isolated test team and verify its preserved files.':'Run the authorized Docker runtime test: '+marker}],source:{kind:'user'}}))
      await new Promise(r=>setImmediate(r));await agent.whenIdle()
      assert.equal(called,true)
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
      // Host permission and normal tool guard both apply; no native fallback.
      const sandbox=await import('@deepseek-ai/dsh-sandbox-policy');sandbox.setSandboxMode(agent.session,'read-only')
      await turn(`let denied=false;try{await tools.ctf_teams_exec({command:'touch read-only-bypass'});}catch(e){denied=e.message.includes('read-only');}if(!denied)throw Error('permission bypass');return 'DOCKER_READ_ONLY_REJECTED';`,'DOCKER_READ_ONLY_REJECTED')
      assert.equal(existsSync(join(scope.host_workdir,'read-only-bypass')),false)
      ctx.permissionPresets.set(agent.session,'danger-full-access')
      const stop=await haltTeamWork({ctx,stateRoot:join(cwd,'.ctf-teams'),teamId:team.id,captain:agent,preserveTasks:true})
      assert.equal(stop.runtimeStop.stopped,true)
      const tick=readFileSync(join(scope.host_workdir,'ticks'));await new Promise(r=>setTimeout(r,250));assert.deepEqual(readFileSync(join(scope.host_workdir,'ticks')),tick)
      writeFileSync(join(cwd,'docker-before-cold.json'),JSON.stringify({captain:agent.id,ticks:tick.toString('hex'),container:scope.container,workdir:scope.host_workdir}))
      assert.equal(JSON.parse(readFileSync(teamFile,'utf8')).halted,true)
      await ctx.sessions.flush(agent.session);await handle.dispose()
      appendFileSync(process.env.LAB_TRACE,JSON.stringify({event:'docker-product-passed',bytes:true,workspaceMode:true,readOnlyDenied:true,pauseStopsJobs:true,captain:agent.id})+'\n')
      console.log('DOCKER_PRODUCT_PASSED');process.exit(0)
    }
    const before=JSON.parse(readFileSync(join(cwd,'docker-before-cold.json'),'utf8')),scope=runtimeScope(cwd,saved)
    await turn(`const s=await tools.ctf_teams_runtime({action:'status'});if(s.running)throw Error('cold read restarted container');await tools.ctf_teams_resume({reason:'explicit user request in isolated cold recovery test'});const r=await tools.ctf_teams_exec({command:${JSON.stringify(readBinary)},wait_ms:10000});if(r.exit_code!==0)throw Error(JSON.stringify(r));return 'DOCKER_COLD_FILES_PRESERVED';`,'DOCKER_COLD_FILES_PRESERVED')
    assert.equal(agent.id,before.captain);assert.equal(readFileSync(join(scope.host_workdir,'ticks')).toString('hex'),before.ticks)
    const fresh=JSON.parse(readFileSync(teamFile,'utf8'));await haltTeamWork({ctx,stateRoot:join(cwd,'.ctf-teams'),teamId:fresh.id,captain:agent,preserveTasks:true})
    await ctx.sessions.flush(agent.session);await handle.dispose()
    assert.equal((await dockerCommand(['rm',scope.container])).code,0)
    appendFileSync(process.env.LAB_TRACE,JSON.stringify({event:'docker-cold-passed',sameCaptain:true,filesPreserved:true,noOldJobReplay:true})+'\n')
    console.log('DOCKER_COLD_PASSED');process.exit(0)
  })().catch(error=>{console.error(error);process.exit(1)})
}

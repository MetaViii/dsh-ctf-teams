/** Real host service continuity with HMR disabled; deterministic LLM, actual tool dispatch and files. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { installModelSelection } from '@deepseek-ai/dsh-agent'

let commands = [], requests = 0, reviewRequests = 0, failReview = false
const model = {provider:'runtime-services',id:'first',name:'Runtime fixture',context:{contextWindow:262144},defaultMaxTokens:4096}
class Adapter extends LlmAdapter {
  async listModels(){return [model,{...model,id:'second'}]}
  async resolveModel(provider,id){return {...model,provider,id}}
  async *stream(options){
    appendFileSync(join(process.cwd(),'fixture-requests.jsonl'),JSON.stringify({purpose:options.purpose,model:options.model,toolCount:options.tools?.length})+'\n')
    if(typeof options.system==='string'&&options.system.includes('final authorization reviewer')){
      reviewRequests++
      const block={type:'text',text:failReview?'invalid review response':'{"risk":"low","decision":"allow"}'}
      yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text:block.text};yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:'stop'}};return
    }
    requests++
    const command=options.purpose?undefined:commands.shift(), block=command?{type:'tool-call',id:ToolCallId('runtime-'+requests),name:command.name,arguments:JSON.stringify(command.args)}:{type:'text',text:'Runtime check done.'}
    yield {type:'block-start',index:0,blockType:block.type}
    yield command?{type:'tool-call-delta',index:0,id:block.id,name:block.name,argumentsDelta:block.arguments}:{type:'text-delta',index:0,text:block.text}
    yield {type:'block-end',index:0,block};yield {type:'finish',reason:{kind:command?'tool-calls':'stop'}}
  }
}
export const name='runtime-services-lab'
export const inject=['llm','agents','sessions','tools','sessionProjections','agentPresets','agentDefaultModel']
export function apply(ctx){
  ctx.llm.registerAdapter(['runtime-services'],new Adapter())
  ctx.on('internal/get',(target,property,error,next)=>{
    try{return next()}catch(failure){
      if(property==='sessionProjections')writeFileSync(join(process.cwd(),'runtime-context-error.json'),JSON.stringify({property,entry:target.fiber.entry?.options?.id,state:target.fiber.state,stack:failure.stack},null,2))
      throw failure
    }
  })
  let configEdits=0
  ctx.tools.register({name:'runtime_config_probe',description:'Edit only the isolated test profile while a tool is in flight',parameters:{},output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},async execute(){
    appendFileSync(process.env.RUNTIME_PROFILE_PATCH,`\n# safe configuration edit ${++configEdits}\n`)
    if(process.env.RUNTIME_PERMISSION_RELOAD==='1'){
      const entry=[...ctx.get('loader').entries()].find(entry=>entry.options.id==='permission')
      assert.ok(entry);assert.ok(ctx.get('configEditor'))
      const presets=JSON.parse(JSON.stringify(ctx.get('permissionPresets').presets))
      presets['fixture-read-only-'+configEdits]={sandbox:'read-only',approval:'ask'}
      await ctx.get('configEditor').edit(entry,config=>({...config,presets}))
    }
    if(process.env.RUNTIME_DIRECT_CONFIG==='1')await ctx.agentDefaultModel.saveSelection({provider:'runtime-services',model:configEdits===1?'second':'first'})
    await new Promise(resolve=>setTimeout(resolve,2600))
    return 'CONFIG_EDIT_WITHOUT_RELOAD'
  }})
  void(async()=>{
    await ctx.get('loader').await()
    assert.equal(ctx.get('hmr'),undefined,'HMR must actually be disabled, not an ignored manifest field')
    const cold=process.env.RUNTIME_COLD==='1',idFile=join(process.cwd(),'runtime-session-id.json')
    const sessionId=cold?JSON.parse(readFileSync(idFile,'utf8')).id:'session-'+randomUUID()
    const handle=cold?await ctx.agents.resume({resumeSessionId:sessionId,agentOptions:{provider:'runtime-services',model:'first'},setup:async agentCtx=>{await ctx.agentPresets.mount(agentCtx,'ctf-teams')}}):await ctx.agents.create({sessionId,meta:{cwd:process.cwd()},agentOptions:{provider:'runtime-services',model:'first'}})
    ctx.effect(()=>()=>handle.dispose())
    const agent=handle.agent
    if(!cold)await ctx.agentPresets.select(agent,'ctf-teams')
    assert.equal(ctx.agentPresets.composedPreset(agent.ctx),'ctf-teams')
    writeFileSync(idFile,JSON.stringify({id:agent.id}));agent.ctx.tools.presentAs('native')
    const selection={current:{provider:'runtime-services',model:'first'},assembled:undefined}
    installModelSelection(agent.ctx,selection)
    if(process.env.RUNTIME_AUTO_MODE==='1')ctx.get('permissionPresets').set(agent.session,'auto')
    const rounds=[]
    for(let round=0;round<3;round++){
      if(round){
        selection.current={provider:'runtime-services',model:round===1?'second':'first'}
      }
      const path=join(process.cwd(),'runtime-proof-'+Number(cold)+'-'+round+'.txt')
      const checks=[{name:'get_goal',args:{}},{name:'write',args:{file_path:path,content:'round-'+round}},{name:'read',args:{file_path:path}},{name:'pwsh',args:{command:"'RUNTIME_SHELL_OK'",description:'Verify native runtime after config edit'}}]
      if(!round&&!cold)checks.unshift({name:'ctf_teams_create',args:{name:'runtime-services',mode:'solo',approval:'automatic'}})
      else checks.unshift({name:'runtime_config_probe',args:{}})
      checks.push({name:'ctf_teams_status',args:{}})
      const start=agent.session.ownEvents().length
      commands=[...checks]
      agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Execute the authorized local runtime continuity checks.'}]}))
      await agent.whenIdle();assert.equal(commands.length,0,JSON.stringify(agent.session.ownEvents().slice(-8)))
      const results=agent.session.ownEvents().slice(start).filter(event=>event.type==='tool/result')
      assert.equal(results.length,checks.length)
      for(const result of results)assert.equal(result.data.message.isError,false,JSON.stringify(result.data.message))
      assert.equal(readFileSync(path,'utf8'),'round-'+round)
      assert.ok(ctx.sessionProjections.stateOf(agent.session,'permissions'))
      assert.equal(agent.session.requestHeader().config.model,round===1?'second':'first')
      rounds.push({round,model:agent.session.requestHeader().config.model,tools:checks.map(check=>check.name),passed:true})
      if(round===0&&process.env.RUNTIME_TEARDOWN_FAULT==='1'){
        const entry=[...ctx.get('loader').entries()].find(entry=>entry.options.id===(process.env.RUNTIME_CLEANUP_COMPAT==='1'?'ctf-auto-review-cleanup-compat':'auto-review'));assert.ok(entry)
        const target=ctx.get('permissionPresets')[Symbol.for('cordis.original')]
        const descriptor=Object.getOwnPropertyDescriptor(target,'current')
        Object.defineProperty(target,'current',{configurable:true,value(){throw Error('cannot get required service "sessionProjections" in inactive context')}})
        const previous=entry.fiber
        const hooks=()=>ctx.events._hooks['tools/pre-execute'].map(hook=>({id:hook.ctx.fiber.entry?.options.id,name:hook.ctx.fiber.name,state:hook.ctx.fiber.state,effects:hook.ctx.fiber.getEffects()}))
        writeFileSync(join(process.cwd(),'cleanup-before.json'),JSON.stringify({entry:entry.options.name,hooks:hooks()},null,2))
        try{await entry.update({disabled:true});await previous.await();assert.equal(previous.state,4,'The previous instance must be fully disposed before rebuilding')}finally{if(descriptor)Object.defineProperty(target,'current',descriptor);else delete target.current}
        writeFileSync(join(process.cwd(),'cleanup-after.json'),JSON.stringify({state:previous.state,hooks:hooks()},null,2))
        await entry.update({disabled:false});await ctx.get('loader').await()
        assert.equal(ctx.get('permissionPresets').current(agent.session),'auto','The review preset must survive without weakening policy')
      }
    }
    if(process.env.RUNTIME_AUTO_MODE==='1'){
      assert.ok(reviewRequests>=rounds.reduce((count,round)=>count+round.tools.length,0),'Every tool must still reach the upstream reviewer')
      const forbidden=join(process.cwd(),'must-not-execute-'+Number(cold)+'.txt'),start=agent.session.ownEvents().length
      failReview=true
      commands=[{name:'write',args:{file_path:forbidden,content:'The invalid reviewer must block this body'}}]
      agent.followup(createUserMessage({source:{kind:'user'},content:[{type:'text',text:'Verify reviewer errors block the isolated test write.'}]}))
      await agent.whenIdle();failReview=false
      const rejected=agent.session.ownEvents().slice(start).filter(event=>event.type==='tool/result')
      assert.equal(commands.length,0);assert.equal(rejected.length,1);assert.equal(rejected[0].data.message.isError,true)
      assert.match(JSON.stringify(rejected[0].data.message),/Auto review.*failed/)
      assert.equal(existsSync(forbidden),false,'No tool body may execute when review fails')
    }
    writeFileSync(process.env.RUNTIME_SERVICES_RESULT,JSON.stringify({passed:true,cold,hmrDisabled:true,directConfig:process.env.RUNTIME_DIRECT_CONFIG==='1',teardownFault:process.env.RUNTIME_TEARDOWN_FAULT==='1',configEdits,requests,reviewRequests,rounds},null,2))
    await ctx.sessions.flush(agent.session);await handle.dispose();console.log('RUNTIME_SERVICES_OK');ctx.get('appExit')(0)
  })().catch(error=>{console.error(error.stack??error);ctx.get('appExit')(1)})
}

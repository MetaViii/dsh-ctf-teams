import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { startMemberContinuable, drainMemberChildren } from '../lib/harness-compat.js'
const require=createRequire(realpathSync(new URL('../node_modules/@deepseek-ai/dsh/package.json',import.meta.url)))
const {evaluatePluginCompatibility,loadOptionalPatches}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')))
const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)))

test('real host gate accepts bounded RC/patch updates with both manifest gate paths',()=>{
  for(const version of ['0.2.0-rc.2','0.2.1-rc.1','0.2.1-rc.2','0.2.1-rc.99','0.2.1','0.2.2-alpha.1','0.2.22']){
    assert.equal(evaluatePluginCompatibility(manifest,{},version),undefined,version)
    const peersOnly={...manifest,engines:{node:manifest.engines.node}}
    assert.equal(evaluatePluginCompatibility(peersOnly,{},version),undefined,version+' peers')
  }
  const before={...manifest,engines:{node:manifest.engines.node},peerDependencies:Object.fromEntries(Object.entries(manifest.peerDependencies).map(([name,range])=>[name,name.startsWith('@deepseek-ai/dsh-')?'0.2.1-rc.1':range]))}
  const rejected=evaluatePluginCompatibility(before,{},'0.2.1-rc.2')
  assert.ok(Object.keys(rejected.requirements??rejected.peers).length>0)
  for(const version of ['0.3.0-0','0.3.0-alpha.1','0.3.0','1.0.0'])assert.equal(evaluatePluginCompatibility(manifest,{},version).exempted,false)
})

test('preset persona uses required modern directory context and retains legacy cwd interpolation',()=>{
  const patches=loadOptionalPatches('dsh',fileURLToPath(new URL('../presets/ctf-teams.patch.yml',import.meta.url)))
  const preset=patches[0].insert.find(entry=>entry.id==='preset-ctf-teams')
  const expression=preset.config.plugins.find(entry=>entry.id==='persona').config.suffix.__jsExpr
  assert.equal(runInNewContext(expression,{ctx:{get:name=>name==='workingDirectory'?{}:undefined}}),'')
  assert.equal(runInNewContext(expression,{ctx:{get:()=>undefined}}),'Your working directory is {{cwd}}.')
})

test('member activation uses caller reporting on the new API and retains legacy continuable routing',async()=>{
  const request={parent:{id:'captain'},prompt:[]},spec={provider:'spawn',label:'member',request,signal:new AbortController().signal}
  const modern={async startActivation(input){assert.equal(this,modern);assert.equal(input.request,request);assert.equal(input.delivery,'caller');return {childId:'modern',messageId:'accepted'}}}
  assert.equal((await startMemberContinuable(modern,spec)).childId,'modern')
  assert.equal(spec.delivery,undefined)
  const legacy={async startContinuable(input){assert.equal(this,legacy);assert.equal(input,spec);return {childId:'legacy',messageId:'accepted'}}}
  assert.equal((await startMemberContinuable(legacy,spec)).childId,'legacy')
  await assert.rejects(startMemberContinuable({},spec),/unsupported Harness subagent contract/)
})

test('targeted member drain retains exact owner, ids, errors and receiver on both APIs',async()=>{
  const owner={id:'captain'},ids=['worker']
  for(const key of ['drainChildren','drainContinuableChildren']){
    let called=false
    const runtime={[key]:async function(parent,children){assert.equal(this,runtime);assert.equal(parent,owner);assert.equal(children,ids);called=true}}
    await drainMemberChildren(runtime,owner,ids);assert.equal(called,true)
  }
  const rejection=Error('wrong owner');await assert.rejects(drainMemberChildren({async drainChildren(){throw rejection}},owner,ids),error=>error===rejection)
  await assert.rejects(drainMemberChildren({},owner,ids),/unsupported Harness/)
})

/** Test a packaged plugin against an isolated copy of an installed desktop runtime. */
import assert from 'node:assert/strict'
import { mkdirSync, existsSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { runRuntimeScenarios, runtimeScenarios } from './harness-runtime-scenarios.mjs'
import { windowsPowerShellModulePath } from '../lib/windows-shell.js'

const flags=new Map()
for(let index=2;index<process.argv.length;index+=2){
  const key=process.argv[index],value=process.argv[index+1]
  assert.ok(['--runtime-root','--artifact','--report-dir','--scenario'].includes(key)&&!flags.has(key)&&value,'Invalid arguments')
  flags.set(key,value)
}
for(const key of ['--runtime-root','--artifact','--report-dir'])assert.ok(flags.has(key),key+' is required')
const source=resolve(flags.get('--runtime-root')),artifact=resolve(flags.get('--artifact')),report=resolve(flags.get('--report-dir'))
assert.equal(existsSync(report),false,'Choose a fresh report directory; existing evidence must not be overwritten')
const version=JSON.parse(readFileSync(join(source,'node_modules/@deepseek-ai/dsh/package.json'))).version
const scenario=flags.get('--scenario');assert.ok(!scenario||runtimeScenarios.includes(scenario),'Unknown scenario')
const runtime=join(report,'runtime'),unpack=join(report,'artifact')
mkdirSync(join(runtime,'node_modules/@nanmicoder'),{recursive:true});mkdirSync(unpack)
const extraction=spawnSync('tar',['-xzf',artifact,'-C',unpack],{encoding:'utf8',windowsHide:true});assert.equal(extraction.status,0,extraction.stderr)
const plugin=join(unpack,'package')
mkdirSync(join(plugin,'node_modules'),{recursive:true})
for(const destination of [join(runtime,'node_modules/@deepseek-ai'),join(plugin,'node_modules/@deepseek-ai')])symlinkSync(join(source,'node_modules/@deepseek-ai'),destination,process.platform==='win32'?'junction':'dir')
symlinkSync(plugin,join(runtime,'node_modules/@nanmicoder/dsh-ctf-teams'),process.platform==='win32'?'junction':'dir')
mkdirSync(join(report,'user-home'));mkdirSync(join(report,'tmp'))
const environment=extra=>({PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,ComSpec:process.env.ComSpec,PSModulePath:windowsPowerShellModulePath(process.env),TEMP:join(report,'tmp'),TMP:join(report,'tmp'),HOME:join(report,'user-home'),USERPROFILE:join(report,'user-home'),LANG:'en_US.UTF-8',...extra})
async function command(argv,cwd,env,label,timeoutMs){
  const child=spawn(argv[0],argv.slice(1),{cwd,env,stdio:['ignore','pipe','pipe'],windowsHide:true})
  let stdout='',stderr='',timedOut=false
  child.stdout.on('data',value=>stdout+=value);child.stderr.on('data',value=>stderr+=value)
  const timer=setTimeout(()=>{timedOut=true;child.kill()},timeoutMs)
  const exit=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>done({code,signal}))});clearTimeout(timer)
  writeFileSync(join(report,label+'.stdout.log'),stdout);writeFileSync(join(report,label+'.stderr.log'),stderr)
  return {...exit,stdout,stderr,timedOut}
}
const runs=await runRuntimeScenarios({report,runtime,command,environment,selectedScenarios:scenario?[scenario]:runtimeScenarios,linkWorkspacePackages:true})
const result={passed:runs.every(run=>run.passed),version,runtimeSource:source,artifactSha256:createHash('sha256').update(readFileSync(artifact)).digest('hex'),platform:process.platform,node:process.version,runs,unverified:['Interactive desktop GUI','Real model/provider APIs','Online platform submissions','Other operating systems','Live user-data migration']}
writeFileSync(join(report,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1

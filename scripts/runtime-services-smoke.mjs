/** Isolated real-host service continuity and opt-in Auto review cleanup fault tests. */
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readdirSync,readFileSync,writeFileSync,realpathSync,symlinkSync,copyFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname,resolve} from 'node:path'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {spawn,spawnSync} from 'node:child_process'
const root=dirname(dirname(fileURLToPath(import.meta.url))), rawArgs=process.argv.slice(2)
const runtimeIndex=rawArgs.indexOf('--runtime-root'),runtimeRoot=runtimeIndex<0?undefined:resolve(rawArgs[runtimeIndex+1]??'')
if(runtimeIndex>=0){assert.ok(rawArgs[runtimeIndex+1]&&!rawArgs[runtimeIndex+1].startsWith('--'),'--runtime-root needs an extracted runtime directory');rawArgs.splice(runtimeIndex,2)}
const directConfig=rawArgs.includes('--direct-config'), cleanupCompat=rawArgs.includes('--cleanup-compat'), autoReview=rawArgs.includes('--auto-review')||cleanupCompat, cold=rawArgs.includes('--cold'), permissionReload=rawArgs.includes('--permission-reload'), autoMode=rawArgs.includes('--auto-mode'), teardownFault=rawArgs.includes('--teardown-fault'), args=rawArgs.filter(arg=>!['--direct-config','--auto-review','--cold','--permission-reload','--cleanup-compat','--auto-mode','--teardown-fault'].includes(arg))
assert.ok(args.length===0||args.length===2&&args[0]==='--artifact','Usage: node scripts/runtime-services-smoke.mjs [--artifact package.tgz] [--direct-config] [--auto-review|--cleanup-compat] [--auto-mode] [--teardown-fault] [--permission-reload] [--cold]')
assert.ok(!autoMode||autoReview,'--auto-mode requires --auto-review or --cleanup-compat')
assert.ok(!teardownFault||autoMode,'--teardown-fault requires --auto-mode')
const lab=mkdtempSync(join(tmpdir(),'ctf-runtime-services-')),home=join(lab,'home'),profile=join(home,'profiles/headless'),workspace=join(lab,'workspace')
mkdirSync(join(profile,'node_modules/@deepseek-ai'),{recursive:true});mkdirSync(join(profile,'node_modules/@nanmicoder'),{recursive:true});mkdirSync(workspace)
let pluginRoot=root
if(args.length){const unpack=join(lab,'artifact');mkdirSync(unpack);const result=spawnSync('tar',['-xzf',resolve(args[1]),'-C',unpack],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);pluginRoot=join(unpack,'package')}
const packages=new Map()
for(const base of runtimeRoot?[join(runtimeRoot,'node_modules/@deepseek-ai')]:[join(root,'node_modules/.pnpm/node_modules/@deepseek-ai'),join(root,'node_modules/@deepseek-ai')])for(const name of readdirSync(base))packages.set(name,realpathSync(join(base,name)))
for(const[name,path]of packages)symlinkSync(path,join(profile,'node_modules/@deepseek-ai',name),'junction')
symlinkSync(pluginRoot,join(profile,'node_modules/@nanmicoder/dsh-ctf-teams'),'junction')
if(pluginRoot!==root){mkdirSync(join(pluginRoot,'node_modules'));symlinkSync(join(profile,'node_modules/@deepseek-ai'),join(pluginRoot,'node_modules/@deepseek-ai'),'junction')}
writeFileSync(join(profile,'package.json'),JSON.stringify({name:'runtime-services-lab',private:true,type:'module',dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-headless','@nanmicoder/dsh-ctf-teams',...autoReview?['@deepseek-ai/dsh-experimental-auto-review']:[]]}}}))
copyFileSync(join(root,'scripts/fixtures/harness-runtime-services.mjs'),join(profile,'fixture.mjs'))
const patch=join(profile,'cordis.patch.yml')
writeFileSync(patch,`- id: hmr
  disabled: true
- id: llm-deepseek
  disabled: true
- id: llm-pi-ai
  disabled: true
- id: headless-startup
  disabled: true
- id: headless-runner
  disabled: true
- id: permission
  config:
    defaultPreset: workspace-write
- id: ctf-teams
  config:
    defaultProfile: ""
    references:
      autoSync: off
- insert:
    - id: subagent-model-selection-settings
      name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
    - id: agent-preset-registry
      name: '@deepseek-ai/dsh-agent-preset-registry'
      config:
        default: ctf-teams
        selectedDefault: ctf-teams
    - id: runtime-services-lab
      name: ./fixture.mjs
`)
if(cleanupCompat)writeFileSync(patch,readFileSync(patch,'utf8')+`- id: auto-review\n  disabled: true\n- insert:\n    - id: ctf-auto-review-cleanup-compat\n      name: '${pathToFileURL(join(root,'lib/auto-review-cleanup.js')).href}'\n`)
const output=join(lab,'probe.json'),boots=[]
let stdout='',stderr='',timedOut=false,exit
for(const boot of cold?[0,1]:[0]){
  const child=spawn(process.execPath,[join(packages.get('dsh'),'lib/bin.js'),'--profile','headless'],{cwd:workspace,env:{...process.env,DSH_HOME:home,DSH_PERMISSION_MODE:'workspace-write',DSH_TELEMETRY_DISABLED:'1',RUNTIME_PROFILE_PATCH:patch,RUNTIME_SERVICES_RESULT:output,RUNTIME_DIRECT_CONFIG:directConfig?'1':'0',RUNTIME_COLD:String(boot),RUNTIME_PERMISSION_RELOAD:permissionReload?'1':'0',RUNTIME_AUTO_MODE:autoMode?'1':'0',RUNTIME_TEARDOWN_FAULT:teardownFault?'1':'0',RUNTIME_CLEANUP_COMPAT:cleanupCompat?'1':'0'},windowsHide:true,stdio:['ignore','pipe','pipe']})
  stdout='';stderr='';timedOut=false
  child.stdout.on('data',data=>stdout+=data);child.stderr.on('data',data=>stderr+=data)
  const timer=setTimeout(()=>{timedOut=true;child.kill()},90000)
  exit=await new Promise((done,reject)=>{child.on('error',reject);child.on('exit',done)});clearTimeout(timer)
  writeFileSync(join(lab,`stdout-${boot}.log`),stdout);writeFileSync(join(lab,`stderr-${boot}.log`),stderr)
  boots.push({boot,exit,timedOut,result:existsSync(output)?JSON.parse(readFileSync(output)):undefined})
  if(exit!==0||timedOut)break
}
const cohort=[...packages.values()].map(path=>JSON.parse(readFileSync(join(path,'package.json')))).filter(pkg=>pkg.name==='@deepseek-ai/dsh'||pkg.name.startsWith('@deepseek-ai/dsh-')).map(pkg=>({name:pkg.name,version:pkg.version}))
const report={passed:exit===0&&!timedOut&&stdout.includes('RUNTIME_SERVICES_OK'),exit,timedOut,reportDir:lab,hostVersion:JSON.parse(readFileSync(join(packages.get('dsh'),'package.json'))).version,runtimeSource:runtimeRoot??'project-pinned npm closure',cohort,result:existsSync(output)?JSON.parse(readFileSync(output)):undefined,boots,limits:['Deterministic LLM; cleanup fault injection reproduces stale callbacks, but the original outage trigger remains unproven.','No interactive Electron operations or provider authentication were exercised.']}
writeFileSync(join(lab,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
if(!report.passed){console.error(stderr.slice(-5000));console.error(stdout.slice(-2000));process.exitCode=1}

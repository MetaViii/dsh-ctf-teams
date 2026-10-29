import assert from 'node:assert/strict'
import { mkdtemp, copyFile, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runtimeScope, prepareRuntime, executeRuntime, readRuntimeJob, pauseTeamRuntime, dockerCommand, stageRuntimeInput } from '../lib/docker-runtime.js'
const workspace=await mkdtemp(join(tmpdir(),'ctf-toolchain-proof-')),team={id:'toolchain',captainSessionId:'probe',boardId:'toolchain-v1',createdAt:1},scope=runtimeScope(workspace,team)
const signal=new AbortController().signal,config={image:'dsh-ctf-tools:0.1.36',autoBuild:false},admit=async()=>{}
try{
  await copyFile(fileURLToPath(new URL('./fixtures/ctf-toolchain-probe.py',import.meta.url)),join(workspace,'probe.py'))
  await stageRuntimeInput(scope,'probe.py','probe.py')
  const state=await prepareRuntime(scope,config,signal,admit)
  let job=await executeRuntime(scope,config,{command:'python3 probe.py',owner:'captain',timeoutMs:240000,waitMs:0},signal,admit)
  const deadline=Date.now()+250000
  while(['running','starting'].includes(job.status)&&Date.now()<deadline){await new Promise(r=>setTimeout(r,1500));job=await readRuntimeJob(scope,job.id,'captain',true,signal)}
  const result=JSON.parse(await readFile(join(scope.host_workdir,'toolchain-report.json'),'utf8'))
  result.imageId=state.image_id;result.jobStatus=job.status;result.exitCode=job.exit_code
  await writeFile(process.argv[2]??'tmp/iteration11-toolchain.json',JSON.stringify(result,null,2)+'\n')
  console.log(JSON.stringify({passed:result.passed,checks:Object.keys(result.checks).length,commands:Object.keys(result.commands).length,modules:Object.keys(result.python_modules).length,failures:result.failures,imageId:state.image_id}))
  assert.equal(job.exit_code,0,JSON.stringify(result.failures));assert.equal(result.passed,true)
}finally{await pauseTeamRuntime(workspace,team);await dockerCommand(['rm',scope.container]);await rm(workspace,{recursive:true,force:true})}

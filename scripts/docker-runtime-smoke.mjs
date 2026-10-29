/** Real Docker process/filesystem proof; no model or target credentials. */
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { runtimeScope, prepareRuntime, executeRuntime, readRuntimeJob, pauseTeamRuntime, dockerCommand, stageRuntimeInput, cancelMemberRuntimeJobs } from '../lib/docker-runtime.js'
const image=process.argv[2]??'dsh-ctf-tools:0.1.36',reportPath=process.argv[3]??'tmp/iteration11-docker-smoke.json'
const workspace=await mkdtemp(join(tmpdir(),'ctf,docker-proof-'))
const team={id:'proof',captainSessionId:'proof-captain',boardId:'proof-generation',createdAt:1},scope=runtimeScope(workspace,team)
const config={image,autoBuild:false,memoryMb:2048,cpus:2},signal=new AbortController().signal
let halted=false
const admit=async()=>{if(halted)throw Error('team halted')}
const command=async(cmd,extra={})=>executeRuntime(scope,config,{command:cmd,owner:'worker',taskId:'t1',attemptId:'attempt-a',waitMs:10000,...extra},signal,admit)
const checks={}
try{
  await writeFile(join(workspace,"附件 '$.bin"),Buffer.from([0,255,0,128]))
  const staged=await stageRuntimeInput(scope,"附件 '$.bin",'input/evidence.bin')
  const state=await prepareRuntime(scope,config,signal,admit)
  checks.containerIdentityRecorded=!!state.container_id&&!!state.image_id
  let job=await command("python3 -c \"from pathlib import Path; assert Path('input/evidence.bin').read_bytes()==bytes([0,255,0,128]); Path('result.bin').write_bytes(bytes([1,0,255,128])); print('binary-ok')\"")
  assert.equal(job.status,'completed',JSON.stringify(job));assert.equal(job.exit_code,0);assert.match(job.stdout,/binary-ok/)
  assert.deepEqual(await readFile(join(scope.host_workdir,'result.bin')),Buffer.from([1,0,255,128]));checks.binaryRoundTrip=true
  job=await command("printf 'failure-output'; printf 'actual-error' >&2; exit 7")
  assert.equal(job.exit_code,7);assert.match(job.stderr,/actual-error/);checks.nonzeroPreserved=true
  job=await command("python3 -c \"print('Q'*100000)\"")
  assert.ok(job.stdout.length<20000);assert.ok((await readFile(job.stdout_path)).length>100000);checks.fullLogsPersisted=true
  job=await command('sleep 20',{timeoutMs:150})
  assert.equal(job.status,'timed_out',JSON.stringify(job));checks.deadlineKillsJob=true
  job=await command('pwd',{workdir:'does-not-exist'})
  assert.equal(job.status,'failed');checks.invalidWorkingDirectoryTerminates=true
  const background=await command("while true; do printf x >> ticks; sleep .1; done",{waitMs:0})
  assert.ok(['running','starting'].includes(background.status))
  await assert.rejects(readRuntimeJob(scope,background.id,'other',false),/unowned/);checks.ownerFence=true
  await new Promise(r=>setTimeout(r,300));halted=true
  const paused=await pauseTeamRuntime(workspace,team);assert.equal(paused.stopped,true)
  const before=await readFile(join(scope.host_workdir,'ticks'))
  await new Promise(r=>setTimeout(r,350));assert.deepEqual(await readFile(join(scope.host_workdir,'ticks')),before)
  await assert.rejects(command('touch forbidden'),/halted/)
  checks.pauseStopsBackgroundAndAdmission=true
  const interrupted=await readRuntimeJob(scope,background.id,'worker',false)
  assert.equal(interrupted.status,'interrupted');assert.ok(interrupted.stdout_path);checks.pausedLogsSaved=true
  halted=false
  job=await command("python3 -c \"from pathlib import Path; assert Path('result.bin').read_bytes()==bytes([1,0,255,128]); print('resume-ok')\"")
  assert.equal(job.exit_code,0);await new Promise(r=>setTimeout(r,250));assert.deepEqual(await readFile(join(scope.host_workdir,'ticks')),before)
  checks.resumePreservesFilesWithoutReplayingOldJobs=true
  const revoked=await command('while true; do sleep .1; done',{waitMs:0})
  await cancelMemberRuntimeJobs(workspace,team,'worker','t1')
  assert.equal((await readRuntimeJob(scope,revoked.id,'worker',false)).status,'cancelled');checks.attemptRetirementCancelsOwnedJobs=true
  const crashed=await command('while true; do sleep .1; done',{waitMs:0})
  assert.equal((await dockerCommand(['stop','--time','1',scope.container])).code,0)
  assert.equal((await command('printf recovered')).exit_code,0)
  assert.equal((await readRuntimeJob(scope,crashed.id,'worker',false)).status,'interrupted');checks.externalStopDoesNotResurrectStaleJobs=true
  const long=await command("printf '"+'L'.repeat(40000)+"'")
  assert.equal(long.exit_code,0);assert.equal((await readFile(long.stdout_path)).length,40000);checks.longCommandUsesStdin=true
  const persisted=JSON.parse(await readFile(join(scope.state_dir,'runtime.json'),'utf8'))
  assert.equal(persisted.jobs.length,11);checks.durableJobLedger=true
  const untouched=await readFile(join(workspace,"附件 '$.bin"));assert.equal(createHash('sha256').update(untouched).digest('hex'),createHash('sha256').update(Buffer.from([0,255,0,128])).digest('hex'));checks.originalAttachmentUnchanged=true
  const report={passed:true,image,imageId:state.image_id,checks,unverified:['Real challenge/model solving quality','Other operating systems','Malicious kernel escape isolation']}
  await writeFile(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}finally{
  await pauseTeamRuntime(workspace,team)
  await dockerCommand(['rm',scope.container])
  await rm(workspace,{recursive:true,force:true})
}

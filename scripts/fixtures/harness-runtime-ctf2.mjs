/** Real CLI/Loader + Code Mode CTF2 acceptance. Only the LLM is scripted. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'

const model = { provider: 'runtime-lab', id: 'fixture-model', name: 'CTF2 acceptance fixture', context: { contextWindow: 262144 }, defaultMaxTokens: 8192 }
let step = 0
const coldRestore = process.env.LAB_CTF_COLD === '1'
const marker = coldRestore ? 'CTF2_HANDOVER_RESTORED' : 'CTF2_REGRESSION_PASSED'
const warmCode = `
let diagnostic = '';
try { await tools.ctf_teams_create({name:'bad-plan',plan:{members:[{name:'x',extra:'invalid'}],tasks:[{description:'中文'.repeat(1000)}]}}); }
catch (error) { diagnostic = error.message; }
if (!diagnostic.includes('Missing fields: plan.tasks[0].id, plan.tasks[0].subject') || !diagnostic.includes('Undeclared fields') || diagnostic.includes('missing required property "plan.tasks"')) throw Error('misleading plan diagnostics: '+diagnostic);
const staged = await tools.ctf_teams_create({name:'ctf2-batch',challenge_mode:'batch',approval:'required',plan:{members:[{name:'worker',executionPrompt:'Check raw bytes and preserve case'}],tasks:[{id:'recon',subject:'中文附件侦察',assignee:'worker',challenge_id:'inline-a',resource_key:'slot-a',preflight:['access_ready']}]}});
if (staged.challenge_mode !== 'batch' || !(await tools.ctf_teams_status({})).ctf.challenge.multiChallenge) throw Error('batch creation not persisted before dispatch');
const inlineState=await tools.ctf_teams_status({});
if(inlineState.tasks[0].challenge_id!=='inline-a'||inlineState.tasks[0].resource_key!=='slot-a'||inlineState.tasks[0].preflight[0]!=='access_ready')throw Error('inline CTF context was lost');
const guarded = await tools.ctf_teams_create_task({subject:'repair preflight through Code Mode',challenge_id:'gate-fixture',preflight:['access_ready']});
await tools.ctf_teams_edit_plan({operations:[{action:'update_task',task_id:guarded.task_id,preflight:[],preflight_finding_id:''}]});
const repairedPlan = await tools.ctf_teams_status({});
if (repairedPlan.tasks.find(task=>task.id===guarded.task_id).preflight.length !== 0 || !repairedPlan.members[0].route_diagnostics.saved_route.model) throw Error('preflight edit or route diagnostics lost through Code Mode');
let missingChallenge = false;
try { await tools.ctf_teams_submit_flag({flag:'flag{unscoped}'}); } catch { missingChallenge = true; }
if (!missingChallenge) throw Error('batch candidate without challenge_id accepted');
await tools.ctf_teams_create({name:'ctf2-empty',approval:'required',replaceExisting:true});
if ((await tools.ctf_teams_status({})).loop_state !== 'planning') throw Error('captain-planned empty graph incorrectly blocked');
const recover=await tools.ctf_teams_create({name:'ctf2-result-recovery',approval:'automatic',replaceExisting:true});
const recoverTask=await tools.ctf_teams_create_task({subject:'complete synthetic solve',challenge_id:'recovery-a'});
const ownedRecovery=await tools.ctf_teams_reassign_task({task_id:recoverTask.task_id,assignee:'captain'});
await tools.ctf_teams_update_task({task_id:recoverTask.task_id,status:'failed',output:'synthetic old transport failure',attempt_id:ownedRecovery.attempt_id});
const recoverFlag=await tools.ctf_teams_submit_flag({flag:'flag{recovered-synthetic}',challenge_id:'recovery-a'});
await tools.ctf_teams_mark_flag({flag_id:recoverFlag.flag_ref,verdict:'verified',note:'synthetic platform accepted'});
const reconcile={task_id:recoverTask.task_id,expected_attempt:ownedRecovery.attempt,flag_ref:recoverFlag.flag_ref,evidence:'synthetic solver and platform receipt fulfill the ordinary task'};
await tools.ctf_teams_resolve_task(reconcile);
if(!(await tools.ctf_teams_resolve_task(reconcile)).duplicate)throw Error('duplicate resolution rewrote task history');
const solo = await tools.ctf_teams_create({name:'ctf2-solo',mode:'solo',replaceExisting:true});
if (!solo.archived_path || solo.mode !== 'solo') throw Error('solo replacement failed');
await tools.ctf_teams_set_challenge({flag_format:JSON.stringify(['flag.*','n1book.*'])});
if(!Array.isArray((await tools.ctf_teams_status({})).ctf.challenge.flagFormat))throw Error('serialized format list was not normalized');
const soloStatus = await tools.ctf_teams_status({});
if (soloStatus.loop_state !== 'running') throw Error('solo graph incorrectly blocked');
const inspected = await tools.ctf_teams_env({action:'check',runtime:'local',tools:['python3','not-a-tool']});
if (inspected.runtime !== 'local' || inspected.runtime_ready !== true || inspected.statuses.length !== 1 || inspected.unknown[0] !== 'not-a-tool' || !inspected.probe_platform || !inspected.python) throw Error('environment runtime report lost through Code Mode');
let wslInstallDenied = false;
try { await tools.ctf_teams_env({action:'install',runtime:'wsl',distribution:'kali-linux',tools:['sage']}); } catch { wslInstallDenied = true; }
if (!wslInstallDenied) throw Error('WSL inspection must not install packages on the local host');
const synced = await tools.ctf_teams_sync({inbox_limit:1});
if (!Array.isArray(synced.inbox) || synced.inbox_remaining !== 0) throw Error('sync inbox schema failed');
const textVariants = await tools.ctf_teams_text_candidates({text:'01S@',max_candidates:7,decode_base64:true});
if (textVariants.candidates.length !== 7 || textVariants.candidates[0].text !== '01S@' || !textVariants.truncated) throw Error('bounded text candidate tool failed');
await tools.ctf_teams_set_challenge({title:'中文题目',remote:'http://ctf.local',environment_id:'env-ctf2',flag_format:'flag\\\\{[^}]+\\\\}'});
const finding = await tools.ctf_teams_report_finding({content:'文件原始字节: EaSyRe',evidence_kind:'raw_output',confidence:'high',evidence:'xxd attachment.bin'});
await tools.ctf_teams_verify_finding({finding_id:finding.finding_id,method:'independent byte check',result:'confirmed',note:'大小写一致'});
const hypothesis = await tools.ctf_teams_hypothesis({action:'propose',challenge_id:'fixture-crypto',statement:'n is square',prediction:'isqrt(n)**2 == n'});
const duplicateHypothesis = await tools.ctf_teams_hypothesis({action:'propose',challenge_id:'fixture-crypto',statement:'n is square',prediction:'isqrt(n)**2 == n'});
if (!duplicateHypothesis.duplicate || duplicateHypothesis.revision !== 1) throw Error('hypothesis duplicate created a new revision');
const testInput = {action:'record_test',hypothesis_id:hypothesis.hypothesis_id,ledger_ref:hypothesis.ledger_ref,expected_revision:1,test_key:'square-fixture',method:'python square.py n=49',observation:'49 == 7**2',outcome:'supports',basis:'construction',evidence_files:['hypothesis-evidence.txt']};
const recorded = await tools.ctf_teams_hypothesis(testInput);
const repeatedTest = await tools.ctf_teams_hypothesis(testInput);
if (!repeatedTest.duplicate || repeatedTest.revision !== 2 || recorded.test_id !== repeatedTest.test_id) throw Error('experiment retries are not idempotent');
await tools.ctf_teams_hypothesis({...testInput,expected_revision:2,test_key:'correct-input',observation:'actual input n=50',outcome:'refutes',next_step:'verify attachment hash before factoring'});
const ledger = await tools.ctf_teams_hypothesis({action:'list',hypothesis_id:hypothesis.hypothesis_id,check_files:true,limit:1});
if (ledger.total !== 2 || ledger.next_offset !== 1 || ledger.file_checks[0].status !== 'matched' || ledger.tests[0].by !== 'captain' || ledger.summary.conflicts !== 1) throw Error('ledger history or real file evidence lost through Code Mode');
const ledgerNext = await tools.ctf_teams_hypothesis({action:'list',hypothesis_id:hypothesis.hypothesis_id,offset:1});
if (ledgerNext.tests[0].observation !== 'actual input n=50' || ledgerNext.next_offset !== null) throw Error('experiment pagination lost a correction');
if ((await tools.ctf_teams_status({})).ctf.hypothesis_summary.tests !== 2) throw Error('ledger status summary missing');
const observation = await tools.ctf_teams_report_finding({content:'fixture request returns 500',claim_type:'observation',challenge_id:'fixture-crypto'});
await tools.ctf_teams_verify_finding({finding_id:observation.finding_ref,method:'independent fixture request',result:'confirmed'});
const interpretation = await tools.ctf_teams_report_finding({content:'fixture parser may be broken',claim_type:'interpretation',challenge_id:'fixture-crypto',depends_on:[observation.finding_ref]});
await tools.ctf_teams_verify_finding({finding_id:interpretation.finding_ref,method:'independent fixture input check',result:'confirmed'});
const refuted = await tools.ctf_teams_verify_finding({finding_id:observation.finding_ref,method:'single-row fixture input',result:'refuted'});
const duplicateReview = await tools.ctf_teams_verify_finding({finding_id:observation.finding_ref,method:'single-row fixture input',result:'refuted'});
const evidence = await tools.ctf_teams_evidence({needs_recheck:true,limit:1});
if (!duplicateReview.duplicate || refuted.affected_total !== 1 || evidence.findings[0].finding_ref !== interpretation.finding_ref || !evidence.findings[0].recheckRequired) throw Error('finding provenance lost through Code Mode');
const searched = await tools.ctf_teams_search({action:'search',query:'square.py',source:'experiment',limit:1});
if (searched.total !== 2 || searched.next_offset !== 1) throw Error('history search lost experiment methods');
const searchedDetail = await tools.ctf_teams_search({action:'get',record_ref:searched.results[0].record_ref,content_limit:40});
if (searchedDetail.next_content_offset !== 40 || Array.from(searchedDetail.content).length !== 40) throw Error('bounded history expansion failed');
const searchableEvidence=await tools.ctf_teams_search({action:'search',query:'fixture parser may be broken',source:'finding'});
if (!searchableEvidence.results.some(row=>row.status==='needs_recheck')) throw Error('search presented invalidated evidence as confirmed');
await tools.ctf_teams_set_challenge({max_parallel_lanes:2});
const checkpointLoad = await tools.ctf_teams_checkpoint({action:'load'});
const checkpointInput = {action:'save',ledger_ref:checkpointLoad.ledger_ref,state_ref:checkpointLoad.current_state.state_ref,expected_revision:0,assessment:'Need an independent countercheck',disputes:['500 is an observation, broken parser is an explanation'],next_steps:['vary the fixture input'],evidence_files:['hypothesis-evidence.txt']};
await tools.ctf_teams_checkpoint(checkpointInput);
if (!(await tools.ctf_teams_checkpoint(checkpointInput)).duplicate) throw Error('checkpoint retry duplicated a handover');
const checkpointChecked = await tools.ctf_teams_checkpoint({action:'load',check_files:true});
if (checkpointChecked.stale || checkpointChecked.saved.facts.max_parallel_lanes !== 2 || checkpointChecked.file_checks[0].status !== 'matched') throw Error('checkpoint state/files failed');
const flag = await tools.ctf_teams_submit_flag({flag:'CTF2{EaSyRe}',evidence:'attachment bytes',source_kind:'local_output'});
if (!flag.format_warning || !flag.flag_ref) throw Error('original wrapper was not retained with a warning');
const duplicate = await tools.ctf_teams_submit_flag({flag:'CTF2{EaSyRe}'});
if (!duplicate.duplicate || duplicate.flag_ref !== flag.flag_ref) throw Error('unstable flag reference');
await tools.ctf_teams_set_challenge({flag_format:['flag\\\\{[^}]+\\\\}','CTF2\\\\{[^}]+\\\\}']});
await tools.ctf_teams_set_challenge({flag_format:null});
const verdict = await tools.ctf_teams_mark_flag({flag_id:flag.flag_ref,flag:flag.flag,team_id:solo.team_id,verdict:'verified',note:'fixture platform accepted'});
if (!verdict.solved || verdict.verified_flag !== 'CTF2{EaSyRe}') throw Error('platform verdict failed');
await tools.ctf_teams_set_challenge({multi_challenge:true,expected_challenges:2,requires_running_target_for_submit:true});
const nested = await tools.ctf_teams_submit_flag({flag:'flag{GWHT{aA01}}',challenge_id:'ch1',generate_variants:true,evidence:'nested output',source_kind:'writeup',source_url:'https://example.org/event/ch1'});
if (nested.challenge_id !== 'ch1' || !nested.source_summary.includes('example.org/event/ch1')) throw Error('candidate attribution absent from tool response');
if (nested.variants.length !== 2 || !nested.environment_warning) throw Error('variant/environment fallback failed');
await tools.ctf_teams_mark_flag({flag_id:nested.flag_ref,verdict:'rejected',note:'fixture platform rejected outer wrapper'});
const inner = await tools.ctf_teams_mark_flag({flag_id:nested.variants[0].split(' ')[0],verdict:'verified',note:'fixture platform accepted inner'});
if (inner.solved || !inner.progress.includes('1/2')) throw Error('batch converged after only one challenge');
let premature = false;
try { await tools.ctf_teams_mark_challenge_solved({note:'premature closure'}); } catch { premature = true; }
if (!premature) throw Error('incomplete batch accepted');
const second = await tools.ctf_teams_submit_flag({flag:'CTF2{EaSyRe}',challenge_id:'ch2'});
const secondVerdict = await tools.ctf_teams_mark_flag({flag_id:second.flag_ref,verdict:'verified',note:'fixture platform accepted second'});
if (secondVerdict.solved) throw Error('batch closed without explicit completion');
await tools.ctf_teams_mark_challenge_solved({note:'fixture platform accepted both distinct challenge ids'});
if (!(await tools.ctf_teams_checkpoint({action:'load'})).stale) throw Error('changed runtime failed to invalidate the saved handover');
const archived = await tools.ctf_teams_delete({});
if (!archived.archive_path || !archived.environment_notice.includes('env-ctf2')) throw Error('archive receipt failed');
const summary = await tools.ctf_teams_archive_summary({team_id:solo.team_id,archived:true});
if (!summary.summary.includes('REPORTED refutes') || !summary.summary.includes('sha256=') || !summary.summary.includes('文件原始字节') || !summary.summary.includes('platform accepted: CTF2{EaSyRe}')) throw Error('archive summary incomplete');
await tools.ctf_teams_create({name:'ctf2-handover',mode:'solo'});
await tools.ctf_teams_submit_flag({flag:'flag{pending-cold-fixture}',evidence:'synthetic unsubmitted candidate'});
const coldHandover = await tools.ctf_teams_checkpoint({action:'load'});
await tools.ctf_teams_checkpoint({action:'save',ledger_ref:coldHandover.ledger_ref,state_ref:coldHandover.current_state.state_ref,expected_revision:0,assessment:'Keep pending candidate until a real platform verdict',next_steps:['verify the actual platform response after restoring'],evidence_files:['hypothesis-evidence.txt']});
return 'CTF2_REGRESSION_PASSED';
`

const coldCode = `
const coldHistory = await tools.ctf_teams_search({action:'search',query:'handover',source:'finding'});
if (!Array.isArray(coldHistory.results)) throw Error('history tool unavailable after cold restore');
const handover = await tools.ctf_teams_checkpoint({action:'load',check_files:true});
if (handover.latest_revision !== 1 || handover.stale || handover.current_state.facts.pending_candidate_count !== 1 || handover.saved.notes.nextSteps[0] !== 'verify the actual platform response after restoring' || handover.file_checks[0].status !== 'matched') throw Error('cold checkpoint not restored');
const evidence = await tools.ctf_teams_evidence({});
if (evidence.total !== 0) throw Error('cold read manufactured a finding');
return 'CTF2_HANDOVER_RESTORED';
`
const code = coldRestore ? coldCode : warmCode

class Ctf2Adapter extends LlmAdapter {
  async listModels() { return [model] }
  async resolveModel(provider, id) { return { ...model, provider, id } }
  async *stream(options) {
    appendFileSync(process.env.LAB_TRACE, JSON.stringify({ event: 'ctf2-request', purpose: options.purpose, step, tools: options.tools?.map(tool => tool.name), messages: options.messages }) + '\n')
    if (options.purpose || step++ > 0) {
      if (!options.purpose) {
        const text = JSON.stringify(options.messages)
        assert.ok(text.includes(marker))
      }
      const text = options.purpose ? 'CTF2 test' : marker
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    const id = ToolCallId('ctf2-acceptance')
    const args = JSON.stringify({ code, description: 'Exercise CTF2 evidence and archival workflow through the real tool bridge' })
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id, name: 'run_code', argumentsDelta: args }
    yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'run_code', arguments: args } }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

export const name = 'runtime-lab-ctf2-regression'
export const inject = ['llm', 'agents', 'sessions', 'tools']
export function apply(ctx) {
  ctx.llm.registerAdapter(['runtime-lab'], new Ctf2Adapter())
  void (async () => {
    await ctx.get('loader').await()
    const cwd = process.cwd()
    mkdirSync(cwd, { recursive: true })
    if (!coldRestore) writeFileSync(join(cwd, 'hypothesis-evidence.txt'), 'fixture raw bytes: n=49\n')
    const handoverPath = join(cwd,'.ctf-teams/ctf2-handover/team.json')
    const beforeCold = coldRestore ? readFileSync(handoverPath) : undefined
    const handle = coldRestore ? await ctx.agents.resume({ resumeSessionId: process.env.LAB_PARENT_SESSION, agentOptions: { provider: 'runtime-lab', model: 'fixture-model' } }) : await ctx.agents.create({ sessionId: 'session-' + randomUUID(), meta: { cwd }, agentOptions: { provider: 'runtime-lab', model: 'fixture-model' } })
    ctx.effect(() => () => handle.dispose())
    const agent = handle.agent
    await agent.whenIdle()
    agent.ctx.tools.presentAs('ptc')
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Use CTFTeams to run the deterministic CTF2 acceptance flow.' }], source: { kind: 'user' } }))
    await new Promise(resolve => setImmediate(resolve))
    await agent.whenIdle()
    if (coldRestore) {
      assert.ok(beforeCold.equals(readFileSync(handoverPath)), 'Cold reads must not mutate the team')
      const restored=JSON.parse(readFileSync(handoverPath,'utf8'))
      assert.equal(restored.captainSessionId,agent.id)
      assert.equal(restored.flags[0].status,'candidate')
      appendFileSync(process.env.LAB_TRACE,JSON.stringify({event:'ctf2-handover-restored',sameCaptain:true,pendingCandidatePreserved:true,noTeamWrites:true})+'\n')
      await ctx.sessions.flush(agent.session)
      await handle.dispose()
      console.log(marker)
      process.exit(0)
    }
    const recovered=JSON.parse(readFileSync(join(cwd,'.ctf-teams/archive/ctf2-result-recovery/team.json'),'utf8'))
    assert.equal(recovered.tasks[0].status,'completed')
    assert.equal(recovered.tasks[0].resolution.failedOutput,'synthetic old transport failure')
    assert.equal(recovered.tasks[0].resolution.flagRef,recovered.id+'@'+recovered.boardId+'/'+recovered.flags[0].id)
    const archived = JSON.parse(readFileSync(join(cwd, '.ctf-teams/archive/ctf2-solo/team.json'), 'utf8'))
    assert.equal(archived.mode, 'solo')
    assert.equal(archived.challenge.flagFormat, null)
    assert.equal(archived.challenge.solved, true)
    assert.equal(archived.challenge.title, '中文题目')
    assert.equal(archived.challenge.environmentId, 'env-ctf2')
    assert.equal(archived.flags[0].flag, 'CTF2{EaSyRe}')
    assert.equal(archived.flags[0].verifiedFlag, 'CTF2{EaSyRe}')
    assert.equal(archived.flags[0].sources[0].kind, 'local_output')
    assert.equal(archived.findings[0].verifications[0].result, 'confirmed')
    assert.equal(archived.captainCheckpoints.length, 1)
    assert.equal(archived.captainCheckpoints[0].notes.nextSteps[0], 'vary the fixture input')
    assert.ok(archived.findings.some(finding=>finding.claimType==='interpretation'&&finding.recheckRequired))
    assert.equal(archived.challenge.maxParallelLanes, 2)
    assert.equal(archived.hypotheses[0].tests.length, 2)
    assert.equal(archived.hypotheses[0].tests[0].observation, '49 == 7**2')
    assert.equal(archived.hypotheses[0].tests[1].observation, 'actual input n=50')
    assert.equal(archived.hypotheses[0].tests[0].files[0].sha256, createHash('sha256').update(readFileSync(join(cwd, 'hypothesis-evidence.txt'))).digest('hex'))
    assert.deepEqual(archived.members, [])
    assert.deepEqual(archived.tasks, [])
    const batch = JSON.parse(readFileSync(join(cwd, '.ctf-teams/archive/ctf2-batch/team.json'), 'utf8'))
    assert.equal(batch.challenge.multiChallenge, true)
    assert.equal(batch.members[0].executionPrompt, 'Check raw bytes and preserve case')
    assert.equal(batch.tasks[0].subject, '中文附件侦察')
    appendFileSync(process.env.LAB_TRACE, JSON.stringify({ event: 'ctf2-regression-passed', captain: agent.id }) + '\n')
    await ctx.sessions.flush(agent.session)
    await handle.dispose()
    console.log('CTF2_REGRESSION_PASSED')
    process.exit(0)
  })().catch(error => { console.error(error); process.exit(1) })
}

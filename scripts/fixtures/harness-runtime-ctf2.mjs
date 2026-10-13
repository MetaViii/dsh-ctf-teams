/** Real CLI/Loader + Code Mode CTF2 acceptance. Only the LLM is scripted. */
import assert from 'node:assert/strict'
import { readFileSync, appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'

const model = { provider: 'runtime-lab', id: 'fixture-model', name: 'CTF2 acceptance fixture', context: { contextWindow: 262144 }, defaultMaxTokens: 8192 }
let step = 0
const code = `
let diagnostic = '';
try { await tools.ctf_teams_create({name:'bad-plan',plan:{members:[{name:'x',extra:'invalid'}],tasks:[{description:'中文'.repeat(1000)}]}}); }
catch (error) { diagnostic = error.message; }
if (!diagnostic.includes('Missing fields: plan.tasks[0].id, plan.tasks[0].subject') || !diagnostic.includes('Undeclared fields') || diagnostic.includes('missing required property "plan.tasks"')) throw Error('misleading plan diagnostics: '+diagnostic);
const staged = await tools.ctf_teams_create({name:'ctf2-batch',approval:'required',plan:{members:[{name:'worker',executionPrompt:'Check raw bytes and preserve case'}],tasks:[{id:'recon',subject:'中文附件侦察',assignee:'worker'}]}});
const solo = await tools.ctf_teams_create({name:'ctf2-solo',mode:'solo',replaceExisting:true});
if (!solo.archived_path || solo.mode !== 'solo') throw Error('solo replacement failed');
await tools.ctf_teams_set_challenge({title:'中文题目',remote:'http://ctf.local',environment_id:'env-ctf2',flag_format:'flag\\\\{[^}]+\\\\}'});
const finding = await tools.ctf_teams_report_finding({content:'文件原始字节: EaSyRe',evidence_kind:'raw_output',confidence:'high',evidence:'xxd attachment.bin'});
await tools.ctf_teams_verify_finding({finding_id:finding.finding_id,method:'independent byte check',result:'confirmed',note:'大小写一致'});
const flag = await tools.ctf_teams_submit_flag({flag:'CTF2{EaSyRe}',evidence:'attachment bytes'});
if (!flag.format_warning || !flag.flag_ref) throw Error('original wrapper was not retained with a warning');
const duplicate = await tools.ctf_teams_submit_flag({flag:'CTF2{EaSyRe}'});
if (!duplicate.duplicate || duplicate.flag_ref !== flag.flag_ref) throw Error('unstable flag reference');
await tools.ctf_teams_set_challenge({flag_format:['flag\\\\{[^}]+\\\\}','CTF2\\\\{[^}]+\\\\}']});
await tools.ctf_teams_set_challenge({flag_format:null});
const verdict = await tools.ctf_teams_mark_flag({flag_id:flag.flag_ref,flag:flag.flag,team_id:solo.team_id,verdict:'verified',note:'fixture platform accepted'});
if (!verdict.solved || verdict.verified_flag !== 'CTF2{EaSyRe}') throw Error('platform verdict failed');
const archived = await tools.ctf_teams_delete({});
if (!archived.archive_path || !archived.environment_notice.includes('env-ctf2')) throw Error('archive receipt failed');
const summary = await tools.ctf_teams_archive_summary({team_id:solo.team_id,archived:true});
if (!summary.summary.includes('文件原始字节') || !summary.summary.includes('platform accepted: CTF2{EaSyRe}')) throw Error('archive summary incomplete');
return 'CTF2_REGRESSION_PASSED';
`

class Ctf2Adapter extends LlmAdapter {
  async listModels() { return [model] }
  async resolveModel(provider, id) { return { ...model, provider, id } }
  async *stream(options) {
    appendFileSync(process.env.LAB_TRACE, JSON.stringify({ event: 'ctf2-request', purpose: options.purpose, step, tools: options.tools?.map(tool => tool.name), messages: options.messages }) + '\n')
    if (options.purpose || step++ > 0) {
      if (!options.purpose) {
        const text = JSON.stringify(options.messages)
        assert.match(text, /CTF2_REGRESSION_PASSED/)
      }
      const text = options.purpose ? 'CTF2 test' : 'CTF2_REGRESSION_PASSED'
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
    const handle = await ctx.agents.create({ sessionId: 'session-' + randomUUID(), meta: { cwd }, agentOptions: { provider: 'runtime-lab', model: 'fixture-model' } })
    ctx.effect(() => () => handle.dispose())
    const agent = handle.agent
    await agent.whenIdle()
    agent.ctx.tools.presentAs('ptc')
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Use CTFTeams to run the deterministic CTF2 acceptance flow.' }], source: { kind: 'user' } }))
    await new Promise(resolve => setImmediate(resolve))
    await agent.whenIdle()
    const archived = JSON.parse(readFileSync(join(cwd, '.ctf-teams/archive/ctf2-solo/team.json'), 'utf8'))
    assert.equal(archived.mode, 'solo')
    assert.equal(archived.challenge.flagFormat, null)
    assert.equal(archived.challenge.solved, true)
    assert.equal(archived.challenge.title, '中文题目')
    assert.equal(archived.challenge.environmentId, 'env-ctf2')
    assert.equal(archived.flags[0].flag, 'CTF2{EaSyRe}')
    assert.equal(archived.flags[0].verifiedFlag, 'CTF2{EaSyRe}')
    assert.equal(archived.findings[0].verifications[0].result, 'confirmed')
    assert.deepEqual(archived.members, [])
    assert.deepEqual(archived.tasks, [])
    const batch = JSON.parse(readFileSync(join(cwd, '.ctf-teams/archive/ctf2-batch/team.json'), 'utf8'))
    assert.equal(batch.members[0].executionPrompt, 'Check raw bytes and preserve case')
    assert.equal(batch.tasks[0].subject, '中文附件侦察')
    appendFileSync(process.env.LAB_TRACE, JSON.stringify({ event: 'ctf2-regression-passed', captain: agent.id }) + '\n')
    await ctx.sessions.flush(agent.session)
    await handle.dispose()
    console.log('CTF2_REGRESSION_PASSED')
    process.exit(0)
  })().catch(error => { console.error(error); process.exit(1) })
}

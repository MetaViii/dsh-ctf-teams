/** Real CTF preset, dsh-ops hooks and Windows confinement; only the model is scripted. */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'

let commands = [], requests = 0
const model = { provider: 'shell-lab', id: 'fixture', name: 'Shell fixture', context: { contextWindow: 262144 }, defaultMaxTokens: 4096 }
class Adapter extends LlmAdapter {
  async listModels() { return [model] }
  async resolveModel(provider, id) { return { ...model, provider, id } }
  async *stream(options) {
    const command = options.purpose ? undefined : commands.shift()
    if (!options.purpose) requests++
    const block = command ? { type: 'tool-call', id: ToolCallId(`shell-${requests}`), name: command.name, arguments: JSON.stringify(command.args) } : { type: 'text', text: 'Shell checks finished.' }
    yield { type: 'block-start', index: 0, blockType: block.type }
    yield command ? { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments } : { type: 'text-delta', index: 0, text: block.text }
    yield { type: 'block-end', index: 0, block }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } }
    yield { type: 'finish', reason: { kind: command ? 'tool-calls' : 'stop' } }
  }
}
export const name = 'windows-shell-lab'
export const inject = ['llm', 'agents', 'sessions', 'tools', 'agentPresets']
export function apply(ctx) {
  ctx.llm.registerAdapter(['shell-lab'], new Adapter())
  void (async () => {
    await ctx.get('loader').await()
    const workspace = process.cwd(), outside = join(dirname(workspace), 'outside-write-must-fail.txt')
    const handle = await ctx.agents.create({ sessionId: 'session-' + randomUUID(), meta: { cwd: workspace }, agentOptions: { provider: 'shell-lab', model: 'fixture' } })
    const agent = handle.agent
    await ctx.agentPresets.select(agent, 'ctf-teams')
    assert.equal(ctx.agentPresets.composedPreset(agent.ctx), 'ctf-teams')
    agent.ctx.tools.presentAs('mixed')
    const deadline = Date.now() + 10000
    while (!ctx.tools.schemas(agent).some(t => t.name === 'ops_bash')) {
      assert.ok(Date.now() < deadline, 'ops_bash never became visible to the CTF captain')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    const visible = ctx.tools.schemas(agent).map(t => t.name)
    assert.ok(visible.includes('pwsh') && visible.includes('ops_bash'))
    const psQuote = value => `'${value.replaceAll("'", "''")}'`
    const bashOutside = outside.replaceAll('\\', '/')
    const modeResults = []
    for (const mode of ['workspace-write', 'read-only', 'danger-full-access']) {
      agent.session.append('sandbox/mode', { mode })
      const ps = mode === 'workspace-write'
        ? `$ErrorActionPreference='Stop'; if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 expected' }; (Get-Acl -LiteralPath .).Owner; [IO.File]::WriteAllText('pwsh-proof.txt','PWSH7_OK'); try { [IO.File]::WriteAllText(${psQuote(outside)},'LEAKED'); 'LEAKED' } catch { 'PWSH_OUTSIDE_BLOCKED' }; 'PWSH7_OK'`
        : mode === 'read-only' ? `try { [IO.File]::WriteAllText('readonly-pwsh.txt','LEAKED'); 'LEAKED' } catch { 'PWSH_READONLY_BLOCKED' }` : `'PWSH_FULL_OK'`
      const bash = mode === 'workspace-write'
        ? `printf BASH_OK > bash-proof.txt; if printf LEAKED > '${bashOutside}'; then printf LEAKED; else printf BASH_OUTSIDE_BLOCKED; fi; printf BASH_OK`
        : mode === 'read-only' ? 'if printf LEAKED > readonly-bash.txt; then printf LEAKED; else printf BASH_READONLY_BLOCKED; fi' : 'printf BASH_FULL_OK'
      const start = agent.session.ownEvents().length
      commands = [{ name: 'pwsh', args: { command: ps, description: `Verify PowerShell under ${mode}` } }, { name: 'ops_bash', args: { command: bash, timeoutMs: 20000, description: `Verify Bash under ${mode}` } }]
      agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `Run the authorized local shell fixture in ${mode}.` }] }))
      await agent.whenIdle()
      assert.equal(commands.length, 0)
      const results = agent.session.ownEvents().slice(start).filter(e => e.type === 'tool/result')
      assert.equal(results.length, 2)
      const text = results.map(e => JSON.stringify(e.data.message)).join('\n')
      assert.ok(!text.includes('workspace preparation failed'), text)
      assert.ok(!text.includes('EXECUTOR_UNAVAILABLE'), text)
      assert.ok(!text.includes('LEAKED'), text)
      const markers = mode === 'workspace-write' ? ['PWSH7_OK', 'BASH_OK', 'PWSH_OUTSIDE_BLOCKED', 'BASH_OUTSIDE_BLOCKED'] : mode === 'read-only' ? ['PWSH_READONLY_BLOCKED', 'BASH_READONLY_BLOCKED'] : ['PWSH_FULL_OK', 'BASH_FULL_OK']
      for (const marker of markers) assert.ok(text.includes(marker), `Missing ${marker}: ${text}`)
      assert.equal(existsSync(outside), false)
      assert.equal(existsSync(join(workspace, 'readonly-pwsh.txt')), false)
      assert.equal(existsSync(join(workspace, 'readonly-bash.txt')), false)
      modeResults.push({ mode, markers, passed: true })
    }
    assert.equal(readFileSync(join(workspace, 'pwsh-proof.txt'), 'utf8'), 'PWSH7_OK')
    assert.equal(readFileSync(join(workspace, 'bash-proof.txt'), 'utf8'), 'BASH_OK')
    writeFileSync(process.env.SHELL_LAB_RESULT, JSON.stringify({ passed: true, preset: 'ctf-teams', requests, tools: ['pwsh', 'ops_bash'], modes: modeResults }, null, 2))
    await ctx.sessions.flush(agent.session)
    await handle.dispose()
    console.log('WINDOWS_SHELL_OK')
    ctx.get('appExit')(0)
  })().catch(error => { console.error(error.stack ?? error); ctx.get('appExit')(1) })
}

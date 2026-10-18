import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { Ctf2ProtocolError, parseRpcResponse, unwrapToolResult, filterUnsolved } from '../lib/ctf2-protocol.js'
import { textCandidates } from '../lib/text-candidates.js'
import { detectTools, planInstall, runInstallPlan, TOOL_SPECS } from '../lib/env.js'
import { describeQualityLoop, canDeclareDelivery } from '../lib/quality-gates.js'

test('RPC/MCP rejects null, tool errors, invalid JSON and unrelated SSE notifications', () => {
  for (const result of [null, { content: [{ type: 'text', text: 'null' }], isError: false }, { structuredContent: null }, { content: [] }]) {
    assert.throws(() => unwrapToolResult(result), Ctf2ProtocolError)
  }
  assert.throws(() => unwrapToolResult({ isError: true, content: [{ type: 'text', text: 'unknown tool' }] }), error => error.exitCode === 1)
  assert.throws(() => parseRpcResponse('{"id":1,"result":null}', 1), /null/)
  assert.throws(() => parseRpcResponse('{"id":2,"result":{}}', 1), /matching/)
  assert.throws(() => parseRpcResponse('broken', 1), /Malformed/)
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"progress"}\n\nevent: message\ndata: {"id":1,\ndata: "result":{"structuredContent":{"ok":true}}}\n\n'
  assert.deepEqual(unwrapToolResult(parseRpcResponse(sse, 1)), { ok: true })
})

test('explicit unsolved filter keeps only actual false statuses and preserves server totals', () => {
  const source = { total: 400, data: { challenges: [{ id: 'a', is_solved: false }, { id: 'b', is_solved: true }, { id: 'c' }, { id: 'd', challenge: { is_solved: false } }] } }
  const filtered = filterUnsolved(source)
  assert.deepEqual(filtered.payload.data.challenges.map(item => item.id), ['a', 'd'])
  assert.equal(filtered.unknown, 1)
  assert.equal(filtered.payload.total, 400)
  assert.equal(source.data.challenges.length, 4)
  assert.deepEqual(filterUnsolved([]).payload, [])
  assert.throws(() => filterUnsolved({ count: 2 }), /response shape/)
})

test('OCR candidates are finite, original first, distance ordered and binary-safe', () => {
  const all = textCandidates({ text: '01S@', max_candidates: 128 })
  assert.equal(all.candidates[0].text, '01S@')
  assert.equal(all.total_variants, '24')
  assert.equal(all.candidates.length, 24)
  assert.equal(all.truncated, false)
  assert.equal(new Set(all.candidates.map(item => item.text)).size, 24)
  assert.deepEqual(all.candidates.map(item => item.substitutions), all.candidates.map(item => item.substitutions).sort((a,b) => a-b))
  const bounded = textCandidates({ text: '1'.repeat(512), max_candidates: 7 })
  assert.equal(bounded.candidates.length, 7)
  assert.equal(bounded.truncated, true)
  const decoded = textCandidates({ text: '/wBB', decode_base64: true }).candidates[0].base64
  assert.deepEqual(decoded, { valid: true, hex: 'ff0041', ascii: '\\xff\\x00A', bytes: 3, preview_truncated: false })
  assert.equal(textCandidates({ text: 'Zh==', decode_base64: true }).candidates[0].base64.valid, false, 'reject noncanonical trailing bits')
  assert.equal(textCandidates({ text: 'YWJj', decode_base64: true, preview_bytes: 1 }).candidates[0].base64.preview_truncated, true)
  assert.throws(() => textCandidates({ text: 'x', max_candidates: 129 }), /1 to 128/)
})

test('crypto probes run operations after import; successful pip exit cannot hide a broken backend', async () => {
  const calls = []
  const runner = async argv => {
    calls.push(argv)
    return argv.at(-1).startsWith('from Crypto.Cipher')
      ? { code: 1, stdout: '', stderr: "KeyError: const uint8_t*" }
      : { code: 0, stdout: 'version', stderr: '' }
  }
  const [crypto] = await detectTools({ tools: ['pycryptodome'], runner, python: 'isolated-python' })
  assert.equal(crypto.status, 'broken')
  assert.match(crypto.installHint, /operation self-test failed/)
  assert.equal(calls.length, 2, 'root import alone is insufficient')
  assert.equal(calls.every(argv => argv[0] === 'isolated-python'), true)
  const { steps } = planInstall(['pycryptodome', 'pycryptodomex'], TOOL_SPECS, 'win32', { python: 'isolated-python' })
  assert.equal(steps[1].manager, 'manual', 'legacy namespace is an independent optional probe, never a blanket install')
  const outcomes = await runInstallPlan(steps, { runner, python: 'isolated-python' })
  assert.equal(outcomes[0].ok, false)
  assert.match(outcomes[0].detail, /verification is broken/)
})

test('empty captain-planned graph is planning, solo is direct work, neither bypasses delivery gates', () => {
  const team = { id: 't', name: 't', createdAt: 1, captainSessionId: 'cap', members: [], tasks: [], taskSeq: 0 }
  assert.equal(describeQualityLoop(team).state, 'planning')
  assert.equal(describeQualityLoop({ ...team, mode: 'solo' }).state, 'running')
  assert.equal(describeQualityLoop({ ...team, halted: true }).state, 'halted')
  assert.equal(canDeclareDelivery(team).ok, false)
})

test('real CLI forwards every pair, filters solved entries, and exits nonzero without retrying failed mutations', async t => {
  const requests = []
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    const request = JSON.parse(body); requests.push(request)
    const name = request.params.name
    const result = name === 'unknown' || name === 'ctf2_submit_flag' ? { isError: false, content: [{ type: 'text', text: 'null' }] }
      : name === 'error' ? { isError: true, content: [{ type: 'text', text: 'failed' }] }
      : { structuredContent: { total: 50, challenges: [{ id: 'todo', is_solved: false }, { id: 'done', is_solved: true }, { id: 'unknown' }] } }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }))
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/ctf2-cli.mjs', ...args], { env: { ...process.env, CTF2_PROXY: `http://127.0.0.1:${server.address().port}/mcp` }, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', data => stdout += data); child.stderr.on('data', data => stderr += data)
    child.on('error', reject); child.on('exit', code => resolve({ code, stdout, stderr }))
  })
  const next = await run(['next', 'category=CRYPTO', 'unsolved_only=true', 'limit=9'])
  assert.equal(next.code, 0)
  assert.deepEqual(requests[0].params.arguments, { category: 'CRYPTO', unsolved_only: true, limit: 9 })
  assert.deepEqual(JSON.parse(next.stdout).challenges.map(item => item.id), ['todo'])
  assert.match(next.stderr, /unknown status omitted/)
  await run(['call', 'other', 'one=1', 'two=true'])
  assert.deepEqual(requests[1].params.arguments, { one: 1, two: true })
  for (const [args, code] of [[['call', 'unknown'], 2], [['call', 'error'], 1], [['submit', 'ch', 'flag{X}', 'ground'], 2]]) {
    const result = await run(args)
    assert.equal(result.code, code)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /ctf2 error:/)
  }
  assert.equal(requests.filter(request => request.params.name === 'ctf2_submit_flag').length, 1)
  const scan = await run(['scan-unsolved', 'practice_ground_id=g', 'category=CRYPTO', 'max_pages=1', 'limit=5'])
  assert.equal(scan.code, 2, 'unknown status produces an explicit partial scan')
  assert.equal(JSON.parse(scan.stdout).items[0].id, 'todo')
  assert.match(scan.stderr, /partial/)
  assert.deepEqual(requests.at(-1).params.arguments, {practice_ground_id:'g',category:'CRYPTO',limit:5,unsolved_only:false,page:1})
})

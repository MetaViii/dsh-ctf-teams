import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectRuntimeTools } from '../lib/env-runtime.js'
import { decodeCommandOutput, defaultCommandRunner, TOOL_SPECS, detectTools } from '../lib/env.js'

const ok = stdout => ({ code: 0, stdout, stderr: '' })

test('WSL discovery does not boot an implicit distribution and preserves Unicode names', async () => {
  const text = 'kali-linux\r\n取证 Linux\r\n'
  assert.equal(decodeCommandOutput(['wsl.exe'], Buffer.from(text, 'utf16le')), text)
  assert.equal(decodeCommandOutput(['wsl.exe'], Buffer.from(text, 'utf8')), text)
  const calls = []
  const report = await detectRuntimeTools({ runtime: 'wsl', hostPlatform: 'win32', runner: async argv => { calls.push(argv); return ok(text) } })
  assert.deepEqual(calls, [['wsl.exe', '--list', '--quiet']])
  assert.deepEqual(report.available_distributions, ['kali-linux', '取证 Linux'])
  assert.equal(report.runtime_ready, false)
  assert.deepEqual(report.statuses, [])
  assert.match(report.error, /explicit distribution/)
})

test('WSL uses Linux platform and interpreter, argv boundaries, and operation self-tests', async () => {
  const calls = []
  const runner = async argv => {
    calls.push(argv)
    if (argv[1] === '--list') return ok('kali-linux\n')
    assert.deepEqual(argv.slice(0, 7), ['wsl.exe', '--distribution', 'kali-linux', '--exec', '/usr/bin/env', 'LC_ALL=C', 'TERM=dumb'])
    assert.ok(argv[7].startsWith('PATH=')); assert.ok(!argv[7].includes('/mnt/'))
    const command = argv.slice(8)
    if (command[0] === 'uname') return ok('Linux\n')
    if (command[0] === '/usr/bin/printenv') return ok('/home/ctf\n')
    if (command[0] === 'which') return ok('/usr/bin/' + command[1] + '\n')
    if (command[1] === '--version') return ok('Python 3.12.0')
    if (command[0] === 'strace') return ok('strace -- version 6.0')
    if (command[2]?.includes('AES.new')) return { code: 1, stdout: '', stderr: 'broken backend' }
    return ok('')
  }
  const report = await detectRuntimeTools({ runtime: 'wsl', distribution: 'kali-linux', hostPlatform: 'win32', python: 'E:\\conda\\python.exe', tools: ['python3', 'strace', 'pycryptodome', 'typo-tool'], runner })
  assert.equal(report.runtime_ready, true)
  assert.equal(report.probe_platform, 'linux')
  assert.equal(report.python, 'python3')
  assert.match(report.search_path, /^\/home\/ctf\/\.local\/bin:/)
  assert.equal(report.statuses.find(row => row.name === 'python3').path, '/usr/bin/python3')
  assert.equal(report.statuses.find(row => row.name === 'strace').status, 'ok')
  assert.equal(report.statuses.find(row => row.name === 'pycryptodome').status, 'broken')
  assert.deepEqual(report.unknown, ['typo-tool'])
  assert.ok(!JSON.stringify(calls).includes('conda'))
  assert.ok(!calls.some(argv => argv.includes('sh') || argv.includes('apt-get')))
})

test('WSL startup and discovery failures never masquerade as missing tools', async () => {
  for (const phase of ['discovery', 'startup']) {
    const report = await detectRuntimeTools({ runtime: 'wsl', distribution: 'kali-linux', tools: ['sage'], hostPlatform: 'win32', runner: async argv => phase === 'startup' && argv[1] === '--list' ? ok('kali-linux\n') : ({code: -1, stdout: '', stderr: '', error: 'timed out'}) })
    assert.equal(report.runtime_ready, false)
    assert.deepEqual(report.statuses, [])
    assert.match(report.error, /timed out/)
  }
  for (const distribution of ['--exec', 'unknown', 'kali-linux\nsh', '../kali-linux']) {
    let calls = 0
    const report = await detectRuntimeTools({ runtime: 'wsl', distribution, hostPlatform: 'win32', runner: async () => { calls++; return ok('kali-linux\n') } })
    assert.equal(calls, 1); assert.equal(report.runtime_ready, false)
  }
  assert.equal((await detectRuntimeTools({runtime: 'wsl',hostPlatform: 'linux',runner(){throw Error('must not execute')}})).runtime_ready, false)
  await assert.rejects(detectRuntimeTools({distribution: 'kali-linux'}), /requires runtime=wsl/)
})

test('concurrent WSL checks serialize launchers across lanes and keep catalog order', async () => {
  let running = 0, peak = 0
  const names = TOOL_SPECS.filter(row => row.probe?.kind === 'binary').slice(0, 9).map(row => row.name)
  const options = { runtime: 'wsl', distribution: 'kali-linux', hostPlatform: 'win32', tools: names, runner: async argv => {
    if (argv[1] === '--list') return ok('kali-linux\n')
    if (argv.includes('uname')) return ok('Linux\n')
    if (argv.includes('/usr/bin/printenv')) return ok('/home/ctf\n')
    running++; peak = Math.max(peak, running)
    await new Promise(resolve => setTimeout(resolve, 5)); running--
    return ok(argv.includes('which') ? '/usr/bin/tool\n' : '1.0')
  } }
  const reports = await Promise.all([detectRuntimeTools(options), detectRuntimeTools(options)])
  assert.equal(peak, 1)
  for (const report of reports) assert.deepEqual(report.statuses.map(row => row.name), names)
})

test('probe transport failures and missing interpreter never become missing-library/install claims', async () => {
  const names = ['python3','pycryptodome','strace']
  for(const result of [{code: -1,stdout: '',stderr: '',error: 'timed out'},{code: 127,stdout: '',stderr: 'command unavailable'}]){
    const statuses = await detectTools({tools: names,platform: 'linux',runner: async()=>result})
    assert.equal(statuses.length, 3)
    for(const row of statuses){assert.equal(row.status,'unknown');assert.match(row.installHint,/unknown/)}
  }
})

test('native runner retains split UTF-8 output and bounds command time', async () => {
  const result = await defaultCommandRunner([process.execPath, '-e', 'process.stdout.write(Buffer.from([0xe4]));setTimeout(()=>process.stdout.write(Buffer.from([0xb8,0xad])),10)'], 2000)
  assert.equal(result.stdout, '中')
  const timeout = await defaultCommandRunner([process.execPath, '-e', 'setTimeout(()=>{},10000)'], 40)
  assert.equal(timeout.code, -1); assert.match(timeout.error, /timed out/)
})

async function cli(args, proxy) {
  const child = spawn(process.execPath, [process.env.CTF_TEAMS_TEST_CLI_ENTRY ?? 'scripts/ctf2-cli.mjs', ...args], { windowsHide: true, env: {...process.env, CTF2_PROXY: proxy}, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = ''
  child.stdout.on('data', part => stdout += part); child.stderr.on('data', part => stderr += part)
  const timer = setTimeout(() => child.kill(), 10_000)
  try { const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve) }); return { code, stdout, stderr } } finally { clearTimeout(timer) }
}

test('CLI atomic cache preserves old bytes on protocol/business/partial/write failures', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'ctf-cache-中文-')), target = join(folder, '题库 快照.json')
  t.after(() => rm(folder, {recursive: true, force: true}))
  const previous = Buffer.from('\ufeff{ "source": "原始缓存" }\r\n', 'utf8')
  let mode = 'ok', requests = 0
  const payload = {id: '0012', title: '中文题目🚩', source: '大小写不变'}
  const server = createServer(async (req, res) => {
    requests++; let input = ''; for await (const part of req) input += part
    const rpc = JSON.parse(input)
    res.setHeader('content-type', 'application/json')
    if (mode === 'http') { res.writeHead(503); res.end('unavailable'); return }
    if (mode === 'malformed') { res.end('{'); return }
    const value = mode === 'rate' || mode === 'rate-alias' ? {code: mode === 'rate' ? 'RATE_LIMITED' : 'RATE_LIMIT_EXCEEDED',message: 'slow down',retry_after_ms: 1000}
      : mode === 'partial' ? {items: [{id: '0012',is_solved: false}],total_pages: 2} : payload
    res.end(JSON.stringify({jsonrpc: '2.0',id: mode === 'wrong-id' ? -99 : rpc.id,result: {structuredContent: value}}))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const proxy = `http://127.0.0.1:${server.address().port}/mcp`
  for (const failure of ['rate', 'rate-alias', 'wrong-id', 'http', 'malformed', 'partial']) {
    mode = failure; await writeFile(target, previous)
    const args = mode === 'partial' ? ['scan-unsolved','practice_ground_id=g','max_pages=1'] : ['get','0012','g']
    const result = await cli([...args, '--output', target], proxy)
    assert.notEqual(result.code, 0, failure); assert.equal(result.stdout, '', failure)
    assert.deepEqual(await readFile(target), previous, failure)
    assert.deepEqual(await readdir(folder), ['题库 快照.json'])
  }
  mode = 'ok'
  const before = requests
  const unsupported = await cli(['submit', '0012', 'flag{example}', 'g', '--output', target], proxy)
  assert.notEqual(unsupported.code, 0); assert.equal(requests, before)
  const noParent = await cli(['get','0012','g','--output',join(folder,'missing','data.json')], proxy)
  assert.notEqual(noParent.code, 0); assert.deepEqual(await readFile(target), previous)
  const directory = join(folder,'directory'); await mkdir(directory)
  const blocked = await cli(['get','0012','g','--output',directory], proxy)
  assert.notEqual(blocked.code, 0); assert.ok(!(await readdir(folder)).some(name => name.endsWith('.tmp')))
  const success = await cli(['--output', target, 'get', '0012', 'g'], proxy)
  assert.equal(success.code, 0, success.stderr); assert.equal(success.stdout, '')
  const bytes = await readFile(target)
  assert.equal(bytes.subarray(0,3).equals(Buffer.from([0xef,0xbb,0xbf])),false)
  assert.deepEqual(JSON.parse(bytes.toString('utf8')), payload)
  assert.match(success.stderr, /UTF-8 bytes/)
})

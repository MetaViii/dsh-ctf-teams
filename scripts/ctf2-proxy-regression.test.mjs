import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installProxySupervisor } from '../lib/platform.js'

async function freePort() {
  const server = createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  return port
}
async function eventually(check) {
  for (let n = 0; n < 100; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 50)) }
  assert.fail('proxy lifecycle did not settle within 5 seconds')
}
async function health(port) {
  try { return await (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(300) })).json() } catch { return undefined }
}

test('proxy serves health with missing OAuth, preserves RPC id and CLI diagnoses an absent listener', async t => {
  const credentials = await mkdtemp(join(tmpdir(), 'ctf-proxy-empty-'))
  const port = await freePort()
  const child = spawn(process.execPath, ['scripts/ctf2-mcp-proxy.mjs', '--port', String(port)], { cwd: resolve('.'), env: { ...process.env, CTF2_OAUTH_DIR: credentials }, stdio: 'ignore', windowsHide: true })
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const done = new Promise(resolve => child.once('exit', resolve)); child.kill(); await done } await rm(credentials, { recursive: true, force: true }) })
  await eventually(async () => (await health(port))?.service === 'ctf2-mcp-proxy')
  assert.equal((await health(port)).oauth_configured, false)
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 'trace-123', method: 'tools/list' }) })
  const result = await response.json()
  assert.equal(response.status, 502); assert.equal(result.id, 'trace-123')
  assert.match(result.error.message, /not a challenge verdict/)
  const closed = new Promise(resolve => child.once('exit', resolve)); child.kill(); await closed
  const cli = spawn(process.execPath, ['scripts/ctf2-cli.mjs', 'whoami'], { env: { ...process.env, CTF2_PROXY: `http://127.0.0.1:${port}/mcp` }, windowsHide: true })
  let output = ''; cli.stderr.on('data', data => output += data)
  await new Promise(resolve => cli.once('exit', resolve))
  assert.equal(cli.exitCode, 1); assert.match(output, /local MCP proxy unreachable/)
})

test('host supervisor leaves an external proxy alive; owned listener is disposed with the host only', async t => {
  const credentials = await mkdtemp(join(tmpdir(), 'ctf-supervisor-'))
  t.after(() => rm(credentials, { recursive: true, force: true }))
  const external = createServer((req, res) => res.end(JSON.stringify({ service: 'ctf2-mcp-proxy' })))
  await new Promise(resolve => external.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => external.close(resolve)))
  let dispose
  const ctx = { effect(setup) { dispose = setup() }, logger: { warn() {} } }
  installProxySupervisor(ctx, { manageProxy: true, proxyUrl: `http://127.0.0.1:${external.address().port}/mcp`, credentialDir: credentials })
  await new Promise(resolve => setTimeout(resolve, 100)); dispose()
  assert.equal((await health(external.address().port)).service, 'ctf2-mcp-proxy')
  const ownedPort = await freePort()
  installProxySupervisor(ctx, { manageProxy: true, proxyUrl: `http://127.0.0.1:${ownedPort}/mcp`, credentialDir: credentials, maxRestarts: 1, restartDelayMs: 50 })
  const cleanup = dispose
  t.after(cleanup)
  await eventually(async () => (await health(ownedPort))?.service === 'ctf2-mcp-proxy')
  cleanup()
  await eventually(async () => !(await health(ownedPort)))
})

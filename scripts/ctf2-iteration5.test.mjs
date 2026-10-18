import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { unwrapToolResult } from '../lib/ctf2-protocol.js'
import { proxyHealth } from '../lib/platform.js'
import { normalizeToolResult } from '../lib/ctf2-protocol.js'
import { ctfTeamsSource } from '../lib/harness-compat.js'
import { memberRouteDiagnostics } from '../lib/model-routes.js'
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

test('source compatibility uses the released wrapper before session format 3', () => {
  for (const modern of [{kind:'ctf-teams'}, {kind:'ctf-teams-command', goal:'solve', profile:'ctf'}]) {
    for (const version of [0, 1, 2, NaN, -1]) assert.deepEqual(ctfTeamsSource(modern, version), {kind:'plugin',plugin:'@nanmicoder/dsh-ctf-teams'})
    for (const version of [3, 4]) assert.deepEqual(ctfTeamsSource(modern, version), modern)
  }
})

test('route diagnostics distinguish live/saved/captain routes and never wake agents', () => {
  const route = (provider, model, reasoningEffort) => ({session:{requestHeader:()=>({config:{provider,model,reasoningEffort}})}, followup(){throw Error('must not wake')}, steer(){throw Error('must not steer')}})
  const registry = new Map([['cap',route('new','k3','high')],['worker',route('old','flash','low')]])
  const ctx = {agents:{get:id=>registry.get(id)}}
  const team = {captainSessionId:'cap'}, member = {id:'worker',provider:'old',model:'flash',reasoningEffort:'low'}
  const first = memberRouteDiagnostics(ctx, team, member)
  assert.equal(first.differs_from_captain, true); assert.equal(first.live_differs_from_saved, false)
  assert.equal(first.live_route.model, 'flash'); assert.equal(first.captain_route.model, 'k3')
  registry.set('worker',route('other','changed','low'))
  assert.equal(memberRouteDiagnostics(ctx,team,member).live_differs_from_saved,true)
  registry.delete('worker')
  const cold = memberRouteDiagnostics(ctx,team,member)
  assert.equal(Object.hasOwn(cold,'live_route'),false); assert.equal(Object.hasOwn(cold,'live_differs_from_saved'),false)
  assert.match(cold.notice,/unavailable/)
  const historic = memberRouteDiagnostics(ctx,team,member,true)
  assert.equal(Object.hasOwn(historic,'captain_route'),false)
  registry.set('worker',{session:{requestHeader(){throw Error('unreadable live header')}}})
  assert.equal(Object.hasOwn(memberRouteDiagnostics(ctx,team,member),'live_route'),false)
})

test('normalization preserves error payload/retry metadata and leaves successful objects untouched', () => {
  const payload = {code:'RATE_LIMITED', message:'slow down', retry_after_ms:2500, retryable:true}
  const original = {structuredContent:payload, content:[{type:'text',text:JSON.stringify(payload)}], _meta:{trace:'keep'}}
  const normalized = normalizeToolResult(original)
  assert.equal(normalized.isError,true); assert.equal(normalized.structuredContent,payload)
  assert.equal(original.isError,undefined); assert.deepEqual(normalized._meta,{trace:'keep'})
  const good = {structuredContent:{id:'ch',attachments:[]}}
  assert.equal(normalizeToolResult(good),good)
})

test('business failures in structured or text payloads never become successful challenge data', () => {
  for (const code of ['RATE_LIMITED', 'ENVIRONMENT_NOT_FOUND', 'CHALLENGE_NOT_FOUND', 'UNAUTHORIZED']) {
    const failure = { code, message: 'platform refused the operation', retryable: true, retry_after_ms: 2500 }
    for (const result of [{ structuredContent: failure }, { content: [{ type: 'text', text: JSON.stringify(failure) }] }]) {
      assert.throws(() => unwrapToolResult(result), error => error.exitCode === 1 && error.message.includes(code) && error.message.includes('2500'))
    }
  }
  assert.throws(() => unwrapToolResult({ structuredContent: { success: false, message: 'explicit failure' } }), /explicit failure/)
  const challenge = { code: 'print("solve")', items: [{ code: 'RATE_LIMITED', title: 'A challenge about rate limiting' }] }
  assert.deepEqual(unwrapToolResult({ structuredContent: challenge }), challenge)
  assert.deepEqual(unwrapToolResult({ structuredContent: { code: 'RATE_LIMITED', title: 'Challenge source', is_solved: false } }), { code: 'RATE_LIMITED', title: 'Challenge source', is_solved: false })
})

test('legacy proxies without /health are identified by a valid read-only tools/list response', async t => {
  const requests = []
  const server = createServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`)
    if (req.url === '/health') { res.writeHead(405); res.end('Method not allowed'); return }
    let body = ''; for await (const part of req) body += part
    const rpc = JSON.parse(body)
    assert.equal(rpc.method, 'tools/list')
    res.setHeader('content-type', 'text/event-stream')
    res.end(`data: ${JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { tools: [{ name: 'ctf2_agent_whoami', inputSchema: { type: 'object' } }] } })}\n\n`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const health = await proxyHealth({ proxyUrl: `http://127.0.0.1:${server.address().port}/mcp` })
  assert.equal(health.up, true)
  assert.equal(health.probe, 'tools/list')
  assert.equal(health.http_status, 200)
  assert.match(health.url, /\/mcp$/)
  assert.deepEqual(requests, ['GET /health', 'POST /mcp'])
})

test('an HTTP 200 unrelated service is not a working CTF2 MCP proxy', async t => {
  const server = createServer((_req, res) => { res.end('{"ok":true}') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const health = await proxyHealth({ proxyUrl: `http://127.0.0.1:${server.address().port}/mcp` })
  assert.equal(health.up, false)
  assert.equal(health.probe, 'tools/list')
  assert.match(health.state, /unrecognized|matching|MCP/)
})

test('the shipped proxy marks JSON and multiline SSE business errors; CLI never prints them as successful cache data', async t => {
  const lab = await mkdtemp(join(tmpdir(), 'ctf-proxy-business-'))
  t.after(() => rm(lab, {recursive:true, force:true}))
  await writeFile(join(lab,'oauth-token.json'), JSON.stringify({access_token:'fake-test-only',refresh_token:'fake-test-only',expires_at:new Date(Date.now()+3600000).toISOString()}))
  await writeFile(join(lab,'oauth-client.json'), '{}')
  const fixture = join(lab,'fake-upstream.mjs')
  await writeFile(fixture, `globalThis.fetch=async(url,init)=>{
    if(String(url)!=='https://ctf2.dasctf.com/api/ai/v1/mcp')throw Error('unexpected network request');
    const rpc=JSON.parse(init.body), payload={code:'RATE_LIMITED',message:'slow down',retryable:true,retry_after_ms:2500};
    const result={jsonrpc:'2.0',id:rpc.id,result:{structuredContent:payload,content:[{type:'text',text:JSON.stringify(payload)}]}};
    return rpc.params.arguments?.sse ? new Response('event: message\\nid: keep-id\\ndata: '+JSON.stringify(result,null,2).split('\\n').join('\\ndata: ')+'\\n\\n',{headers:{'content-type':'text/event-stream'}}) : new Response(JSON.stringify(result),{headers:{'content-type':'application/json'}});
  }`)
  const listener = createServer(); await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve))
  const port = listener.address().port; await new Promise(resolve=>listener.close(resolve))
  const child = spawn(process.execPath,['--import',pathToFileURL(fixture).href,'scripts/ctf2-mcp-proxy.mjs','--port',String(port)],{env:{...process.env,CTF2_OAUTH_DIR:lab},windowsHide:true,stdio:'ignore'})
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){const done=new Promise(resolve=>child.once('exit',resolve));child.kill();await done}})
  const url=`http://127.0.0.1:${port}/mcp`
  let ready=false
  for(let n=0;n<100;n++){try{ready=(await fetch(`http://127.0.0.1:${port}/health`)).ok}catch{} if(ready)break;await new Promise(resolve=>setTimeout(resolve,50))}
  assert.equal(ready,true)
  for(const sse of [false,true]) {
    const response=await fetch(url,{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:'roundtrip',method:'tools/call',params:{name:'ctf2_get_practice_challenge',arguments:{sse}}})})
    const body=await response.text()
    const {parseRpcResponse}=await import('../lib/ctf2-protocol.js')
    const result=parseRpcResponse(body,'roundtrip')
    assert.equal(result.isError,true);assert.equal(result.structuredContent.retry_after_ms,2500)
    if(sse){assert.match(body,/event: message/);assert.match(body,/id: keep-id/)}
  }
  const cli=spawn(process.execPath,['scripts/ctf2-cli.mjs','call','ctf2_submit_flag','flag=flag{test}'],{env:{...process.env,CTF2_PROXY:url},windowsHide:true,stdio:['ignore','pipe','pipe']})
  let stdout='',stderr='';cli.stdout.on('data',data=>stdout+=data);cli.stderr.on('data',data=>stderr+=data)
  const code=await new Promise((resolve,reject)=>{cli.on('error',reject);cli.on('exit',resolve)})
  assert.equal(code,1);assert.equal(stdout,'');assert.match(stderr,/RATE_LIMITED/);assert.match(stderr,/2500/)
})

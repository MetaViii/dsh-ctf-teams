import test from 'node:test'
import assert from 'node:assert/strict'
import { zstdCompressSync } from 'node:zlib'
import { readSessionRecords, summarizeSession } from './session-runtime-diagnose.mjs'

test('reads every independently compressed host frame, including later runtime failures', () => {
  const records = [{type:'header'}, {type:'tool/call',data:{callId:'1',name:'get_goal',arguments:'SECRET'}}, {type:'tool/result',seq:3,time:1,data:{message:{toolCallId:'1',isError:true,content:[{type:'text',text:'cannot get required service "sessionProjections" in inactive context'}]}}}]
  const encoded = Buffer.concat(records.map(record=>zstdCompressSync(Buffer.from(JSON.stringify(record)+'\n'))))
  assert.deepEqual(readSessionRecords(encoded),records)
  const report=summarizeSession(readSessionRecords(encoded))
  assert.equal(report.runtimeFailures,1);assert.deepEqual(report.affectedTools,['get_goal']);assert.equal(JSON.stringify(report).includes('SECRET'),false)
})

test('does not count assistant diagnosis or quoted user instructions as observed tool failures', () => {
  const report=summarizeSession([{type:'assistant/message',data:{text:'cannot get required service "sessionProjections" in inactive context'}},{type:'tool/result',data:{message:{isError:false,content:[{type:'text',text:'cannot get required service "sessionProjections" in inactive context'}]}}}])
  assert.equal(report.runtimeFailures,0)
})

test('recognizes missing permissions without mistaking normal sandbox denials for a runtime outage', () => {
  const result=text=>({type:'tool/result',data:{message:{isError:true,content:[{type:'text',text}]}}})
  assert.equal(summarizeSession([result('workspace write denied')]).runtimeFailures,0)
  assert.equal(summarizeSession([result('permission: permissions session projection is not registered')]).runtimeFailures,1)
})

test('refuses truncated or malformed data without modifying session files', () => {
  const encoded=zstdCompressSync(Buffer.from('{"type":"header"}\n'))
  assert.throws(()=>readSessionRecords(encoded.subarray(0,encoded.length-1)),/Incomplete/)
  assert.throws(()=>readSessionRecords(Buffer.from('not a log')),/magic/)
  assert.throws(()=>readSessionRecords(Buffer.from('invalid JSON\n'),false),/JSON/)
})

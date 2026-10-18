#!/usr/bin/env node
/** Read-only session diagnosis. Never prints prompts, tool arguments, credentials or flag values. */
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The host appends independent Zstd frames; one-shot decompression reads only the first. */
export function readSessionRecords(bytes, compressed = true) {
  if (!compressed) return bytes.toString('utf8').split('\n').filter(Boolean).map(JSON.parse)
  const chunks = []
  let offset = 0
  const requireBytes = count => { if (offset + count > bytes.length) throw Error('Incomplete Zstd frame; snapshot the closed session and retry. No repair was performed.') }
  while (offset < bytes.length) {
    const start = offset
    requireBytes(5)
    if (bytes.readUInt32LE(offset) !== 0xfd2fb528) throw Error('Invalid Zstd session frame magic')
    const descriptor = bytes[offset + 4]; offset += 5
    if (descriptor & 0x18) throw Error('Reserved Zstd frame-header bits')
    const flag = descriptor >>> 6, single = Boolean(descriptor & 0x20), dictionary = descriptor & 3
    const headerSize = (single ? 0 : 1) + (dictionary === 3 ? 4 : dictionary) + (flag === 0 ? single ? 1 : 0 : 1 << flag)
    requireBytes(headerSize); offset += headerSize
    while (true) {
      requireBytes(3)
      const block = bytes.readUIntLE(offset, 3); offset += 3
      const type = block >>> 1 & 3
      if (type === 3) throw Error('Reserved Zstd block type')
      const size = type === 1 ? 1 : block >>> 3
      requireBytes(size); offset += size
      if (block & 1) break
    }
    if (descriptor & 4) { requireBytes(4); offset += 4 }
    chunks.push(zstdDecompressSync(bytes.subarray(start, offset)))
  }
  return readSessionRecords(Buffer.concat(chunks), false)
}

export function summarizeSession(records) {
  const calls = new Map()
  const failures = []
  let results = 0
  for (const record of records) {
    if (record.type === 'tool/call') calls.set(record.data.callId, record.data.name)
    if (record.type !== 'tool/result') continue
    results++
    const message = record.data.message
    if (!message?.isError) continue
    const text = (message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('\n')
    const service = /cannot get required service "([\w-]+)" in inactive context/.exec(text)?.[1]
    const missingPermissions = text.includes('permission: permissions session projection is not registered')
    if (!service && !missingPermissions) continue
    failures.push({ seq: record.seq, time: record.time, tool: calls.get(message.toolCallId) ?? 'unknown', issue: service ? 'inactive_service' : 'missing_permissions_projection', ...service ? { service } : {} })
  }
  return { records: records.length, toolResults: results, runtimeFailures: failures.length, affectedTools: [...new Set(failures.map(row => row.tool))], failures,
    diagnosis: failures.length ? 'Host runtime/service failure observed. Repeating model tool calls cannot rebind disposed contexts; preserve work and restart the host. The trigger is not established by these records.' : 'No matching runtime failure in actual tool/result records. This does not prove current live-runtime health.' }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw Error('Usage: node scripts/session-runtime-diagnose.mjs <session.jsonl[.zstd]> (read-only; Node 24+)')
    const file = process.argv[2]
    console.log(JSON.stringify(summarizeSession(readSessionRecords(readFileSync(file), file.endsWith('.zstd'))), null, 2))
  } catch (error) { console.error(String(error)); process.exitCode = 1 }
}

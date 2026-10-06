#!/usr/bin/env node
/**
 * Composition check for the DSH profile row that connects CTF2.
 *
 * `dsh --profile desktop --dump-config` refuses to run because the Electron app
 * owns that profile, so this script verifies the two things that would actually
 * break a profile edit, without booting the app:
 *
 * 1. the plugin module resolves from the profile directory's own resolution
 *    root, exactly as the loader would resolve the `name:` field;
 * 2. the plugin's real config schema accepts the intended row, so activation
 *    cannot fail on a config typo.
 *
 * Usage:
 *   node scripts/ctf2-mcp-config-check.mjs
 */

import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const PROFILE_DIR = process.env.DSH_PROFILE_DIR ?? 'C:/Users/MetaVi/.dsh/profiles/desktop'
/** Node walks up from the profile directory; the first hop is enough here. */
const RESOLUTION_ROOTS = [PROFILE_DIR, 'C:/Users/MetaVi/.dsh/profiles']

/** The row that belongs in the profile's cordis.patch.yml. */
const ROW = {
  id: 'mcp-ctf2',
  name: '@deepseek-ai/dsh-mcp-client',
  config: {
    serverName: 'ctf2',
    transport: 'streamable-http',
    url: 'http://127.0.0.1:39528/mcp',
    headers: {},
    toolCallTimeoutMs: 120000,
    failOnStartupError: false,
  },
}

function findPlugin() {
  for (const root of RESOLUTION_ROOTS) {
    const file = resolve(root, 'node_modules/@deepseek-ai/dsh-mcp-client/lib/index.js')
    if (existsSync(file)) return file
  }
  throw new Error(`@deepseek-ai/dsh-mcp-client is not resolvable from ${PROFILE_DIR}`)
}

const entry = findPlugin()
console.log(`profile dir : ${PROFILE_DIR}`)
console.log(`plugin      : ${entry}`)

const plugin = await import(pathToFileURL(entry).href)
const version = JSON.parse(
  await readFile(resolve(entry, '../../package.json'), 'utf8'),
).version
console.log(`version     : ${version}`)

if (typeof plugin.Config === 'undefined') {
  console.log('\n✗ plugin exports no Config schema — cannot validate the row')
  process.exitCode = 1
} else {
  // A Schemastery schema is callable: schema(value) resolves defaults and throws on violations.
  try {
    const resolved = plugin.Config(ROW.config)
    console.log('\n✓ Config schema accepts the row; resolved values:')
    console.log(JSON.stringify(resolved, null, 2))
  } catch (error) {
    console.log(`\n✗ Config schema rejected the row: ${error.message}`)
    process.exitCode = 1
  }
}

// Guard the namespace contract: `[A-Za-z0-9_-]{1,32}` and unique per scope.
if (!/^[A-Za-z0-9_-]{1,32}$/.test(ROW.config.serverName)) {
  console.log(`\n✗ serverName ${JSON.stringify(ROW.config.serverName)} violates the naming contract`)
  process.exitCode = 1
} else {
  console.log(`\n✓ serverName "${ROW.config.serverName}" satisfies [A-Za-z0-9_-]{1,32}`)
}

console.log('\nrow for the profile cordis.patch.yml:')
console.log(
  [
    `- id: ${ROW.id}`,
    `  name: '${ROW.name}'`,
    '  config:',
    `    serverName: ${ROW.config.serverName}`,
    `    transport: ${ROW.config.transport}`,
    `    url: '${ROW.config.url}'`,
    `    toolCallTimeoutMs: ${ROW.config.toolCallTimeoutMs}`,
    `    failOnStartupError: ${ROW.config.failOnStartupError}`,
  ].join('\n'),
)

process.exitCode = process.exitCode ?? 0

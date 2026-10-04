#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises'

let failures = 0

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`)
    return
  }

  failures += 1
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('dsh-ctf-teams package verification')

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const patchText = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
const patchName = patchText
  .split('\n')
  .filter(line => !/^\s*#/.test(line))
  .find(line => /^\s*name:\s*\S/.test(line))
  ?.match(/^\s*name:\s*(.+?)\s*$/)?.[1]
  ?.replace(/^(['"])(.*)\1$/, '$2')

check(
  'cordis.patch.yml name matches the published package name',
  patchName === pkg.name,
  `patch has ${JSON.stringify(patchName)}, package.json has ${JSON.stringify(pkg.name)}`,
)
check(
  'files[] ships the bundle patch and lib',
  ['lib', 'cordis.patch.yml', 'presets'].every(entry => pkg.files?.includes(entry)),
  `files = ${JSON.stringify(pkg.files)}`,
)
// The `ctf-teams` agent preset is what the Harness mode picker lists; a bundle
// whose `patch` field names only one file never reaches the composition.
const bundlePatch = pkg.dsh?.bundle?.patch
const bundlePatchFiles = typeof bundlePatch === 'string' ? [bundlePatch] : bundlePatch
check(
  'dsh.bundle.patch lists the host layer and the preset layer in order',
  Array.isArray(bundlePatchFiles)
    && bundlePatchFiles[0] === './cordis.patch.yml'
    && bundlePatchFiles.includes('./presets/ctf-teams.patch.yml'),
  `patch = ${JSON.stringify(bundlePatch)}`,
)
const presetText = await readFile(new URL('../presets/ctf-teams.patch.yml', import.meta.url), 'utf8')
check(
  'preset layer declares the ctf-teams agent preset',
  /^\s*name:\s*'@deepseek-ai\/dsh-agent-preset'\s*$/m.test(presetText)
    && /^\s*id:\s*ctf-teams\s*$/m.test(presetText),
  'presets/ctf-teams.patch.yml must declare @deepseek-ai/dsh-agent-preset with config.id ctf-teams',
)
check(
  'scoped package publishes publicly',
  !pkg.name.startsWith('@') || pkg.publishConfig?.access === 'public',
  'scoped packages default to restricted without publishConfig.access = "public"',
)
const requiredPeers = Object.keys(pkg.peerDependencies ?? {})
  .filter(name => pkg.peerDependenciesMeta?.[name]?.optional !== true)
check(
  'shared runtime peers are optional for standalone profile installs',
  requiredPeers.length === 0,
  `required peers trigger pnpm warnings: ${JSON.stringify(requiredPeers)}`,
)

for (const path of ['../lib/index.js']) {
  try {
    await access(new URL(path, import.meta.url))
    check(`${path.slice(3)} exists`, true)
  } catch {
    check(`${path.slice(3)} exists`, false)
  }
}

// Two halves ship together: the host plugin (tools, routes, agent preset) and
// the browser dashboard view the `conversation.view` slot renders.
check(
  'exports declares the client bundle',
  pkg.exports?.['./client']?.default === './lib/client.js',
  `exports["./client"] = ${JSON.stringify(pkg.exports?.['./client'])}`,
)
check(
  'dsh.client declares the web platform',
  pkg.dsh?.client?.platform === 'web',
  `dsh.client = ${JSON.stringify(pkg.dsh?.client)}`,
)
check(
  'files[] ships the client bundle directory',
  pkg.files?.includes('lib'),
  `files = ${JSON.stringify(pkg.files)}`,
)
try {
  await access(new URL('../assets/ctf/knowledge', import.meta.url))
  check('assets/ctf/knowledge ships with the package', true)
} catch {
  check('assets/ctf/knowledge ships with the package', false)
}

if (failures > 0) {
  console.error(`\n${failures} package verification check(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nPackage verification passed')
}

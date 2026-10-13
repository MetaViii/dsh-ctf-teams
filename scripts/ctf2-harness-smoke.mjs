/** Offline product-entry acceptance against the already installed, exact DSH cohort. */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, realpathSync, symlinkSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const lab = mkdtempSync(join(tmpdir(), 'ctf2-harness-'))
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--artifact')) throw new Error('Usage: node scripts/ctf2-harness-smoke.mjs [--artifact package.tgz]')
let pluginRoot = root, artifactSha256
if (args.length) {
  const artifact = resolve(args[1])
  artifactSha256 = createHash('sha256').update(readFileSync(artifact)).digest('hex')
  const unpack = join(lab, 'unpacked')
  mkdirSync(unpack)
  const extraction = spawnSync('tar', ['-xzf', artifact, '-C', unpack], { encoding: 'utf8' })
  assert.equal(extraction.status, 0, extraction.stderr || String(extraction.error))
  pluginRoot = join(unpack, 'package')
  assert.equal(JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8')).name, '@nanmicoder/dsh-ctf-teams')
}
const home = join(lab, 'home'), profile = join(home, 'profiles/headless'), workspace = join(lab, 'workspace')
mkdirSync(join(profile, 'node_modules/@deepseek-ai'), { recursive: true })
mkdirSync(join(profile, 'node_modules/@nanmicoder'), { recursive: true })
mkdirSync(workspace, { recursive: true })
const cli = realpathSync(join(root, 'node_modules/@deepseek-ai/dsh'))
const version = JSON.parse(readFileSync(join(cli, 'package.json'), 'utf8')).version
const packages = new Map()
for (const scope of ['node_modules/.pnpm/node_modules/@deepseek-ai', 'node_modules/@deepseek-ai']) {
  for (const name of readdirSync(join(root, scope))) packages.set(name, realpathSync(join(root, scope, name)))
}
const cohort = []
for (const [name, source] of packages) {
  const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  if (/^dsh(?:-|$)/.test(name)) { assert.equal(pkg.version, version, `mixed DSH cohort: ${name}`); cohort.push({ name: pkg.name, version: pkg.version }) }
  symlinkSync(source, join(profile, 'node_modules/@deepseek-ai', name), process.platform === 'win32' ? 'junction' : 'dir')
}
symlinkSync(pluginRoot, join(profile, 'node_modules/@nanmicoder/dsh-ctf-teams'), process.platform === 'win32' ? 'junction' : 'dir')
if (pluginRoot !== root) {
  mkdirSync(join(pluginRoot, 'node_modules'))
  symlinkSync(join(profile, 'node_modules/@deepseek-ai'), join(pluginRoot, 'node_modules/@deepseek-ai'), process.platform === 'win32' ? 'junction' : 'dir')
}
copyFileSync(join(root, 'scripts/fixtures/harness-runtime-ctf2.mjs'), join(profile, 'fixture-ctf2.mjs'))
writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'ctf2-isolated-smoke', private: true, type: 'module', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@nanmicoder/dsh-ctf-teams'], patchReload: 'startup' } } }))
writeFileSync(join(profile, 'cordis.patch.yml'), `- id: llm-deepseek
  disabled: true
- id: llm-pi-ai
  disabled: true
- id: headless-startup
  disabled: true
- id: headless-runner
  disabled: true
- id: agent-default-model
  config:
    provider: runtime-lab
    model: fixture-model
- id: ctf-teams
  config:
    references:
      autoSync: off
- insert:
    - id: runtime-lab-ctf2-regression
      name: ./fixture-ctf2.mjs
`)
const trace = join(lab, 'trace.jsonl')
const child = spawn(process.execPath, [join(cli, 'lib/bin.js'), '--profile', 'headless'], { cwd: workspace, env: { ...process.env, DSH_HOME: home, DSH_PERMISSION_MODE: 'danger-full-access', DSH_TELEMETRY_DISABLED: '1', LAB_TRACE: trace }, stdio: ['ignore', 'pipe', 'pipe'] })
let stdout = '', stderr = ''
child.stdout.on('data', data => stdout += data.toString('utf8'))
child.stderr.on('data', data => stderr += data.toString('utf8'))
const timer = setTimeout(() => child.kill(), 90000)
const exit = await new Promise((done, reject) => { child.on('error', reject); child.on('exit', code => done(code)) })
clearTimeout(timer)
writeFileSync(join(lab, 'stdout.log'), stdout, 'utf8')
writeFileSync(join(lab, 'stderr.log'), stderr, 'utf8')
const passed = exit === 0 && stdout.includes('CTF2_REGRESSION_PASSED')
const report = { passed, version, node: process.version, platform: process.platform, artifactSha256, cohortCount: cohort.length, cohort, exit, reportDir: lab, unverified: ['real model reasoning', 'live CTF2 platform verdicts', 'other host versions', 'interactive browser'] }
writeFileSync(join(lab, 'result.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify({ passed, version, cohortCount: cohort.length, reportDir: lab, exit }))
if (!passed) { console.error(stderr.slice(-6000)); console.error(stdout.slice(-3000)); process.exitCode = 1 }

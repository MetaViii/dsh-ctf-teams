/** Isolated exact-host acceptance of the installed dsh-ops Windows shell integration. */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readdirSync, realpathSync, readFileSync, writeFileSync, cpSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync } from 'node:child_process'

assert.equal(process.platform, 'win32', 'Windows-only native integration test')
const root = dirname(dirname(fileURLToPath(import.meta.url))), args = process.argv.slice(2)
assert.ok(args[0] === '--ops-root' && args[1], 'Usage: node scripts/windows-shell-smoke.mjs --ops-root <installed dsh-ops> [--artifact <tgz>]')
const ops = resolve(args[1]), pkg = JSON.parse(readFileSync(join(ops, 'package.json')))
assert.equal(pkg.name, 'dsh-ops'); assert.equal(pkg.version, '0.3.0')
const lab = mkdtempSync(join(tmpdir(), 'ctf-windows-shell-')), home = join(lab, 'home'), profile = join(home, 'profiles/headless'), workspace = join(lab, 'workspace')
mkdirSync(join(profile, 'node_modules/@deepseek-ai'), { recursive: true }); mkdirSync(join(profile, 'node_modules/@nanmicoder'), { recursive: true }); mkdirSync(workspace)
let pluginRoot = root
if (args[2] === '--artifact') {
  const unpack = join(lab, 'artifact'); mkdirSync(unpack)
  const extraction = spawnSync('tar', ['-xzf', resolve(args[3]), '-C', unpack], { encoding: 'utf8' })
  assert.equal(extraction.status, 0, extraction.stderr); pluginRoot = join(unpack, 'package')
}
const packages = new Map()
for (const scope of ['node_modules/.pnpm/node_modules/@deepseek-ai', 'node_modules/@deepseek-ai']) for (const name of readdirSync(join(root, scope))) packages.set(name, realpathSync(join(root, scope, name)))
for (const [name, source] of packages) symlinkSync(source, join(profile, 'node_modules/@deepseek-ai', name), 'junction')
symlinkSync(pluginRoot, join(profile, 'node_modules/@nanmicoder/dsh-ctf-teams'), 'junction')
if (pluginRoot !== root) { mkdirSync(join(pluginRoot, 'node_modules')); symlinkSync(join(profile, 'node_modules/@deepseek-ai'), join(pluginRoot, 'node_modules/@deepseek-ai'), 'junction') }
cpSync(ops, join(profile, 'node_modules/dsh-ops'), { recursive: true })
symlinkSync(join(dirname(ops), '@dsh-ops'), join(profile, 'node_modules/@dsh-ops'), 'junction')
const managed = join(process.env.DSH_HOME ?? join(process.env.USERPROFILE, '.dsh'), 'dsh-ops/shells')
mkdirSync(join(home, 'dsh-ops'), { recursive: true }); symlinkSync(managed, join(home, 'dsh-ops/shells'), 'junction')
writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'windows-shell-lab', private: true, type: 'module', dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless', '@nanmicoder/dsh-ctf-teams'], patchReload: 'startup' } } }))
cpSync(join(root, 'scripts/fixtures/harness-windows-shell.mjs'), join(profile, 'fixture.mjs'))
writeFileSync(join(profile, 'cordis.patch.yml'), `- id: llm-deepseek
  disabled: true
- id: llm-pi-ai
  disabled: true
- id: headless-startup
  disabled: true
- id: headless-runner
  disabled: true
- id: approval
  config:
    policy: never
- id: permission
  config:
    defaultPreset: workspace-write
- id: ctf-teams
  config:
    references:
      autoSync: off
- insert:
    - id: subagent-model-selection-settings
      name: '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
    - id: agent-preset-registry
      name: '@deepseek-ai/dsh-agent-preset-registry'
      config:
        default: ctf-teams
        selectedDefault: ctf-teams
    - id: dsh-ops-shell
      name: dsh-ops/shell
      config:
        promptPolicy: true
        publishBashTool: true
        shellPolicy: advise
        allowSystemShellFallback: false
    - id: windows-shell-lab
      name: ./fixture.mjs
`)
const output = join(lab, 'shell-result.json')
const child = spawn(process.execPath, [join(packages.get('dsh'), 'lib/bin.js'), '--profile', 'headless'], { cwd: workspace, env: { ...process.env, DSH_HOME: home, DSH_PERMISSION_MODE: 'workspace-write', DSH_TELEMETRY_DISABLED: '1', SHELL_LAB_RESULT: output }, stdio: ['ignore', 'pipe', 'pipe'] })
let stdout = '', stderr = '', timedOut = false
child.stdout.on('data', b => stdout += b.toString()); child.stderr.on('data', b => stderr += b.toString())
const timer = setTimeout(() => { timedOut = true; child.kill() }, 180000)
const exit = await new Promise((done, reject) => { child.on('error', reject); child.on('exit', done) }); clearTimeout(timer)
writeFileSync(join(lab, 'stdout.log'), stdout); writeFileSync(join(lab, 'stderr.log'), stderr)
const report = { passed: exit === 0 && stdout.includes('WINDOWS_SHELL_OK') && !timedOut, exit, timedOut, reportDir: lab, hostVersion: JSON.parse(readFileSync(join(packages.get('dsh'), 'package.json'))).version, opsVersion: pkg.version, result: existsSync(output) ? JSON.parse(readFileSync(output)) : undefined }
writeFileSync(join(lab, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
if (!report.passed) { console.error(stderr.slice(-5000)); console.error(stdout.slice(-3000)); process.exitCode = 1 }

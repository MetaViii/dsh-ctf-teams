import test from 'node:test'
import assert from 'node:assert/strict'
import { windowsPowerShellModulePath, installWindowsShellCompatibility } from '../lib/windows-shell.js'

test('native WinPS modules precede inherited PS7 modules without losing custom entries', () => {
  const env = { SystemRoot: 'D:\\Windows', ProgramFiles: 'D:\\Programs', PSModulePath: 'X:\\pwsh7\\Modules;X:\\custom;d:/windows/System32/WindowsPowerShell/v1.0/Modules/' }
  const paths = windowsPowerShellModulePath(env).split(';')
  assert.equal(paths[0], 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules')
  assert.equal(paths[1], 'D:\\Programs\\WindowsPowerShell\\Modules')
  assert.deepEqual(paths.slice(2), ['X:\\pwsh7\\Modules', 'X:\\custom'])
  assert.equal(windowsPowerShellModulePath({ ...env, PSModulePath: paths.join(';') }), paths.join(';'))
})

test('Windows environment names are case insensitive and empty/quoted entries are normalized', () => {
  const path = windowsPowerShellModulePath({ systemroot: 'C:\\Windows', psmodulepath: '; "X:\\custom" ;X:/custom/;;' })
  assert.equal(path.split(';').filter(x => x.includes('custom')).length, 1)
  assert.ok(!path.includes(';;'))
})

function fixture(env, platform = 'win32') {
  let dispose, effects = 0
  installWindowsShellCompatibility({ effect(setup) { effects++; dispose = setup() } }, { env, platform })
  return { dispose: () => dispose?.(), effects }
}

test('effect restores the original environment on unload and can mount again', () => {
  const env = { PSModulePath: 'X:\\PS7\\Modules' }
  for (let i = 0; i < 2; i++) {
    const effect = fixture(env)
    assert.match(env.PSModulePath, /^C:\\Windows\\System32\\WindowsPowerShell/)
    effect.dispose()
    assert.equal(env.PSModulePath, 'X:\\PS7\\Modules')
  }
})

test('unload preserves subsequent owners and handles an initially absent key', () => {
  const env = {}
  fixture(env).dispose()
  assert.deepEqual(env, {})
  const effect = fixture(env)
  env.PSModulePath = 'Y:\\new-owner'
  effect.dispose()
  assert.equal(env.PSModulePath, 'Y:\\new-owner')
})

test('non-Windows hosts and unrelated environment variables remain unchanged', () => {
  const env = { PSModulePath: 'custom', PATH: 'unchanged', SOME_TOKEN: 'unchanged' }
  assert.equal(fixture(env, 'linux').effects, 0)
  assert.deepEqual(env, { PSModulePath: 'custom', PATH: 'unchanged', SOME_TOKEN: 'unchanged' })
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, readFile, rm, mkdir, symlink, open, rename } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { proposeHypothesis, recordHypothesisTest, hypothesisSummary, hypothesisArchive } from '../lib/hypotheses.js'
import { captureEvidenceFiles, inspectEvidenceFiles, EVIDENCE_FILE_MAX_BYTES } from '../lib/evidence-files.js'
import { writeTeam, readTeam } from '../lib/state.js'

const fresh = () => ({ id: 'ledger', name: 'ledger', captainSessionId: 'captain', createdAt: 1, tasks: [], taskSeq: 0, members: [] })
const proposal = { by: 'worker', challengeId: 'crypto-01', statement: 'The modulus is a perfect square', prediction: 'isqrt(n)**2 == n' }
const experiment = { by: 'worker', hypothesisId: 'h1', expectedRevision: 1, key: 'square-check-1', method: 'python square.py; Python 3; n=49', observation: 'isqrt(49)**2 = 49', outcome: 'supports', basis: 'construction', files: [] }

test('hypotheses distinguish challenge and prediction, deduplicate exact reports and preserve conflicting corrections', () => {
  const team = fresh()
  assert.equal(proposeHypothesis(team, proposal).hypothesis.id, 'h1')
  const before = JSON.stringify(team)
  assert.equal(proposeHypothesis(team, { ...proposal, by: 'another-worker' }).duplicate, true)
  assert.equal(JSON.stringify(team), before)
  proposeHypothesis(team, { ...proposal, challengeId: 'crypto-02' })
  proposeHypothesis(team, { ...proposal, prediction: 'n ends in 9' })
  const first = recordHypothesisTest(team, experiment)
  assert.equal(first.hypothesis.revision, 2)
  const after = JSON.stringify(team)
  assert.equal(recordHypothesisTest(team, experiment).duplicate, true)
  assert.equal(JSON.stringify(team), after)
  assert.throws(() => recordHypothesisTest(team, { ...experiment, observation: 'made up correction' }), /different content/)
  assert.throws(() => recordHypothesisTest(team, { ...experiment, key: 'new-key' }), /stale expected_revision/)
  assert.throws(() => recordHypothesisTest(team, { ...experiment, key: 'timing', expectedRevision: 2, outcome: 'refutes', basis: 'measurement' }), /next_step/)
  assert.equal(JSON.stringify(team), after)
  recordHypothesisTest(team, { ...experiment, key: 'corrected-input', expectedRevision: 2, outcome: 'refutes', observation: 'actual attachment n=50, isqrt(n)**2 = 49', nextStep: 're-read n from the attachment' })
  assert.deepEqual(hypothesisSummary(team), { total: 3, untested: 2, tests: 2, conflicts: 1 })
  assert.equal(team.hypotheses[0].tests[0].observation, experiment.observation)
  assert.equal(team.hypotheses[0].tests[1].by, 'worker')
  assert.equal(team.findings.every(finding => !finding.verifications), true)
  assert.equal(team.flags, undefined)
  assert.equal(team.challenge, undefined)
  assert.match(hypothesisArchive(team).join('\n'), /REPORTED supports[\s\S]*REPORTED refutes/)
})

test('malformed or oversized inputs do not partially modify the durable board', () => {
  for (const patch of [{ challengeId: '' }, { statement: ' ' }, { prediction: '' }, { statement: 'x'.repeat(2001) }, { challengeId: 'x'.repeat(201) }]) {
    const team = fresh(), before = JSON.stringify(team)
    assert.throws(() => proposeHypothesis(team, { ...proposal, ...patch }))
    assert.equal(JSON.stringify(team), before)
  }
  const team = fresh()
  proposeHypothesis(team, proposal)
  for (const patch of [{ method: '' }, { observation: '' }, { key: '' }, { basis: 'proven' }, { outcome: 'verified' }, { expectedRevision: 1.5 }, { hypothesisId: 'h999' }]) {
    const before = JSON.stringify(team)
    assert.throws(() => recordHypothesisTest(team, { ...experiment, ...patch }))
    assert.equal(JSON.stringify(team), before)
  }
})

test('workspace evidence binds real bytes and detects changes, missing files, directory and symlink escape', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ctf-evidence-'))
  try {
    const workspace = join(root, 'workspace'), outside = join(root, 'outside')
    await mkdir(workspace); await mkdir(outside)
    await writeFile(join(workspace, 'proof.txt'), 'actual output\n')
    await writeFile(join(outside, 'proof.txt'), 'outside bytes')
    const snapshots = await captureEvidenceFiles(workspace, ['proof.txt', './proof.txt'])
    assert.equal(snapshots.length, 1)
    assert.equal(snapshots[0].sha256, createHash('sha256').update(await readFile(join(workspace, 'proof.txt'))).digest('hex'))
    assert.equal((await inspectEvidenceFiles(workspace, snapshots))[0].status, 'matched')
    await writeFile(join(workspace, 'proof.txt'), 'changed output\n')
    assert.equal((await inspectEvidenceFiles(workspace, snapshots))[0].status, 'changed')
    await rename(join(workspace, 'proof.txt'), join(workspace, 'proof-moved.txt'))
    assert.equal((await inspectEvidenceFiles(workspace, snapshots))[0].status, 'missing')
    for (const path of ['../outside/proof.txt', '..\\outside\\proof.txt', join(outside, 'proof.txt'), 'C:relative.txt', '\\server\\share', 'bad\0name', '.', 'missing.txt']) {
      await assert.rejects(captureEvidenceFiles(workspace, [path]))
    }
    await symlink(outside, join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    await assert.rejects(captureEvidenceFiles(workspace, ['escape/proof.txt']), /outside workspace/)
    const handle = await open(join(workspace, 'oversize.bin'), 'w')
    await handle.truncate(EVIDENCE_FILE_MAX_BYTES + 1); await handle.close()
    await assert.rejects(captureEvidenceFiles(workspace, ['oversize.bin']), /32 MiB/)
    await assert.rejects(captureEvidenceFiles(workspace, Array(9).fill('proof-moved.txt')), /at most 8/)
    assert.equal((await inspectEvidenceFiles(workspace, [{ ...snapshots[0], path: 'escape/proof.txt' }]))[0].status, 'unreadable')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('legacy teams remain readable and the full ledger survives JSON reload without changing task lifecycle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ctf-ledger-state-'))
  try {
    const team = fresh()
    await mkdir(join(root, team.id))
    await writeTeam(root, team)
    const legacy = await readTeam(root, team.id)
    assert.deepEqual(hypothesisSummary(legacy), { total: 0, untested: 0, tests: 0, conflicts: 0 })
    proposeHypothesis(legacy, proposal)
    recordHypothesisTest(legacy, experiment)
    legacy.halted = true
    await writeTeam(root, legacy)
    assert.deepEqual(await readTeam(root, team.id), legacy)
    assert.equal(legacy.halted, true)
    assert.deepEqual(legacy.tasks, [])
  } finally { await rm(root, { recursive: true, force: true }) }
})

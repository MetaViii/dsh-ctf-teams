import test from 'node:test'
import assert from 'node:assert/strict'
import { diagnosePlan } from '../lib/plan-diagnostics.js'
import { appendFinding, appendFlagCandidate, advanceCursor, deltaSince, flagMatchesFormat, flagReference, formatBoardDelta, reviewFlagCandidate, updateChallenge, verifyFinding } from '../lib/findings.js'
import { createTeamDir, readTeam, writeTeam } from '../lib/state.js'
import { renderDashboard, dashboardInputFromTeam, displayWidth } from '../lib/dashboard.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildActivationDirective } from '../lib/command.js'

const team = () => ({ id: 'ctf2', name: '中文题目', captainSessionId: 'cap', createdAt: 1, members: [], tasks: [], taskSeq: 0 })

test('slash activation allows solo and gives an executable profile task workflow', () => {
  assert.match(buildActivationDirective('decode attachment'), /create\(mode="solo"\)/)
  assert.match(buildActivationDirective('parallel solve', 'ctf-teams'), /create_task after profile creation/)
  assert.doesNotMatch(buildActivationDirective('parallel solve', 'ctf-teams'), /task graph from the goal in the same call as create/)
})

test('plan diagnostics distinguish real missing fields from extra fields', () => {
  const valid = { members: [{ name: 'x', executionPrompt: '检查附件原始字节' }], tasks: [{ id: 'recon', subject: '侦察中文附件', assignee: 'x' }] }
  assert.equal(diagnosePlan(valid), undefined)
  const extra = diagnosePlan({ ...valid, members: [{ name: 'x', unexpected: true }] })
  assert.match(extra, /Undeclared fields: plan.members\[0\].unexpected/)
  assert.doesNotMatch(extra, /Missing fields/)
  const missing = diagnosePlan({ ...valid, tasks: [{ description: '中文'.repeat(10000), assignee: 'x' }] })
  assert.match(missing, /Missing fields: plan.tasks\[0\].id, plan.tasks\[0\].subject/)
  assert.match(missing, /Received plan structure/)
  assert.ok(missing.length < 1200, 'large descriptions never bury the diagnostic')
  const both = diagnosePlan({ members: [{ name: 'x', extra: 'x' }] })
  assert.match(both, /Missing fields: plan.tasks/)
  assert.match(both, /Undeclared fields/)
  assert.match(diagnosePlan({ members: [{ name: 1 }], tasks: [{ id: 'x', subject: 'x', dependencies: [1] }] }), /must be a string array/)
})

test('CTF2 wrapper is advisory, exact case matters, and format changes merge', () => {
  const t = team()
  updateChallenge(t, { title: 'easyre', remote: 'http://ctf.local', flagFormat: 'flag\\{[^}]+\\}', environmentId: 'env-1' })
  const first = appendFlagCandidate(t, { flag: 'CTF2{EaSyRe}', submittedBy: 'worker' })
  assert.match(first.candidate.formatWarning, /Observed wrapper: CTF2/)
  assert.equal(first.candidate.flag, 'CTF2{EaSyRe}')
  assert.equal(appendFlagCandidate(t, { flag: 'CTF2{EaSyRe}', submittedBy: 'other' }).candidate.id, first.candidate.id)
  assert.equal(appendFlagCandidate(t, { flag: 'CTF2{easyre}', submittedBy: 'other' }).duplicate, false)
  updateChallenge(t, { flagFormat: ['flag\\{[^}]+\\}', 'CTF2\\{[^}]+\\}'] })
  assert.equal(t.challenge.remote, 'http://ctf.local')
  assert.equal(t.challenge.environmentId, 'env-1')
  assert.equal(flagMatchesFormat('CTF2{original}', t.challenge), true)
  assert.equal(flagMatchesFormat('prefix CTF2{original} suffix', t.challenge), false)
  assert.throws(() => updateChallenge(t, { flagFormat: '[' }), /invalid flag_format/)
  assert.throws(() => updateChallenge(t, { flagFormat: [] }), /nonempty/)
  updateChallenge(t, { flagFormat: null })
  assert.equal(t.challenge.flagFormat, null)
  assert.equal(flagMatchesFormat('bare-platform-value', t.challenge), true)
  assert.throws(() => appendFlagCandidate(t, { flag: ' ', submittedBy: 'worker' }), /empty/)
})

test('verdicts sync after candidate was seen and can revoke solved state', () => {
  const t = team()
  const { candidate } = appendFlagCandidate(t, { flag: 'flag{registered}', submittedBy: 'worker' })
  advanceCursor(t, 'worker')
  reviewFlagCandidate(t, `ctf2/${candidate.id}`, 'verified', { by: 'captain', verifiedFlag: 'CTF2{accepted}', note: 'platform accepted' })
  const delta = deltaSince(t, 'worker')
  assert.equal(delta.flags.length, 1)
  assert.match(formatBoardDelta(delta), /platform accepted: CTF2\{accepted\}/)
  assert.equal(candidate.flag, 'flag{registered}')
  advanceCursor(t, 'worker')
  assert.equal(deltaSince(t, 'worker').hasUpdates, false)
  reviewFlagCandidate(t, '', 'rejected', { by: 'captain', flag: candidate.flag })
  assert.equal(t.challenge.solved, false)
  assert.equal(candidate.verifiedFlag, undefined)
  assert.equal(deltaSince(t, 'worker').flags.length, 1)
  assert.throws(() => reviewFlagCandidate(t, 'f99', 'verified', { by: 'captain' }), /Current ids: f1 \(ctf2@/)
  assert.throws(() => reviewFlagCandidate(t, 'other\/f1', 'verified', { by: 'captain' }), /no flag candidate/)
  assert.throws(() => reviewFlagCandidate(t, 'f99', 'verified', { by: 'captain', flag: candidate.flag }), /different candidates/)
})

test('finding checks are explicit, auditable and sync as a new beat', () => {
  const t = team()
  const finding = appendFinding(t, { from: 'worker', content: '已解码 EaSyRe', evidenceKind: 'inference', confidence: 'high', evidence: 'python solve.py' })
  advanceCursor(t, 'worker')
  assert.match(formatBoardDelta(deltaSince(t, 'captain')), /unverified; inference; confidence=high/)
  verifyFinding(t, finding.id, { by: 'captain', method: 'xxd attachment.bin', result: 'refuted', note: '原始字节大小写不符' })
  verifyFinding(t, finding.id, { by: 'captain', method: 'python solve-fixed.py', result: 'confirmed', note: '已独立复现' })
  assert.equal(finding.verifications.length, 2)
  assert.equal(deltaSince(t, 'worker').findings.length, 2)
  assert.match(formatBoardDelta(deltaSince(t, 'worker')), /refuted/)
  assert.match(formatBoardDelta(deltaSince(t, 'worker')), /confirmed/)
  assert.throws(() => verifyFinding(t, finding.id, { by: 'captain', method: ' ', result: 'confirmed' }), /empty/)
})

test('same-name team generations reject old flag references', () => {
  const old = { ...team(), boardId: 'old-generation' }
  const current = { ...team(), boardId: 'new-generation' }
  const { candidate: oldFlag } = appendFlagCandidate(old, { flag: 'flag{same}', submittedBy: 'captain' })
  const { candidate } = appendFlagCandidate(current, { flag: 'flag{same}', submittedBy: 'captain' })
  assert.equal(oldFlag.id, candidate.id)
  assert.notEqual(flagReference(old, oldFlag), flagReference(current, candidate))
  assert.throws(() => reviewFlagCandidate(current, flagReference(old, oldFlag), 'verified', { by: 'captain' }), /no flag candidate/)
  reviewFlagCandidate(current, flagReference(current, candidate), 'verified', { by: 'captain' })
  assert.equal(current.challenge.solved, true)
})

test('UTF-8 board survives disk reload with null format, evidence and exact ids', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ctf2-utf8-'))
  try {
    const t = team()
    t.mode = 'solo'
    updateChallenge(t, { title: '中文题目🚩', flagFormat: null })
    await createTeamDir(root, t)
    const finding = appendFinding(t, { from: 'captain', content: '大小写核验：中文题目', evidenceKind: 'raw_output' })
    verifyFinding(t, finding.id, { by: 'captain', method: '读取原始字节', result: 'confirmed' })
    const { candidate } = appendFlagCandidate(t, { flag: 'CTF2{EaSyRe}', submittedBy: 'captain' })
    await writeTeam(root, t)
    const reloaded = await readTeam(root, 'ctf2')
    reviewFlagCandidate(reloaded, 'ctf2/f1', 'verified', { by: 'captain' })
    await writeTeam(root, reloaded)
    const final = await readTeam(root, 'ctf2')
    assert.equal(final.flags[0].id, candidate.id)
    assert.equal(final.flags[0].verifiedFlag, 'CTF2{EaSyRe}')
    assert.equal(final.findings[0].content, '大小写核验：中文题目')
    assert.equal(final.challenge.flagFormat, null)
    const panel = renderDashboard(dashboardInputFromTeam(final))
    assert.match(panel, /中文题目🚩/)
    assert.match(panel, /solo/)
    assert.equal(new Set(panel.split('\n').map(displayWidth)).size, 1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

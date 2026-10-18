import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { appendFlagCandidate, batchProgress, flagWrapper, nestedFlagVariants, markChallengeSolved, reviewFlagCandidate, updateChallenge, formatBoardDelta, deltaSince } from '../lib/findings.js'
import { recordMemberFault, memberAvailable, foldFailureInbox } from '../lib/availability.js'
import { taskBlockReason, validatePreflight } from '../lib/task-admission.js'
import { createTeamDir, readTeam, writeTeam } from '../lib/state.js'
import { failMemberOpenAttempt } from '../lib/members.js'
import { proxyHealth, readPlatformSnapshot, proxyUrl } from '../lib/platform.js'

const team = () => ({ id: 'batch', name: 'Batch', captainSessionId: 'cap', createdAt: 1, taskSeq: 0, tasks: [], members: [] })
const member = () => ({ id: 'worker', name: 'worker', joinedAt: 1, status: 'working' })

test('configuration failure stops admission immediately; 429 unknown reset stays blocked; temporary failures have one bounded recovery', () => {
  const worker = member()
  assert.equal(recordMemberFault(worker, { code: 'NO_ADAPTER', message: 'missing route' }, 100).notify, true)
  assert.equal(memberAvailable(worker, 999999), false)
  for (let n = 0; n < 100; n++) assert.equal(recordMemberFault(worker, { code: 'NO_ADAPTER', message: 'missing route' }, 200 + n).notify, false)
  assert.equal(worker.failureCounts.NO_ADAPTER, 101)
  const limited = member()
  recordMemberFault(limited, { code: 'RATE_LIMIT', message: '429', status: 429 }, 100)
  assert.equal(memberAvailable(limited, 1e12), false)
  recordMemberFault(limited, { code: 'RATE_LIMIT', message: '429', providerRetryAfterMs: 1000 }, 200)
  assert.equal(memberAvailable(limited, 1e12), false, 'repeated exhausted rate limit does not loop')
  const transient = member()
  recordMemberFault(transient, { code: 'SERVICE_UNAVAILABLE', status: 503, message: 'no_healthy_account' }, 100, 1000)
  assert.equal(memberAvailable(transient, 1099), false)
  assert.equal(memberAvailable(transient, 1100), true)
  recordMemberFault(transient, { code: 'SERVICE_UNAVAILABLE', status: 503, message: 'no_healthy_account' }, 1100)
  assert.equal(memberAvailable(transient, 1e12), false)
  const reset = member()
  recordMemberFault(reset, { code: 'RATE_LIMIT', message: 'reset at 2030-01-01T00:00:00Z' }, 100)
  assert.equal(reset.fault.retryAt, Date.parse('2030-01-01T00:00:00Z'))
})

test('100 final NO_ADAPTER reports persist one notice and retain task/checkpoint across reloads', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ctf-fault-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const state = team()
  state.members = [member()]
  state.tasks = [{ id: 't1', subject: 'long batch', status: 'in_progress', assignee: 'worker', dependencies: [], createdAt: 1, updatedAt: 1, attempt: 1, attemptId: 'capability', output: 'solved 3, script saved', remainingItems: ['ch4', 'ch5'] }]
  await createTeamDir(root, state)
  const ctx = { agents: { get() {} }, logger: { warn() {}, debug() {} } }
  const observed = { captainSessionId: 'cap', memberId: 'worker', task: { id: 't1', attempt: 1, attemptId: 'capability' } }
  for (let n = 0; n < 100; n++) await failMemberOpenAttempt(ctx, root, 'batch', 'worker', { code: 'NO_ADAPTER', message: 'route missing' }, { append() {} }, observed)
  const loaded = await readTeam(root, 'batch')
  assert.equal(loaded.members[0].fault.count, 100)
  assert.equal(loaded.tasks[0].status, 'in_progress')
  assert.equal(loaded.tasks[0].assignee, 'worker')
  assert.equal(loaded.tasks[0].checkpoint, 'solved 3, script saved')
  assert.deepEqual(loaded.tasks[0].remainingItems, ['ch4', 'ch5'])
  const { readMailbox } = await import('../lib/state.js')
  assert.equal((await readMailbox(root, 'batch', 'captain')).length, 1)
  await writeTeam(root, loaded)
  assert.equal(memberAvailable((await readTeam(root, 'batch')).members[0]), false)
})

test('historical duplicate failures fold while ordinary reports remain separate and all ids stay acknowledgeable', () => {
  const messages = Array.from({ length: 100 }, (_, n) => ({ id: String(n), from: 'worker', to: 'captain', content: 'Member failure: 429 (code RATE_LIMIT)', ts: n }))
  messages.splice(2, 0, { id: 'result', from: 'worker', to: 'captain', content: 'Result found', ts: 2 })
  const folded = foldFailureInbox(messages)
  assert.equal(folded.length, 2)
  assert.equal(folded[0].ids.length, 100)
  assert.match(folded[0].message.content, /100 repeated RATE_LIMIT/)
  assert.equal(folded[1].message.content, 'Result found')
})

test('23-challenge batch counts distinct challenges, does not stop early and requires explicit closure', () => {
  const state = team()
  updateChallenge(state, { multiChallenge: true, expectedChallenges: 23 })
  for (let n = 0; n < 23; n++) {
    const candidate = appendFlagCandidate(state, { flag: 'flag{same}', submittedBy: 'worker', challengeId: 'ch' + n }).candidate
    reviewFlagCandidate(state, candidate.id, 'verified', { by: 'captain', note: 'platform accepted' })
    assert.equal(state.challenge.solved, false)
    if (n < 22) assert.throws(() => markChallengeSolved(state, 'complete'), /batch incomplete/)
  }
  assert.equal(batchProgress(state).verified, 23)
  assert.throws(() => reviewFlagCandidate(state, '', 'verified', { flag: 'flag{same}', by: 'captain' }), /ambiguous/)
  assert.throws(() => reviewFlagCandidate(state, 'flag{same}', 'verified', { by: 'captain' }), /ambiguous/)
  assert.match(formatBoardDelta(deltaSince(state, 'worker')), /Continue remaining lanes/)
  markChallengeSolved(state, 'platform accepted all 23 distinct challenge ids')
  assert.equal(state.challenge.solved, true)
})

test('nested wrapper variants preserve original bytes and independent platform histories without double counting', () => {
  const state = team()
  updateChallenge(state, { multiChallenge: true, expectedChallenges: 2 })
  const original = appendFlagCandidate(state, { flag: 'flag{GWHT{aA01}}', submittedBy: 'worker', challengeId: 'ch1' }).candidate
  assert.equal(original.formatWarning, undefined)
  assert.equal(flagWrapper(original.flag), 'flag')
  assert.equal(flagWrapper('flag{a}b}'), undefined)
  assert.deepEqual(nestedFlagVariants(original.flag), ['GWHT{aA01}', 'aA01'])
  const variant = appendFlagCandidate(state, { flag: 'GWHT{aA01}', submittedBy: 'worker', challengeId: 'ch1', variantOf: original.id }).candidate
  reviewFlagCandidate(state, original.id, 'rejected', { by: 'captain', note: 'wrapper rejected by platform' })
  reviewFlagCandidate(state, variant.id, 'verified', { by: 'captain', note: 'platform accepted' })
  assert.equal(original.status, 'rejected')
  assert.equal(variant.reviews[0].verdict, 'verified')
  assert.equal(batchProgress(state).verified, 1)
})

test('switching an old single solve to an uncounted batch requires scoped verification before completion', () => {
  const state = team()
  const old = appendFlagCandidate(state, { flag: 'flag{old}', submittedBy: 'worker' }).candidate
  reviewFlagCandidate(state, old.id, 'verified', { by: 'captain' })
  updateChallenge(state, { multiChallenge: true })
  assert.equal(state.challenge.solved, false)
  assert.throws(() => markChallengeSolved(state, 'old success is not this batch'), /challenge_id/)
})

test('resource exclusivity and read-only preflight reject stale, unknown and mismatched facts; confirmed offline checks are explicit', () => {
  const state = team()
  const task = { id: 't2', status: 'pending', challengeId: 'ch2', resourceKey: 'ctf2-single-slot', preflight: ['environment_free', 'challenge_unsolved', 'access_ready'] }
  state.tasks = [{ id: 't1', status: 'in_progress', resourceKey: task.resourceKey, assignee: 'worker' }, task]
  assert.match(taskBlockReason(state, task, 100), /held by worker/)
  state.tasks[0].status = 'completed'
  assert.match(taskBlockReason(state, task, 100), /missing\/stale/)
  state.platformSnapshot = { checkedAt: 100, activeEnvironments: 0, challengeId: 'ch2', isSolved: false, accessReady: true }
  assert.equal(taskBlockReason(state, task, 200), undefined)
  assert.match(taskBlockReason(state, task, 60101), /stale/)
  state.platformSnapshot.challengeId = 'ch1'
  assert.match(taskBlockReason(state, task, 200), /another challenge/)
  task.preflight = ['offline_verified']; task.preflightFindingId = 'fd1'
  assert.match(taskBlockReason(state, task), /captain-confirmed/)
  state.findings = [{ id: 'fd1', verifications: [{ result: 'confirmed' }] }]
  assert.equal(taskBlockReason(state, task), undefined)
  assert.throws(() => validatePreflight(['execute arbitrary script']), /unknown preflight/)
})

test('CTF2 adapter calls only allowlisted read operations, handles SSE, preserves unknown state and reports proxy down', async t => {
  const calls = []
  const server = createServer(async (req, res) => {
    if (req.url === '/health') return res.end(JSON.stringify({ service: 'ctf2-mcp-proxy' }))
    let text = ''; for await (const chunk of req) text += chunk
    const request = JSON.parse(text); calls.push(request.params.name)
    const data = request.params.name === 'ctf2_agent_whoami' ? { active_environments: 0 } : request.params.name === 'ctf2_get_practice_challenge' ? { challenge: { is_solved: false } } : { environment: { access_ready: true, status: 'running' } }
    res.end('data: ' + JSON.stringify({ id: request.id, result: { structuredContent: data } }) + '\n\n')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const config = { proxyUrl: 'http://127.0.0.1:' + server.address().port + '/mcp', timeoutMs: 1000 }
  assert.equal((await proxyHealth(config)).up, true)
  const facts = await readPlatformSnapshot(config, 'ground', 'ch')
  assert.equal(facts.targetRunning, true); assert.equal(facts.isSolved, false); assert.equal(facts.activeEnvironments, 0)
  assert.deepEqual(calls, ['ctf2_agent_whoami', 'ctf2_get_practice_challenge', 'ctf2_get_environment'])
  assert.throws(() => proxyUrl({ proxyUrl: 'https://ctf2.dasctf.com/mcp' }), /loopback/)
  await new Promise(resolve => server.close(resolve))
  assert.match((await proxyHealth(config)).state, /unreachable/)
})

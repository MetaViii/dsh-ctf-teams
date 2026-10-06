#!/usr/bin/env node
import { SUBAGENT_DESCRIPTOR_VERSION } from '@deepseek-ai/dsh-subagent'
/**
 * Offline smoke verification for dsh-ctf-teams.
 *
 * Runs the pure team-logic rules, the CTF packaging contract, the round-sync
 * board, and the on-disk persistence flow against throwaway temp state. Requires a prior `pnpm build` (lib/ present). Does not touch
 * any running DSH instance or profile.
 *
 * Usage: node scripts/verify.mjs
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CAPTAIN_KEY,
  appendMailbox,
  createMessage,
  createTeamDir,
  findTeamByCaptain,
  findTeamByParticipant,
  readMailbox,
  readTeam,
  removeTeamDir,
  sanitizeKey,
  teamLockQueueKeys,
  transitionError,
  unsatisfiedDependencies,
  withTeamLock,
} from '../lib/state.js'
import { steerCaptainReport } from '../lib/tools.js'
import { parseProfileInvocation, resolveTeamProfile, formatProfilesForPrompt } from '../lib/profiles.js'
import { TEAM_TOOL_NAMES } from '../lib/tool-names.js'
import { usageSectionText } from '../lib/index.js'
import { memberPersona, memberWelcome } from '../lib/members.js'
import { collectCompletedDependencyOutputs, formatDependencyOutputs, assignmentPrompt } from '../lib/scheduler.js'
import {
  installMemberSelectionRuntime,
  resolveMemberLlmSelection,
  spawnMember,
  validateMemberLlmSelections,
} from '../lib/members.js'

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`)
  } else {
    failures += 1
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

console.log('dsh-ctf-teams offline verification')

// Named multi-role profile rules
const demoProfiles = { ' demo ': { protocol: 'a'.repeat(300), members: [{ name: ' Implementer ', role: 'builder', model: 'm' }, { name: 'Reviewer', model: 'r' }], tasks: [{ id: 'design', subject: 'Design', assignee: 'implementer' }, { id: 'review', subject: 'Review', assignee: ' reviewer ', dependencies: ['design'] }] } }
const normalizedDemo = resolveTeamProfile(demoProfiles, 'demo', 8)
check('profile keys trim and assignees canonicalize', normalizedDemo.members[0].name === 'Implementer' && normalizedDemo.tasks[1].assignee === 'Reviewer')
check('profile tasks are stable topological order', normalizedDemo.tasks[0].id === 'design' && normalizedDemo.tasks[1].id === 'review')
check('profile invocation supports --profile=', parseProfileInvocation('--profile=demo ship it').profile === 'demo' && parseProfileInvocation('--profile=demo ship it').goal === 'ship it')
check('profile invocation leaves mid-goal profile text untouched', parseProfileInvocation('research profile=prod config').goal === 'research profile=prod config')
check('profile prompt omits empty config and truncates protocol', formatProfilesForPrompt(demoProfiles).includes('demo') && formatProfilesForPrompt(demoProfiles).length < 400)
check('seed planning remains the default', normalizedDemo.taskPlanning === 'seed')
check('fixed profile directory includes purpose when no protocol is configured', formatProfilesForPrompt({ named: { description: '  Review\n  the UI  ', members: [{ name: 'reviewer' }] } }).includes('Review the UI'))
const captainPlanned = resolveTeamProfile({
  dynamic: {
    taskPlanning: 'captain',
    members: [{ name: 'analyst', model: 'a' }, { name: 'reviewer', model: 'r' }],
    tasks: [
      { id: 'requirements', subject: 'Requirements', assignee: 'analyst' },
      { id: 'review', subject: 'Review', assignee: 'reviewer', dependencies: ['requirements'] },
    ],
  },
}, 'dynamic', 8)
check('captain planning keeps the roster and drops seed tasks', captainPlanned.taskPlanning === 'captain' && captainPlanned.members.length === 2 && captainPlanned.tasks.length === 0)
check('profile prompt marks captain planning instead of unused seed counts', formatProfilesForPrompt({ dynamic: { taskPlanning: 'captain', members: [{ name: 'solo', model: 'm' }], tasks: [{ id: 'work', subject: 'Work', assignee: 'solo' }] } }).includes('captain planning'))
const profilePersona = memberPersona({ name: 'Demo', id: 'demo', description: 'goal', profile: { name: 'demo', protocol: 'p'.repeat(600) }, captainSessionId: 'c', createdAt: 0, members: [], tasks: [], taskSeq: 0 }, { name: 'Implementer', id: 'm', role: 'builder', joinedAt: 0, status: 'idle' }, '.ctf-teams')
check('member persona includes completed/failed and claimed transition rules', profilePersona.includes('status=completed') && profilePersona.includes('status=failed') && profilePersona.includes('claimed') && profilePersona.includes('in_progress'))
const welcome = memberWelcome({ name: 'Demo', id: 'demo', captainSessionId: 'c', createdAt: 0, members: [], tasks: [{ id: 't1', subject: 'x', status: 'pending', assignee: 'Implementer', dependencies: [], createdAt: 0, updatedAt: 0 }], taskSeq: 1 }, 'Implementer')
check('member welcome reports assigned pending count', welcome.includes('1 pending task(s) assigned to you') && !welcome.includes('none assigned to you yet'))
const truncated = formatDependencyOutputs([
  { id: 't1', subject: 'old', profileSeedId: 'requirements', output: 'x'.repeat(2500) },
  { id: 't2', subject: 'new', profileSeedId: 'implement', output: 'keep-me' },
])
check('dependency outputs truncate and keep the newest seed id',
  truncated.includes('[implement]') && truncated.includes('keep-me') && truncated.includes('[truncated]'))
let cycleWarned = false
const cycled = collectCompletedDependencyOutputs([
  { id: 't1', subject: 'a', status: 'completed', dependencies: ['t2'], createdAt: 0, updatedAt: 0 },
  { id: 't2', subject: 'b', status: 'completed', dependencies: ['t1'], createdAt: 0, updatedAt: 0 },
], 't2', () => { cycleWarned = true })
check('recursive dependency collection stops on cycles', cycleWarned && Array.isArray(cycled))
check('persona protocol is truncated', profilePersona.includes('p'.repeat(400)) && !profilePersona.includes('p'.repeat(401)))
const injected = 'The product interface should present the intended outcome, not reveal the reasoning process.'
const assignment = assignmentPrompt({ taskId: 't1', memberName: 'Implementer', memberId: 'm', attempt: 1, attemptId: 'a', subject: 'x', dependencyOutputs: [], executionPrompt: injected }, '.ctf-teams', 'demo')
check('execution prompt is injected into persona and assignment', assignment.includes(injected) && memberPersona({ name: 'Demo', id: 'demo', description: 'goal', captainSessionId: 'c', createdAt: 0, members: [], tasks: [], taskSeq: 0 }, { name: 'Implementer', id: 'm', role: 'builder', joinedAt: 0, status: 'idle', executionPrompt: injected }, '.ctf-teams').includes(injected))


// The bundle patch's `name` is the specifier Node resolves when a profile
// loads this plugin, so it must equal the published package name. A mismatch
// only surfaces after someone installs the package (the row fails to load),
// never in local link-installed development — hence this pre-publish gate.
console.log('1/6 packaging contract')
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
check('package name is the CTF plugin', pkg.name === '@nanmicoder/dsh-ctf-teams', pkg.name)
// The bundle ships two ordered layers: the host-plane plugin row and the
// selectable `ctf-teams` AGENT PRESET the Harness mode picker lists. A host
// only shows a mode when the declaration row reaches the composition, so the
// preset file must stay declared in `dsh.bundle.patch` — a string-only patch
// field silently drops it.
const bundlePatch = pkg.dsh?.bundle?.patch
const bundlePatchFiles = typeof bundlePatch === 'string' ? [bundlePatch] : bundlePatch
check(
  'dsh.bundle.patch lists the host layer and the preset layer in order',
  Array.isArray(bundlePatchFiles)
    && bundlePatchFiles[0] === './cordis.patch.yml'
    && bundlePatchFiles.includes('./presets/ctf-teams.patch.yml'),
  `patch = ${JSON.stringify(bundlePatch)}`,
)
check(
  'files[] ships the preset layer',
  pkg.files?.includes('presets'),
  `files = ${JSON.stringify(pkg.files)}`,
)
const presetText = await readFile(new URL('../presets/ctf-teams.patch.yml', import.meta.url), 'utf8')
const presetLine = pattern => pattern.test(presetText)
check(
  'preset layer declares the agent-preset row',
  presetLine(/^\s*name:\s*'@deepseek-ai\/dsh-agent-preset'\s*$/m),
  'presets/ctf-teams.patch.yml does not mount @deepseek-ai/dsh-agent-preset',
)
check(
  'preset id and display metadata are present',
  presetLine(/^\s*id:\s*ctf-teams\s*$/m)
    && presetLine(/^\s*name:\s*\S.*$/m)
    && presetLine(/^\s*order:\s*\d+\s*$/m),
  'the preset needs config.id ctf-teams plus name and order for the roster',
)
check(
  'preset composes a full agent plane',
  presetLine(/^\s*plugins:\s*$/m)
    // Without a delegation provider the captain cannot spawn the squad at all.
    && presetLine(/^\s*name:\s*'@deepseek-ai\/dsh-tool-subagent'\s*$/m)
    && presetLine(/^\s*name:\s*'@deepseek-ai\/dsh-persona'\s*$/m)
    && presetLine(/^\s*name:\s*'@deepseek-ai\/dsh-tool-skill'\s*$/m),
  'the preset must carry a persona and the delegation/skill rows a CTF session needs',
)
// The dashboard tab is a real client half: a `conversation.view` contributor
// served as a harness ModuleLoader bundle. A missing export, a non-web
// platform, or a stale bundle all show up as "no tab" in the running app.
const clientPath = pkg.exports?.['./client']?.default
check(
  'exports declares the client bundle',
  clientPath === './lib/client.js',
  `exports["./client"] = ${JSON.stringify(pkg.exports?.['./client'])}`,
)
check(
  'dsh.client declares the web platform',
  pkg.dsh?.client?.platform === 'web',
  `dsh.client = ${JSON.stringify(pkg.dsh?.client)}`,
)
const clientBundle = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
check(
  'client bundle is a harness ModuleLoader unit for this package',
  clientBundle.includes('window.__ModuleLoader__.load({')
    && clientBundle.includes(`id: ${JSON.stringify(pkg.name)}`)
    && clientBundle.includes('return module.exports;'),
  'lib/client.js is not a ModuleLoader bundle for this package',
)
check(
  'client bundle registers the conversation dashboard view',
  clientBundle.includes("'conversation.view'")
    && clientBundle.includes('ctf-teams-dashboard')
    && clientBundle.includes('/plugins/dsh-ctf-teams/state'),
  'the client half must contribute the dashboard view and poll the state route',
)
check('client devDependencies removed', pkg.devDependencies?.['react'] === undefined && pkg.devDependencies?.['tsdown'] === undefined)
check('files[] ships the knowledge assets', pkg.files?.includes('assets/ctf'), JSON.stringify(pkg.files))
const knowledgeDir = new URL('../assets/ctf/knowledge/', import.meta.url)
const knowledgeFiles = (await readdir(knowledgeDir)).sort()
check(
  'knowledge base ships the required topics',
  ['cve-poc.md', 'crypto.md', 'forensics.md', 'kali-tools.md', 'misc.md', 'pwntools.md', 'pwn.md', 'reverse.md', 'sage-math.md', 'volatility3.md', 'web.md'].every(name => knowledgeFiles.includes(name)),
  JSON.stringify(knowledgeFiles),
)
check(
  'tool registry names are the ctf_teams_* API surface',
  ['ctf_teams_create', 'ctf_teams_submit_flag', 'ctf_teams_report_finding', 'ctf_teams_sync', 'ctf_teams_knowledge', 'ctf_teams_mark_flag', 'ctf_teams_set_challenge', 'ctf_teams_env', 'ctf_teams_references', 'ctf_teams_status']
    .every(name => TEAM_TOOL_NAMES.includes(name)),
)
check('usage section teaches the round-sync protocol', usageSectionText('x').includes('ctf_teams_report_finding') && usageSectionText('x').includes('ctf_teams_mark_flag'))
check('usage section pins the writeup completion contract', usageSectionText('x').includes('WRITEUP.md'))
// Auto-run is the shipped default: the captain must create-and-go without ever
// asking for a plan approval, and the two-phase wording must come back when the
// profile sets autoApprove=false.
check('usage section defaults to running the submitted plan immediately',
  usageSectionText('x').includes('approval="automatic"')
  && usageSectionText('x').includes('never stage it')
  && usageSectionText('x').includes('Run to the flag')
  && !usageSectionText('x').includes('approval="required"'),
  'the default protocol still asks for a staged approval')
check('usage section restores the staged gate on request',
  usageSectionText('x', '', { autoApprove: false }).includes('approval="required"')
  && usageSectionText('x', '', { autoApprove: false }).includes('two-phase')
  && !usageSectionText('x', '', { autoApprove: false }).includes('approval="automatic"'))

console.log('2/6 pure rules')
check("sanitizeKey('My Team!') -> 'my-team'", sanitizeKey('My Team!') === 'my-team')
// #15: an ASCII-only whitelist folded every non-Latin name onto one constant,
// so distinct members shared a mailbox file and the second one was rejected as
// a duplicate. Keys must stay distinct for distinct names, in any script.
check("CJK names survive folding", sanitizeKey('研究员') === '研究员')
check(
  'distinct non-Latin names stay distinct',
  sanitizeKey('研究员') !== sanitizeKey('工程师')
    && sanitizeKey('データ分析') !== sanitizeKey('Данные'),
)
check(
  'names with no letters or digits get distinct keys, not a shared constant',
  sanitizeKey('!!!') !== sanitizeKey('🐳') && sanitizeKey('🐳') !== '',
)
check('folding is deterministic', sanitizeKey('🐳') === sanitizeKey('🐳'))
check(
  'long names stay inside the filesystem name limit',
  Buffer.byteLength(`${sanitizeKey('研'.repeat(300))}.jsonl`) < 255,
)
check(
  'long names sharing a prefix stay distinct',
  sanitizeKey(`${'研'.repeat(60)}a`) !== sanitizeKey(`${'研'.repeat(60)}b`),
)
check(
  'keys stay a single safe path segment',
  !/[\\/:*?"<>|]/.test(sanitizeKey('a/b\\c:d*e?f"g<h>i|j')) && !sanitizeKey('../../etc').includes('.'),
)
check('pending -> claimed allowed', transitionError('pending', 'claimed') === undefined)
check('pending -> in_progress denied', transitionError('pending', 'in_progress') !== undefined)
check('in_progress -> completed allowed', transitionError('in_progress', 'completed') === undefined)
check('completed -> in_progress denied', transitionError('completed', 'in_progress') !== undefined)
check('same status is a no-op', transitionError('failed', 'failed') === undefined)

console.log('3/6 dependency gating')
const tasks = [
  { id: 't1', status: 'completed' },
  { id: 't2', status: 'pending' },
  { id: 't3', status: 'failed' },
]
check('all-done deps satisfied', unsatisfiedDependencies(tasks, ['t1']).length === 0)
check('pending dep blocks', unsatisfiedDependencies(tasks, ['t2']).length === 1)
check('failed dep blocks too', unsatisfiedDependencies(tasks, ['t3']).length === 1)

console.log('4/6 on-disk team flow (temp dir)')
const stateRoot = await mkdtemp(join(tmpdir(), 'dsh-ctf-teams-verify-'))
try {
  const team = {
    name: 'Verify Team',
    id: sanitizeKey('Verify Team'),
    description: 'smoke',
    captainSessionId: 'sess-captain',
    createdAt: Date.now(),
    members: [
      { id: 'sess-member', name: 'alice', joinedAt: Date.now(), status: 'idle' },
      { id: 'sess-removed', name: 'former', joinedAt: Date.now(), status: 'removed' },
    ],
    tasks: [],
    taskSeq: 0,
  }
  await createTeamDir(stateRoot, team)

  const reread = await readTeam(stateRoot, team.id)
  check('team.json round-trips', reread?.id === team.id && reread.captainSessionId === 'sess-captain')

  await writeFile(join(stateRoot, team.id, 'team.json'), `\uFEFF${JSON.stringify(team, null, 2)}`, 'utf8')
  check('team.json accepts a UTF-8 BOM', (await readTeam(stateRoot, team.id))?.id === team.id)

  const dirty = {
    ...team,
    id: 'dirty-profile',
    profile: { name: '' },
    tasks: [{
      id: 't1',
      subject: 'legacy',
      status: 'pending',
      dependencies: [],
      profileSeedId: '   ',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }],
    taskSeq: 1,
  }
  await mkdir(join(stateRoot, dirty.id, 'inbox'), { recursive: true })
  await writeFile(join(stateRoot, dirty.id, 'team.json'), JSON.stringify(dirty, null, 2), 'utf8')
  const recovered = await readTeam(stateRoot, dirty.id)
  check('cold-resume ignores dirty optional profile and seed id',
    recovered?.id === dirty.id && recovered.profile === undefined && recovered.tasks[0]?.profileSeedId === undefined)
  await removeTeamDir(stateRoot, dirty.id)

  // Regression for #105: a task persisted with model-materialized blank
  // optional fields (e.g. reviewedTaskId:"") used to brick the whole team on
  // reload. The durable boundary must normalize blanks to omitted instead,
  // while keeping non-blank optional values intact.
  const dirtyQuality = {
    ...team,
    id: 'dirty-quality-fields',
    tasks: [
      {
        id: 't1',
        subject: 'Review impl',
        kind: 'review',
        status: 'pending',
        dependencies: [],
        reviewedTaskId: 't2',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        id: 't2',
        subject: 'Repair with blanks',
        kind: 'repair',
        status: 'pending',
        dependencies: [],
        sourceTaskId: 't1',
        sourceFindingIds: [''],
        reviewedTaskId: '',
        objective: '',
        inScope: ['', 'src/repair.ts'],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ],
    taskSeq: 2,
  }
  await mkdir(join(stateRoot, dirtyQuality.id, 'inbox'), { recursive: true })
  await writeFile(join(stateRoot, dirtyQuality.id, 'team.json'), JSON.stringify(dirtyQuality, null, 2), 'utf8')
  const recoveredQuality = await readTeam(stateRoot, dirtyQuality.id)
  const repairedTask = recoveredQuality?.tasks.find((item) => item.id === 't2')
  check('cold-resume recovers blank optional quality fields (#105)',
    recoveredQuality?.id === dirtyQuality.id
      && repairedTask?.reviewedTaskId === undefined
      && repairedTask?.objective === undefined
      && repairedTask?.sourceFindingIds === undefined
      && JSON.stringify(repairedTask?.inScope) === JSON.stringify(['src/repair.ts']))
  check('cold-resume keeps non-blank optional quality fields (#105)',
    recoveredQuality?.tasks.find((item) => item.id === 't1')?.reviewedTaskId === 't2')
  await removeTeamDir(stateRoot, dirtyQuality.id)

  // Recovery only removes blank strings. Other malformed values must still
  // fail durable validation rather than silently erasing contract/scope data.
  for (const [field, values] of [
    ['acceptance', [123, 'real criterion']],
    ['outOfScope', [{ path: 'src/private/' }]],
    ['sourceFindingIds', [null]],
  ]) {
    const malformed = {
      ...dirtyQuality,
      id: `malformed-${field.toLowerCase()}`,
      tasks: [{ ...dirtyQuality.tasks[1], [field]: values }],
    }
    await createTeamDir(stateRoot, malformed)
    let rejected = false
    try { await readTeam(stateRoot, malformed.id) }
    catch (error) { rejected = /invalid CTFTeams state/.test(String(error)) }
    check(`cold-resume rejects non-string ${field} items`, rejected)
    await removeTeamDir(stateRoot, malformed.id)
  }

  const found = await findTeamByCaptain(stateRoot, 'sess-captain')
  check('findTeamByCaptain finds the team', found?.id === team.id)
  check('findTeamByCaptain ignores other captains', await findTeamByCaptain(stateRoot, 'sess-other') === undefined)
  check('findTeamByParticipant finds the captain', (await findTeamByParticipant(stateRoot, 'sess-captain'))?.id === team.id)
  check('findTeamByParticipant finds an active member', (await findTeamByParticipant(stateRoot, 'sess-member'))?.id === team.id)
  check('findTeamByParticipant rejects a removed member', await findTeamByParticipant(stateRoot, 'sess-removed') === undefined)

  const escapedContent = String.raw`save to notes\foo.md`
  const message = createMessage('alice', CAPTAIN_KEY, escapedContent)
  await withTeamLock(team.id, async () => {
    await appendMailbox(stateRoot, team.id, CAPTAIN_KEY, message)
  })
  const second = createMessage('bob', CAPTAIN_KEY, 'valid after BOM')
  const mailboxFile = join(stateRoot, team.id, 'inbox', `${CAPTAIN_KEY}.jsonl`)
  await writeFile(
    mailboxFile,
    `\uFEFF${JSON.stringify(second)}\n${String.raw`{"broken":"notes\q.md"}`}\n{}\n`,
    { encoding: 'utf8', flag: 'a' },
  )
  const malformedLines = []
  const inbox = await readMailbox(
    stateRoot,
    team.id,
    CAPTAIN_KEY,
    (lineNumber) => malformedLines.push(lineNumber),
  )
  check('mailbox append/read preserves backslashes', inbox[0]?.content === escapedContent)
  check('mailbox accepts BOM-prefixed JSONL records', inbox[1]?.content === second.content)
  check('mailbox skips malformed JSON and malformed shapes', inbox.length === 2 && malformedLines.join(',') === '3,4')
  check('missing mailbox reads empty', (await readMailbox(stateRoot, team.id, 'nobody')).length === 0)

  // The per-team lock queue must stay serial, hand off to later waiters, and
  // must not leak one resolved promise chain per key after the last waiter.
  const serialKey = 'lock-cleanup:serial'
  const order = []
  let inside = 0
  let maxInside = 0
  await Promise.all(Array.from({ length: 25 }, (_, index) => withTeamLock(serialKey, async () => {
    inside += 1
    maxInside = Math.max(maxInside, inside)
    order.push(index)
    await new Promise((resolve) => setTimeout(resolve, index % 3 === 0 ? 5 : 1))
    inside -= 1
  })))
  check('withTeamLock keeps same-key workers strictly serial and ordered',
    maxInside === 1 && order.join(',') === Array.from({ length: 25 }, (_, index) => index).join(','))
  check('withTeamLock queue entry drains after the last waiter settles',
    !teamLockQueueKeys().includes(serialKey))

  const handoffKey = 'lock-cleanup:handoff'
  let releaseHold
  const heldGate = new Promise((resolve) => { releaseHold = resolve })
  let successorEntered = false
  const hold = withTeamLock(handoffKey, async () => { await heldGate })
  const successor = withTeamLock(handoffKey, async () => { successorEntered = true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  check('withTeamLock keeps its queue entry while the lock is held or handed off',
    teamLockQueueKeys().includes(handoffKey))
  releaseHold()
  await Promise.all([hold, successor])
  check('withTeamLock wakes the queued successor and drops the key afterwards',
    successorEntered && !teamLockQueueKeys().includes(handoffKey))

  const duplicateCaptain = { ...team, id: 'duplicate-captain', members: [] }
  await createTeamDir(stateRoot, duplicateCaptain)
  let duplicateCaptainRejected = false
  try {
    await findTeamByCaptain(stateRoot, 'sess-captain')
  } catch {
    duplicateCaptainRejected = true
  }
  check('multiple teams for one captain fail as ambiguous', duplicateCaptainRejected)
  await removeTeamDir(stateRoot, duplicateCaptain.id)

  const duplicateMember = { ...team, id: 'duplicate-member', captainSessionId: 'sess-other-captain' }
  await createTeamDir(stateRoot, duplicateMember)
  let duplicateMemberRejected = false
  try {
    await findTeamByParticipant(stateRoot, 'sess-member')
  } catch {
    duplicateMemberRejected = true
  }
  check('multiple teams for one member fail as ambiguous', duplicateMemberRejected)
  await removeTeamDir(stateRoot, duplicateMember.id)

  const invalidId = 'invalid-shape'
  await mkdir(join(stateRoot, invalidId), { recursive: true })
  await writeFile(join(stateRoot, invalidId, 'team.json'), '{}', 'utf8')
  let invalidShapeRejected = false
  try {
    await readTeam(stateRoot, invalidId)
  } catch {
    invalidShapeRejected = true
  }
  check('invalid team.json shape is rejected at the durable boundary', invalidShapeRejected)
  await removeTeamDir(stateRoot, invalidId)

  await removeTeamDir(stateRoot, team.id)
  check('removeTeamDir removes the team', await readTeam(stateRoot, team.id) === undefined)

  // Archive keeps the team data for post-delete review.
  const archiveTeam = { ...team, id: sanitizeKey('Archive Team') }
  await createTeamDir(stateRoot, archiveTeam)
  const { archiveTeamDir, readArchivedTeam, listArchivedTeamIds } = await import('../lib/state.js')
  await archiveTeamDir(stateRoot, archiveTeam.id)
  check('archive moves the team out of live scan', await readTeam(stateRoot, archiveTeam.id) === undefined)
  check('archive keeps team.json readable', (await readArchivedTeam(stateRoot, archiveTeam.id))?.id === archiveTeam.id)
  check('archive lists the team id', (await listArchivedTeamIds(stateRoot)).includes(archiveTeam.id))
  check('archive dir skips live readTeam', await readTeam(stateRoot, 'archive') === undefined)
} finally {
  await rm(stateRoot, { recursive: true, force: true })
}

console.log('5/6 member model selection and continuation restore')
const captain = {
  id: 'captain-session',
  options: { provider: 'birth-provider', model: 'birth-model' },
  session: {
    requestHeader: () => ({
      config: {
        provider: 'captain-provider',
        model: 'captain-model',
        reasoningEffort: 'max',
      },
    }),
  },
}
const resolvedCalls = []
const routeDefaultEfforts = new Map([
  ['captain-provider/captain-model', 'high'],
  ['captain-provider/configured-member-model', 'medium'],
  ['other-provider/other-model', 'low'],
])
const selectionContext = {
  llm: {
    resolveCallConfig: async (config) => {
      resolvedCalls.push(config)
      const route = `${config.provider}/${config.model}`
      if (route !== 'captain-provider/captain-model' && config.reasoningEffort === 'max') {
        const error = new Error(`provider/model route ${route} does not support reasoning effort "max"`)
        error.code = 'UNSUPPORTED_REASONING_EFFORT'
        throw error
      }
      const defaultEffort = routeDefaultEfforts.get(route)
      return config.reasoningEffort !== undefined || defaultEffort === undefined
        ? config
        : { ...config, reasoningEffort: defaultEffort }
    },
  },
}
const inheritedSelection = await resolveMemberLlmSelection(selectionContext, captain, {})
check(
  'ordinary member snapshots the captain current route and effort',
  inheritedSelection.provider === 'captain-provider'
    && inheritedSelection.model === 'captain-model'
    && inheritedSelection.reasoningEffort === 'max',
)
const overriddenSelection = await resolveMemberLlmSelection(selectionContext, captain, {
  provider: 'other-provider',
  model: 'other-model',
})
check(
  'cross-provider route uses the target model default instead of captain effort',
  overriddenSelection.provider === 'other-provider'
    && overriddenSelection.model === 'other-model'
    && overriddenSelection.reasoningEffort === 'low'
    && resolvedCalls.at(-1)?.reasoningEffort === undefined,
)
const defaultedSelection = await resolveMemberLlmSelection(selectionContext, captain, {
  defaultModel: 'configured-member-model',
})
check(
  'plugin memberModel route uses that target model default effort',
  defaultedSelection.provider === 'captain-provider'
    && defaultedSelection.model === 'configured-member-model'
    && defaultedSelection.reasoningEffort === 'medium'
    && resolvedCalls.at(-1)?.reasoningEffort === undefined,
)
const explicitEffortSelection = await resolveMemberLlmSelection(selectionContext, captain, {
  provider: 'other-provider',
  model: 'other-model',
  reasoningEffort: 'high',
})
check(
  'explicit member effort overrides cross-provider target default',
  explicitEffortSelection.reasoningEffort === 'high'
    && resolvedCalls.at(-1)?.reasoningEffort === 'high',
)
const forcedDefaultSelection = await resolveMemberLlmSelection(selectionContext, captain, {
  reasoningEffort: 'default',
})
check(
  'default sentinel opts out of same-route captain effort inheritance',
  forcedDefaultSelection.provider === 'captain-provider'
    && forcedDefaultSelection.model === 'captain-model'
    && forcedDefaultSelection.reasoningEffort === 'high'
    && resolvedCalls.at(-1)?.reasoningEffort === undefined,
)
let providerWithoutModelRejected = false
try {
  await resolveMemberLlmSelection(selectionContext, captain, { provider: 'other-provider' })
} catch {
  providerWithoutModelRejected = true
}
check('explicit provider without model is rejected', providerWithoutModelRejected)
let emptyEffortRejected = false
try {
  await resolveMemberLlmSelection(selectionContext, captain, { reasoningEffort: '  ' })
} catch {
  emptyEffortRejected = true
}
check('empty explicit reasoning effort is rejected', emptyEffortRejected)

let catalogCalls = 0
await validateMemberLlmSelections({
  llm: {
    async listModels(provider) {
      catalogCalls += 1
      return [{ provider, id: 'known-model', name: 'Known model' }]
    },
  },
}, [
  { provider: 'known-provider', model: 'known-model' },
  { provider: 'known-provider', model: 'known-model' },
])
check('approval model preflight caches one catalog lookup per provider', catalogCalls === 1)
let unknownCatalogModelRejected = false
try {
  await validateMemberLlmSelections({
    llm: {
      async listModels(provider) {
        return [{ provider, id: 'known-model', name: 'Known model' }]
      },
    },
  }, [{ provider: 'known-provider', model: 'typo-model' }])
} catch (error) {
  unknownCatalogModelRejected = /unknown member model.*typo-model/i.test(String(error?.message ?? error))
}
check('approval model preflight rejects an unlisted typo before spawn', unknownCatalogModelRejected)

let startSpec
const spawnMemberRecord = {
  id: '',
  name: 'backend',
  role: 'engineer',
  provider: overriddenSelection.provider,
  model: overriddenSelection.model,
  reasoningEffort: overriddenSelection.reasoningEffort,
  joinedAt: Date.now(),
  status: 'idle',
}
const spawnTeam = {
  name: 'Spawn Verify',
  id: 'spawn-verify',
  captainSessionId: captain.id,
  createdAt: Date.now(),
  members: [],
  tasks: [],
  taskSeq: 0,
}
await spawnMember(
  {
    subagents: {
      getProvider: () => ({
        prepareContinuable: () => undefined,
        capabilities: { persona: true, toolFilter: true },
      }),
      list: () => ['spawn'],
      startContinuable: async (spec) => {
        startSpec = spec
        return { childId: 'spawned-member', messageId: 'welcome-message' }
      },
    },
  },
  { provider: 'spawn', maxDepth: 1 },
  {
    withPending: async (_parentId, _label, _selection, operation) => operation(),
  },
  overriddenSelection,
  captain,
  spawnTeam,
  spawnMemberRecord,
  '.ctf-teams',
  new AbortController().signal,
)
check(
  '#20: spawn receives the resolved per-member provider and model',
  startSpec?.request?.agentOptions?.provider === 'other-provider'
    && startSpec?.request?.agentOptions?.model === 'other-model'
    && spawnMemberRecord.id === 'spawned-member',
)

function descriptorEvent(label, agentProvider = 'descriptor-provider', agentModel = 'descriptor-model') {
  return {
    type: 'subagent/descriptor',
    data: {
      version: SUBAGENT_DESCRIPTOR_VERSION,
      mode: 'continuable',
      provider: 'spawn',
      label,
      agentProvider,
      agentModel,
    },
  }
}

function fakeChildContext({ label, parentSessionId, cwd, agentProvider, agentModel }) {
  const listeners = new Map()
  return {
    listeners,
    context: {
      agent: {
        session: {
          header: { parentSession: parentSessionId, cwd, seedLength: 0 },
          events: [descriptorEvent(label, agentProvider, agentModel)],
        },
      },
      on(name, listener) {
        listeners.set(name, listener)
        return () => listeners.delete(name)
      },
    },
  }
}

async function routedConfig(child) {
  const assemble = child.listeners.get('system-prompt/assemble')
  const request = child.listeners.get('agent/request')
  await assemble({}, {}, async () => ({ variables: {} }))
  return request({}, async () => ({
    provider: 'unselected-provider',
    model: 'unselected-model',
    reasoningEffort: 'low',
  }))
}

let setupMemberSelection
const selectionRuntime = installMemberSelectionRuntime({
  subagents: {
    registerContinuableSetup: (setup) => {
      setupMemberSelection = setup
      return () => undefined
    },
  },
}, '.ctf-teams')
const freshChild = fakeChildContext({
  label: 'ctf-teams:fresh-team:backend',
  parentSessionId: 'captain-session',
  cwd: process.cwd(),
})
let disposeFresh
await selectionRuntime.withPending(
  'captain-session',
  'ctf-teams:fresh-team:backend',
  overriddenSelection,
  async () => {
    disposeFresh = setupMemberSelection(freshChild.context)
  },
)
const freshRoute = await routedConfig(freshChild)
check(
  'fresh child request receives the resolved reasoning effort',
  freshRoute.provider === 'other-provider'
    && freshRoute.model === 'other-model'
    && freshRoute.reasoningEffort === 'low',
)
disposeFresh()

const restoreWorkspace = await mkdtemp(join(tmpdir(), 'dsh-ctf-teams-selection-'))
try {
  const restoreStateRoot = join(restoreWorkspace, '.ctf-teams')
  await createTeamDir(restoreStateRoot, {
    name: 'Restore Team',
    id: 'restore-team',
    captainSessionId: 'captain-session',
    createdAt: Date.now(),
    members: [{
      id: 'cold-member',
      name: 'reviewer',
      provider: 'cold-provider',
      model: 'cold-model',
      reasoningEffort: 'high',
      joinedAt: Date.now(),
      status: 'idle',
    }],
    tasks: [],
    taskSeq: 0,
  })
  const coldChild = fakeChildContext({
    label: 'ctf-teams:restore-team:reviewer',
    parentSessionId: 'captain-session',
    cwd: restoreWorkspace,
    agentProvider: 'cold-provider',
    agentModel: 'cold-model',
  })
  const disposeCold = setupMemberSelection(coldChild.context)
  const coldRoute = await routedConfig(coldChild)
  check(
    'cold-resumed child restores provider, model, and reasoning from team.json',
    coldRoute.provider === 'cold-provider'
      && coldRoute.model === 'cold-model'
      && coldRoute.reasoningEffort === 'high',
  )
  disposeCold()
} finally {
  await rm(restoreWorkspace, { recursive: true, force: true })
}

console.log('6/6 state-file atomic write hardening (Windows EPERM fallback)')
// The durable state files (team.json, mailboxes, retired index) are replaced
// through `atomicWriteText` = write-temp + rename. On Windows a rename over an
// existing target throws EPERM while another process holds it open without
// FILE_SHARE_DELETE; the hardened path retries the rename a few times and then
// degrades to a direct overwrite (content-equivalent because the temp file was
// fully written). These checks pin that behavior through the injectable seam
// and, on Windows, against a real cross-process handle lock.
const atomicStateRoot = await mkdtemp(join(tmpdir(), 'dsh-ctf-teams-atomic-'))
try {
  const {
    replaceFileAtomicOrDirect,
    writeTeam,
  } = await import('../lib/state.js')
  const epermError = () => Object.assign(
    new Error("EPERM: operation not permitted, rename '.../team.json.tmp' -> '.../team.json'"),
    { code: 'EPERM' },
  )

  let renameCalls = 0
  let fallbackWrites = 0
  let fallbackRemovals = 0
  let fallbackContent = ''
  const fallbackTarget = join(atomicStateRoot, 'forced', 'team.json')
  await replaceFileAtomicOrDirect('forced.tmp', fallbackTarget, '{"fallback":1}', {
    rename: async () => { renameCalls += 1; throw epermError() },
    writeFile: async (_file, content) => { fallbackWrites += 1; fallbackContent = content },
    remove: async () => { fallbackRemovals += 1 },
  }, { retryDelayMs: 1 })
  check(
    'persistent EPERM exhausts the rename retries (1 initial + 3 retries)',
    renameCalls === 4,
    `renameCalls = ${renameCalls}`,
  )
  check(
    'persistent EPERM falls back to a direct overwrite of the target',
    fallbackWrites === 1 && fallbackContent === '{"fallback":1}',
    `fallbackWrites = ${fallbackWrites}`,
  )
  check('the temp file is removed after the fallback write', fallbackRemovals === 1)

  let transientCalls = 0
  let transientWrites = 0
  await replaceFileAtomicOrDirect('transient.tmp', join(atomicStateRoot, 'transient', 'team.json'), '{"retried":2}', {
    rename: async () => {
      transientCalls += 1
      if (transientCalls <= 2) throw epermError()
    },
    writeFile: async (file, content) => { transientWrites += 1; await writeFile(file, content) },
    remove: async () => undefined,
  }, { retryDelayMs: 1 })
  check(
    'a transient EPERM recovers via rename retries without the fallback',
    transientCalls === 3 && transientWrites === 0,
    `renameCalls = ${transientCalls}, fallbackWrites = ${transientWrites}`,
  )

  let aggregateThrown = false
  let dualRemovals = 0
  try {
    await replaceFileAtomicOrDirect('dual.tmp', join(atomicStateRoot, 'dual', 'team.json'), 'x', {
      rename: async () => { throw epermError() },
      writeFile: async () => { throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' }) },
      remove: async () => { dualRemovals += 1 },
    }, { retryDelayMs: 1 })
  } catch (error) {
    aggregateThrown = error instanceof AggregateError
  }
  check('failure of both the atomic and the direct path raises AggregateError', aggregateThrown)
  check('the temp file is removed even after a dual failure', dualRemovals === 1)

  if (process.platform === 'win32') {
    // Real cross-process lock: hold team.json with FileShare.ReadWrite (no
    // FILE_SHARE_DELETE) from a child .NET handle, then verify the public
    // write path still persists through the direct-write fallback.
    const lockedTeam = {
      name: 'Locked Team',
      id: 'locked-team',
      captainSessionId: 'sess-lock',
      createdAt: Date.now(),
      members: [],
      tasks: [],
      taskSeq: 0,
    }
    await createTeamDir(atomicStateRoot, lockedTeam)
    const lockedJson = join(atomicStateRoot, lockedTeam.id, 'team.json')
    const { spawn } = await import('node:child_process')
    const holder = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        `$f = '${lockedJson.replaceAll("'", "''")}';
         $s = [System.IO.File]::Open($f, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite);
         [Console]::Out.WriteLine('HELD'); [Console]::Out.Flush();
         Start-Sleep -Seconds 45; $s.Dispose()`],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    )
    const held = await new Promise((resolve, reject) => {
      let buffer = ''
      const onData = (chunk) => {
        buffer += chunk.toString()
        if (buffer.includes('HELD')) { cleanup(); resolve(true) }
      }
      const onExit = () => { cleanup(); reject(new Error('lock holder exited before arming')) }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error('timed out waiting for the lock holder'))
      }, 15_000)
      function cleanup() {
        clearTimeout(timer)
        holder.stdout.off('data', onData)
        holder.off('exit', onExit)
      }
      holder.stdout.on('data', onData)
      holder.on('exit', onExit)
    })
    try {
      if (held) {
        lockedTeam.members.push({ id: 'sess-new', name: 'member', joinedAt: Date.now(), status: 'idle' })
        await writeTeam(atomicStateRoot, lockedTeam)
        const persisted = JSON.parse(await readFile(lockedJson, 'utf8'))
        const leftovers = (await readdir(join(atomicStateRoot, lockedTeam.id))).filter(name => name.endsWith('.tmp'))
        check(
          'writeTeam survives a real Windows lock without FILE_SHARE_DELETE',
          persisted.members.length === 1 && leftovers.length === 0,
          `members = ${persisted.members.length}, tmp leftovers = ${leftovers.join(', ') || 'none'}`,
        )
      }
      // Archive moves the whole team directory with `rename(source, target)`.
      // The same Windows delete-sharing EPERM applies when a file below the
      // directory is momentarily locked, so it retries the rename. Release
      // the real lock only after observing the first OS rename rejection;
      // PowerShell startup/scheduling must not race a 150 ms retry budget.
      const { archiveTeamDir } = await import('../lib/state.js')
      const transientTeam = {
        name: 'Transient Lock Team',
        id: 'transient-lock',
        captainSessionId: 'sess-transient',
        createdAt: Date.now(),
        members: [],
        tasks: [],
        taskSeq: 0,
      }
      await createTeamDir(atomicStateRoot, transientTeam)
      const transientJson = join(atomicStateRoot, transientTeam.id, 'team.json')
      const transientSource = join(atomicStateRoot, transientTeam.id)
      const flasher = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command',
          `$f = '${transientJson.replaceAll("'", "''")}';
           $s = [System.IO.File]::Open($f, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::ReadWrite);
           [Console]::Out.WriteLine('HELD_T'); [Console]::Out.Flush();
           [void][Console]::In.ReadLine(); $s.Dispose();
           [Console]::Out.WriteLine('RELEASED_T'); [Console]::Out.Flush()`],
        { stdio: ['pipe', 'pipe', 'inherit'] },
      )
      const waitForMarker = (marker, trigger = () => {}) => new Promise((resolve, reject) => {
        let buffer = ''
        const onData = (chunk) => {
          buffer += chunk.toString()
          if (buffer.includes(marker)) { cleanup(); resolve(true) }
        }
        const onError = (error) => { cleanup(); reject(error) }
        const onExit = () => { cleanup(); reject(new Error(`transient holder exited before ${marker}`)) }
        const timer = setTimeout(() => {
          cleanup()
          reject(new Error(`timed out waiting for transient lock marker ${marker}`))
        }, 10_000)
        function cleanup() {
          clearTimeout(timer)
          flasher.stdout.off('data', onData)
          flasher.off('exit', onExit)
          flasher.off('error', onError)
          flasher.stdin.off('error', onError)
        }
        flasher.stdout.on('data', onData)
        flasher.on('exit', onExit)
        flasher.on('error', onError)
        flasher.stdin.on('error', onError)
        trigger()
      })
      const fsPromises = (await import('node:fs/promises')).default
      const { syncBuiltinESMExports } = await import('node:module')
      const originalRename = fsPromises.rename
      let archiveRenameCalls = 0
      let observedLockRejection = false
      try {
        const flashed = await waitForMarker('HELD_T')
        // Delegate every attempt to the real filesystem. Only coordinate
        // release after the first actual sharing violation, then rethrow that
        // same error so archiveTeamDir itself must perform the retry.
        fsPromises.rename = async (from, to) => {
          if (from !== transientSource) return originalRename(from, to)
          archiveRenameCalls += 1
          try {
            return await originalRename(from, to)
          } catch (error) {
            if (!observedLockRejection && ['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) {
              observedLockRejection = true
              await waitForMarker('RELEASED_T', () => flasher.stdin.end('release\n'))
            }
            throw error
          }
        }
        syncBuiltinESMExports()
        await archiveTeamDir(atomicStateRoot, transientTeam.id)
        const archived = await readFile(join(atomicStateRoot, 'archive', transientTeam.id, 'team.json'), 'utf8')
        check(
          'archiveTeamDir survives a transient Windows directory lock via rename retries',
          flashed && observedLockRejection && archiveRenameCalls >= 2
            && JSON.parse(archived).id === transientTeam.id,
          `observed real lock = ${observedLockRejection}, rename attempts = ${archiveRenameCalls}`,
        )
      } catch (error) {
        check(
          'archiveTeamDir survives a transient Windows directory lock via rename retries',
          false,
          String(error),
        )
      } finally {
        fsPromises.rename = originalRename
        syncBuiltinESMExports()
        flasher.kill()
        if (flasher.exitCode === null && flasher.signalCode === null) {
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 5_000)
            flasher.once('exit', () => { clearTimeout(timer); resolve() })
          })
        }
      }
    } finally {
      holder.kill()
      if (holder.exitCode === null && holder.signalCode === null) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 5_000)
          holder.once('exit', () => { clearTimeout(timer); resolve() })
        })
      }
    }
  } else {
    check('real Windows lock integration skipped on this platform', true)
  }
} finally {
  await rm(atomicStateRoot, { recursive: true, force: true }).catch(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    await rm(atomicStateRoot, { recursive: true, force: true })
  })
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('\nall checks passed')

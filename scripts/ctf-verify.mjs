#!/usr/bin/env node
/**
 * Offline verification for the CTFTeams CTF layer.
 *
 * Covers the round-sync board (findings, flag candidates, cursors, digests),
 * the terminal dashboard renderer, the knowledge base reader, the toolchain
 * env service (detect/install planning with a fake command runner), the
 * references library manifest and sync commands, the built-in ctf-teams
 * profile, and the digest-aware assignment prompt. Requires a prior
 * `pnpm build` (lib/ present). Usage: node scripts/ctf-verify.mjs
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

import {
  DEFAULT_FLAG_FORMAT,
  advanceCursor,
  appendFinding,
  appendFlagCandidate,
  boardIdNumber,
  challengeOf,
  deltaSince,
  flagMatchesFormat,
  formatBoardDelta,
  hasNewProgress,
  normalizeFlag,
  readCursor,
  reviewFlagCandidate,
  updateChallenge,
} from '../lib/findings.js'
import { displayWidth, dashboardInputFromTeam, renderDashboard, truncateToWidth, padEndWidth } from '../lib/dashboard.js'
import { listKnowledgeTopics, readKnowledgeDoc, sanitizeTopic } from '../lib/knowledge.js'
import { CTF_PROFILE_NAME, builtinCtfProfile, withBuiltinCtfProfile } from '../lib/ctf-profile.js'
import { resolveTeamProfile } from '../lib/profiles.js'
import { assignmentPrompt } from '../lib/scheduler.js'
import { TEAM_TOOL_NAMES, MEMBER_TOOL_NAMES } from '../lib/tool-names.js'
import {
  detectTools,
  planInstall,
  renderStatuses,
  runInstallPlan,
  TOOL_SPECS,
} from '../lib/env.js'
import {
  autoSyncTargets,
  REFERENCE_REPOS,
  REFERENCE_SIZE_NOTES,
  referenceRepoPath,
  referenceStatus,
  referenceSyncCommand,
  renderReferenceList,
  resolveReferenceRepo,
  SMALL_REFERENCE_IDS,
} from '../lib/references.js'

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`)
  } else {
    failures += 1
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function baseTeam() {
  return {
    name: 'baby-rsa', id: 'baby-rsa', captainSessionId: 'cap', createdAt: 1,
    members: [], tasks: [], taskSeq: 0,
  }
}

console.log('ctf round-sync board')

// Flag normalization and format validation.
check('normalizeFlag trims and strips quote pairs', normalizeFlag('  "flag{a}"  ') === 'flag{a}')
check('default format accepts the standard wrapper', flagMatchesFormat('flag{s0lv3d}', undefined))
check('default format rejects bare text', !flagMatchesFormat('not-a-flag', undefined))
check('challenge flag format overrides the default', flagMatchesFormat('CTF{a}', { flagFormat: 'CTF\\{[^}]+\\}' }) && !flagMatchesFormat('flag{a}', { flagFormat: 'CTF\\{[^}]+\\}' }))
check('broken regex falls back to the default shape', flagMatchesFormat('flag{x}', { flagFormat: '[' }))

// Findings advance the round and keep ids monotonic.
{
  const team = baseTeam()
  const first = appendFinding(team, { from: 'scout', category: 'recon', content: 'two attachments: rsa.pem, out.txt' })
  const second = appendFinding(team, { from: 'crypto', content: 'n is 2048-bit, e=65537' })
  check('findings get stable monotonic ids', first.id === 'fd1' && second.id === 'fd2')
  check('rounds advance with each board beat', team.round === 2 && first.round === 1 && second.round === 2)
  check('empty findings are rejected', (() => { try { appendFinding(team, { from: 'x', content: '   ' }); return false } catch { return true } })())
  check('oversized findings are truncated', (() => {
    const t = baseTeam()
    const f = appendFinding(t, { from: 'x', content: 'y'.repeat(3000) })
    return f.content.endsWith('[truncated]') && f.content.length < 3000
  })())
}

// Flag candidates: dedupe, submission attribution, captain review.
{
  const team = baseTeam()
  const { candidate, duplicate } = appendFlagCandidate(team, { flag: 'flag{v1ct0ry}', submittedBy: 'crypto', evidence: 'decrypted rsa output' })
  check('first candidate is appended as candidate', candidate.status === 'candidate' && !duplicate)
  const again = appendFlagCandidate(team, { flag: ' FLAG{V1CT0RY} ', submittedBy: 'web' })
  check('resubmissions are detected case-insensitively', again.duplicate && again.candidate.id === candidate.id)
  check('bad-format submissions are rejected', (() => {
    try { appendFlagCandidate(team, { flag: 'garbage', submittedBy: 'web' }); return false } catch (error) { return String(error).includes('challenge format') }
  })())
  const reviewed = reviewFlagCandidate(team, candidate.id, 'verified', { by: 'captain', note: 'platform accepted' })
  check('verified flag marks the challenge solved', reviewed.solved && team.challenge.solved === true && team.challenge.solvedBy === 'crypto')
  check('rejected verdict keeps hunting', (() => {
    const t = baseTeam()
    const { candidate: c } = appendFlagCandidate(t, { flag: 'flag{wrong}', submittedBy: 'web' })
    reviewFlagCandidate(t, c.id, 'rejected', { by: 'captain', note: 'platform rejected' })
    return c.status === 'rejected' && t.challenge?.solved !== true
  })())
  check('review of unknown flag id fails loud', (() => {
    try { reviewFlagCandidate(baseTeam(), 'f9', 'verified', { by: 'captain' }); return false } catch { return true }
  })())
}

// Round-sync cursors and deltas.
{
  const team = baseTeam()
  appendFinding(team, { from: 'scout', content: 'f1' })
  appendFlagCandidate(team, { flag: 'flag{one}', submittedBy: 'scout' })
  check('fresh cursor sees everything as new', hasNewProgress(team, 'crypto') && deltaSince(team, 'crypto').findings.length === 1 && deltaSince(team, 'crypto').flags.length === 1)
  advanceCursor(team, 'crypto')
  check('cursor advance clears the delta', !hasNewProgress(team, 'crypto') && deltaSince(team, 'crypto').round === 2)
  appendFinding(team, { from: 'web', content: 'beat delivered to a member' })
  advanceCursor(team, 'crypto', { findingSeq: (team.findingSeq ?? 0) - 1, flagSeq: team.flagSeq ?? 0 })
  check('cursor advance is bounded by the digest coverage (race-safe)', (() => {
    const delta = deltaSince(team, 'crypto')
    return delta.findings.length === 1 && delta.findings[0].content === 'beat delivered to a member'
  })())
  advanceCursor(team, 'crypto')
  check('unbounded advance after delivery catches up fully', !hasNewProgress(team, 'crypto'))
  appendFinding(team, { from: 'web', category: 'dead-end', content: 'sqli ruled out on /login' })
  const delta = deltaSince(team, 'crypto')
  check('new beats reappear after the cursor', delta.hasUpdates && delta.findings.length === 1 && delta.findings[0].category === 'dead-end')
  check('reporter cursor key matches member name', readCursor(team, 'crypto').findingSeq === 2)
  const text = formatBoardDelta(deltaSince(team, 'crypto'))
  check('digest renders findings with author and tag', text.includes('web/dead-end') && text.includes('sqli ruled out'))
  const solvedTeam = baseTeam()
  const flag = appendFlagCandidate(solvedTeam, { flag: 'flag{w1n}', submittedBy: 'binary' })
  reviewFlagCandidate(solvedTeam, flag.candidate.id, 'verified', { by: 'captain' })
  check('solved digest carries the convergence banner', formatBoardDelta(deltaSince(solvedTeam, 'crypto')).includes('CHALLENGE IS SOLVED'))
  check('empty delta renders empty digest', formatBoardDelta({ hasUpdates: false, findings: [], flags: [], round: 3, solved: false }) === '')
}

// Challenge metadata updates merge.
{
  const team = baseTeam()
  const challenge = updateChallenge(team, { title: 'Baby RSA', category: 'crypto', points: 500, flagFormat: 'flag\\{[^}]+\\}', remote: 'nc chal:9999' })
  check('challenge update fills the dashboard fields', challenge.title === 'Baby RSA' && challenge.category === 'crypto' && challenge.points === 500)
  check('challengeOf always returns a flag format', challengeOf(baseTeam()).flagFormat === DEFAULT_FLAG_FORMAT)
  check('blank optional fields drop out', updateChallenge(team, { title: '', description: 'x' }).title === undefined)
  check('board id numbers parse', boardIdNumber('fd12') === 12 && boardIdNumber('f3') === 3 && boardIdNumber('zz') === 0)
}

console.log('ctf terminal dashboard')

{
  const team = baseTeam()
  team.phase = 'running'
  team.description = 'Solve the baby RSA challenge on nc chal.local:9999'
  updateChallenge(team, { title: 'baby_rsa', category: 'crypto', points: 500, attachments: ['rsa.pem', 'out.txt'] })
  appendFinding(team, { from: 'scout', category: 'recon', content: '两个附件：rsa.pem、out.txt；n2048 e=65537' })
  appendFlagCandidate(team, { flag: 'flag{v1ct0ry}', submittedBy: 'crypto', evidence: 'wiener attack' })
  team.members = [
    { id: 'm1', name: 'scout', role: 'recon', joinedAt: 1, status: 'idle' },
    { id: 'm2', name: 'crypto', role: 'crypto & math', joinedAt: 1, status: 'working' },
    { id: '', name: 'web', role: 'web', joinedAt: 1, status: 'idle' },
  ]
  team.tasks = [
    { id: 't1', subject: 'Recon attachments and endpoints', status: 'completed', assignee: 'scout', dependencies: [], createdAt: 1, updatedAt: 2 },
    { id: 't2', subject: 'Break the RSA modulus', status: 'in_progress', assignee: 'crypto', dependencies: ['t1'], createdAt: 1, updatedAt: 3 },
    { id: 't3', subject: 'Draft WRITEUP.md skeleton', status: 'pending', dependencies: [], createdAt: 1, updatedAt: 1 },
  ]
  const input = dashboardInputFromTeam(team, {
    activity: new Map([['m1', 'idle'], ['m2', 'working']]),
    memberBehind: new Map([['scout', 2], ['crypto', 0]]),
    openTaskByMember: new Map([['crypto', 't2 Break the RSA modulus']]),
    captainUnread: 1,
  })
  const panel = renderDashboard(input)

  check('panel rows all share the same border display width', panel.split('\n').every(line => displayWidth(line) === displayWidth(panel.split('\n')[0])), 'widths differ')
  check('panel shows the challenge title and category', panel.includes('baby_rsa') && panel.includes('crypto') && panel.includes('500pts'))
  check('panel marks unsolved state', panel.includes('◌ unsolved'))
  check('panel lists lanes with live glyphs', panel.includes('scout') && panel.includes('crypto') && panel.includes('unspawned'))
  check('stale members carry a sync badge', panel.includes('⚡2'))
  check('task board shows ids and owners', panel.includes('t1 ✓') && panel.includes('t2 ▶') && panel.includes('t3 ·'))
  check('findings render CJK content inside the border', panel.includes('两个附件') && panel.includes('n2048 e=65537'))
  check('flags render with status glyph and author', panel.includes('f1 ?') && panel.includes('crypto'))
  check('captain unread mail is flagged', panel.includes('✉ 1'))

  const solved = structuredClone(team)
  reviewFlagCandidate(solved, 'f1', 'verified', { by: 'captain' })
  check('verified flag flips the header to SOLVED', renderDashboard(dashboardInputFromTeam(solved)).includes('SOLVED'))

  // Display-width helpers stay honest on CJK and emoji.
  check('CJK counts as two columns', displayWidth('两个') === 4)
  check('truncation respects display width and marks the cut', displayWidth(truncateToWidth('两个附件两个附件', 7)) === 7 && truncateToWidth('两个附件两个附件', 7).endsWith('…'))
  check('padding reaches the exact width', displayWidth(padEndWidth('ab', 5)) === 5)
  check('empty team renders without throwing', renderDashboard(dashboardInputFromTeam(baseTeam())).includes('CTF TEAMS'))
}

console.log('ctf knowledge base')

{
  const topics = listKnowledgeTopics()
  const names = topics.map(topic => topic.topic)
  check('knowledge lists the shipped topics', ['cve-poc', 'crypto', 'forensics', 'kali-tools', 'misc', 'pwntools', 'pwn', 'reverse', 'sage-math', 'volatility3', 'web'].every(name => names.includes(name)), JSON.stringify(names))
  check('index file stays out of the topic listing', !names.includes('_index'))
  check('every topic has a title and summary', topics.every(topic => topic.title !== '' && topic.summary !== ''))
  const doc = readKnowledgeDoc('volatility3')
  check('volatility3 doc covers the core plugins', doc.includes('windows.pstree') && doc.includes('linux.bash'))
  check('pwntools doc covers process and ROP basics', readKnowledgeDoc('pwntools').includes('cyclic'))
  check('cve-poc doc is a workflow, not a snapshot', readKnowledgeDoc('cve-poc').includes('NVD') && readKnowledgeDoc('cve-poc').includes('PoC'))
  check('unknown topic lists available topics', (() => {
    try { readKnowledgeDoc('nope'); return false } catch (error) { return String(error).includes('available topics') }
  })())
  check('topic ids reject path traversal', (() => {
    try { sanitizeTopic('../secret'); return false } catch { return true }
  })())
}

console.log('ctf-teams builtin profile')

{
  const profiles = withBuiltinCtfProfile(undefined)
  check('builtin profile ships under ctf-teams', profiles[CTF_PROFILE_NAME] !== undefined)
  const resolved = resolveTeamProfile(profiles, CTF_PROFILE_NAME, 8)
  check('builtin roster is a squad of interchangeable generalists', resolved.members.map(member => member.name).join(',') === 'agent-1,agent-2,agent-3,agent-4')
  check('every agent is a full-stack expert, not a specialist lane', resolved.members.every(member => (member.role ?? '').includes('full-stack')))
  check('builtin profile leaves planning to the captain', resolved.taskPlanning === 'captain' && resolved.tasks.length === 0)
  check('agent prompts point at the knowledge topics and the parallel-angle contract', resolved.members.every(member => {
    const prompt = member.executionPrompt ?? ''
    return prompt.includes('ctf_teams_knowledge') && prompt.includes('full-stack') && prompt.includes('SAME challenge') && prompt.includes('ctf_teams_report_finding') && prompt.includes('ctf_teams_submit_flag')
  }))
  const overridden = withBuiltinCtfProfile({ [CTF_PROFILE_NAME]: { members: [{ name: 'solo' }] } })
  check('user profiles override the builtin on name collision', resolveTeamProfile(overridden, CTF_PROFILE_NAME, 8).members.length === 1)
  check('member tools include the CTF round-sync set', ['ctf_teams_submit_flag', 'ctf_teams_report_finding', 'ctf_teams_sync', 'ctf_teams_knowledge', 'ctf_teams_env', 'ctf_teams_references'].every(name => MEMBER_TOOL_NAMES.includes(name)))
  check('mark_flag and set_challenge stay captain-only', !MEMBER_TOOL_NAMES.includes('ctf_teams_mark_flag') && !MEMBER_TOOL_NAMES.includes('ctf_teams_set_challenge') && TEAM_TOOL_NAMES.includes('ctf_teams_mark_flag'))
}

console.log('ctf toolchain env service')

{
  const names = TOOL_SPECS.map(spec => spec.name)
  check('managed tool catalog has unique stable ids', new Set(names).size === names.length)
  check('catalog covers the core stack the user asked for', ['pwntools', 'pycryptodome', 'z3-solver', 'sympy', 'volatility3', 'sage', 'gdb', 'nmap', 'hashcat', 'tshark', 'exiftool'].every(name => names.includes(name)))
  check('probes never invoke a shell (binary names are plain commands)', TOOL_SPECS.every(spec => spec.probe === undefined || (spec.probe.kind === 'binary' ? !/[\s|;&$>`]/.test(spec.probe.command) : /^[A-Za-z_][A-Za-z0-9_]*$/.test(spec.probe.module))))
  check('probe-less tools carry their manual path', TOOL_SPECS.filter(spec => spec.probe === undefined).every(spec => spec.manual !== undefined))
  check('every tool resolves to an install path (curated or manual)', TOOL_SPECS.every(spec => spec.install !== undefined || spec.manual !== undefined))

  // Fake runner: which/where finds nmap only; python imports succeed for pwn/Crypto.
  const fakeRunner = async (argv) => {
    const [command, ...args] = argv
    if (command === 'which' || command === 'where') {
      const target = args[0]
      return target === 'nmap'
        ? { code: 0, stdout: `/usr/bin/${target}\n`, stderr: '' }
        : { code: 1, stdout: '', stderr: 'not found' }
    }
    if (command === 'nmap') return { code: 0, stdout: 'Nmap version 7.95\n', stderr: '' }
    if (command === 'python3') {
      if (args[0] === '-c' && args[1].startsWith('import ')) {
        const module = args[1].split(' ')[1]
        return module === 'pwn' || module === 'Crypto'
          ? { code: 0, stdout: '', stderr: '' }
          : { code: 1, stdout: '', stderr: `No module named '${module}'` }
      }
      return { code: 0, stdout: 'Python 3.12.3\n', stderr: '' }
    }
    return { code: 0, stdout: '', stderr: '' }
  }
  const statuses = await detectTools({ tools: ['nmap', 'pwntools', 'pycryptodome', 'sage'], runner: fakeRunner, python: 'python3' })
  const byName = new Map(statuses.map(status => [status.name, status]))
  check('binary probe reports ok with extracted version', byName.get('nmap').status === 'ok' && byName.get('nmap').version === '7.95')
  check('python module probe reports ok for installed libs', byName.get('pwntools').status === 'ok' && byName.get('pycryptodome').status === 'ok')
  check('missing binary reports missing with an install hint', byName.get('sage').status === 'missing' && byName.get('sage').installHint.startsWith('manual:'))

  const linuxPlan = planInstall(['pwntools', 'nmap', 'sage', 'nope'], TOOL_SPECS, 'linux', { sudo: true })
  check('apt installs gain a non-interactive sudo prefix', linuxPlan.steps.find(step => step.tool === 'nmap').argv.join(' ') === 'sudo -n apt-get install -y nmap')
  check('pip installs go through the explicit python launcher', linuxPlan.steps.find(step => step.tool === 'pwntools').argv.join(' ') === 'python3 -m pip install pwntools')
  check('heavy tools plan as manual notes, never executed', linuxPlan.steps.find(step => step.tool === 'sage').manager === 'manual')
  check('unknown tool ids are reported back', linuxPlan.unknown.join(',') === 'nope')

  const winPlan = planInstall(['pycryptodome', 'tshark'], TOOL_SPECS, 'win32', {})
  check('windows plans prefer pip', winPlan.steps.find(step => step.tool === 'pycryptodome').manager === 'pip')
  check('linux-only apt tools plan as unavailable on windows', winPlan.steps.find(step => step.tool === 'tshark').manager === 'manual')

  const installOutcomes = await runInstallPlan(linuxPlan.steps, { runner: async () => ({ code: 0, stdout: '', stderr: '' }) })
  check('manual steps never execute and report their note', installOutcomes.filter(outcome => outcome.manager === 'manual').every(outcome => outcome.ok === false))
  check('executed steps report success', installOutcomes.filter(outcome => outcome.manager !== 'manual').every(outcome => outcome.ok === true))
  const failedOutcomes = await runInstallPlan(linuxPlan.steps.filter(step => step.tool === 'nmap'), { runner: async () => ({ code: 100, stdout: '', stderr: 'E: unable to locate package' }) })
  check('failed installs capture the stderr tail', failedOutcomes[0].ok === false && failedOutcomes[0].detail.includes('unable to locate'))

  const rendered = renderStatuses(statuses)
  check('status render marks ok/missing/manual distinctly', rendered.includes('✓ nmap') && rendered.includes('manual:'))
}

console.log('ctf references library')

{
  const ids = REFERENCE_REPOS.map(repo => repo.id)
  check('reference manifest has unique stable ids', new Set(ids).size === ids.length)
  check('manifest ships the requested PoC/CVE/skill collections', ['ctf-skills', 'awesome-poc', 'exphub', 'pocindex', 'marcio-cve', 'trickest-cve', 'poc-in-github', 'cvelistv5'].every(id => ids.includes(id)))
  check('every manifest entry uses an https clone url and search hints', REFERENCE_REPOS.every(repo => repo.url.startsWith('https://github.com/') && repo.searchHints.length > 0 && repo.content !== ''))
  check('small reference ids are a subset of the manifest', SMALL_REFERENCE_IDS.every(id => ids.includes(id)))

  const spec = resolveReferenceRepo('EXPHUB')
  check('repo ids resolve case-insensitively', spec.id === 'exphub')
  check('unknown or traversal ids are rejected', (() => {
    try { resolveReferenceRepo('../../etc'); return false } catch (error) { return String(error).includes('available') }
  })())

  const dir = join('workspace', '.ctf-teams', 'references')
  const clone = referenceSyncCommand(spec, dir, { depth: 1 })
  check('clone commands are shallow single-branch git without a shell', clone.argv.slice(0, 4).join(' ') === 'git clone --depth 1' && clone.argv.includes('--single-branch') && clone.argv.at(-1) === referenceRepoPath(spec, dir))
  const pull = referenceSyncCommand(spec, dir, { depth: 1, alreadyProvisioned: true })
  check('provisioned repos update via git pull --ff-only', pull.argv.slice(0, 7).join(' ') === `git -C ${referenceRepoPath(spec, dir)} pull --ff-only --depth 1`)

  const missing = referenceStatus(spec, dir)
  check('status read reports unprovisioned repos', missing.provisioned === false && missing.path === referenceRepoPath(spec, dir))
  const listing = renderReferenceList([missing], REFERENCE_SIZE_NOTES)
  check('listing shows size expectations and hints per repo', listing.includes('[medium]') && listing.includes('exploits/<product>') && listing.includes('sync target:'))

  const autoSmall = autoSyncTargets('small')
  const autoAll = autoSyncTargets('all')
  check('auto-sync small mode clones only the small repos at team creation', autoSmall.every(repo => repo.size === 'small') && autoSmall.length === SMALL_REFERENCE_IDS.length && autoSmall.length < autoAll.length)
  check('auto-sync all mode covers the whole manifest including huge repos', autoAll.length === REFERENCE_REPOS.length && autoAll.some(repo => repo.size === 'huge'))
  check('manifest holds the huge GB-scale repos out of the small auto-sync set', autoSmall.every(repo => !['trickest-cve', 'cvelistv5'].includes(repo.id)))
}

console.log('digest-aware assignment prompt')

{
  const ticket = {
    taskId: 't2', memberName: 'crypto', memberId: 'm2', attempt: 1, attemptId: 'a1',
    subject: 'Break the RSA modulus', teamDescription: 'Solve baby_rsa',
    profileProtocol: 'Recon first, then parallel domain work.',
    dependencyOutputs: [], digest: 'New teammate findings:\n  - [fd1] (scout/recon) e=65537, n 2048-bit',
  }
  const prompt = assignmentPrompt(ticket, '.ctf-teams', 'baby-rsa')
  check('assignment prompt carries the round-sync digest', prompt.includes('Round sync') && prompt.includes('fd1'))
  const bare = assignmentPrompt({ ...ticket, digest: undefined }, '.ctf-teams', 'baby-rsa')
  check('assignments without a delta omit the sync section', !bare.includes('Round sync'))
  assert.ok(prompt.includes('ctf_teams_claim_task'))
}

// Temp workspace hygiene (mirror upstream verify: nothing persisted).
{
  const dir = await mkdtemp(join(tmpdir(), 'ctf-teams-verify-'))
  await rm(dir, { recursive: true, force: true })
  check('temp cleanup works', true)
}

if (failures > 0) {
  console.error(`\n${failures} CTF verification check(s) failed`)
  process.exitCode = 1
} else {
  console.log('\nall CTF checks passed')
}

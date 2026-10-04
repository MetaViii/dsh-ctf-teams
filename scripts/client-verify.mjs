#!/usr/bin/env node
/**
 * Headless smoke test for the built client bundle.
 *
 * The dashboard tab only exists in the browser, so this gate loads
 * `lib/client.js` exactly the way the harness module system does — through
 * `window.__ModuleLoader__.load({ id, factory })` — then drives the client
 * plugin contract with a stubbed hook runtime (one state frame per component,
 * so dialogs open and lists fill the way React would):
 *
 * - the bundle is a ModuleLoader unit for this package;
 * - `inject` asks for the slot ledger and `apply` registers a
 *   `conversation.view` tab;
 * - the tab renders the loading state, then the live team payload, and keeps
 *   the last snapshot when the host goes away;
 * - every control is wired: approve / verify-flag / writeup post one action
 *   turn, exports download, the start form carries the challenge fields, and
 *   the attachment picker lists workspace files and submits the picked paths;
 * - captain-only controls are disabled for a member, and an archived team is
 *   read-only.
 *
 * Usage: node scripts/client-verify.mjs
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import React from 'react'

const require = createRequire(import.meta.url)
const bundlePath = fileURLToPath(new URL('../lib/client.js', import.meta.url))
const source = await readFile(bundlePath, 'utf8')

let failures = 0
function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  PASS  ${label}`)
    return
  }
  failures += 1
  console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
}

console.log('dsh-ctf-teams client bundle verification')

/* ── load the bundle the way the browser kernel does ────────────────────── */

let unit
const windowStub = { __ModuleLoader__: { load(loaded) { unit = loaded } } }
// eslint-disable-next-line no-new-func -- the bundle is a browser script, not a module.
new Function('window', source)(windowStub)
check('bundle registers one ModuleLoader unit', unit !== undefined && typeof unit.factory === 'function')
check('bundle id is the published package name', unit?.id === '@nanmicoder/dsh-ctf-teams', String(unit?.id))

/* ── stub runtime ───────────────────────────────────────────────────────── */

const cleanups = []
const frames = new Map()
let currentFrame = []
let hookCursor = 0
const hookReact = {
  createElement: React.createElement,
  useMemo: (factory) => factory(),
  useState: (initial) => {
    // Close over the frame object, not the mutable `currentFrame` variable:
    // a setter may run long after this render (a click handler), when the
    // walker has moved on to another component.
    const frame = currentFrame
    const index = hookCursor
    hookCursor += 1
    if (frame[index] === undefined) frame[index] = typeof initial === 'function' ? initial() : initial
    return [frame[index], (value) => {
      frame[index] = typeof value === 'function' ? value(frame[index]) : value
    }]
  },
  useEffect: (effect) => {
    const cleanup = effect()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  },
  useRef: (value) => ({ current: value }),
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
}

const fetched = []
const posts = []
const downloads = []
let failFetch = false
let servedPayload
let servedFiles = { files: [{ path: 'dist/rsa.pem', size: 2048 }, { path: 'out.txt', size: 128 }] }

globalThis.document = {
  hidden: false,
  addEventListener() {},
  removeEventListener() {},
  body: { appendChild() {}, removeChild() {} },
  createElement() {
    const anchor = {
      href: '', download: '',
      click() { downloads.push(anchor.download) },
    }
    return anchor
  },
}
globalThis.URL.createObjectURL = () => 'blob:stub'
globalThis.URL.revokeObjectURL = () => {}
globalThis.fetch = async (url, init) => {
  fetched.push(String(url))
  if (failFetch) throw new Error('socket closed')
  if (init && init.method === 'POST') {
    posts.push({ url: String(url), body: JSON.parse(String(init.body)) })
    return {
      ok: true, status: 200, headers: { get: () => null },
      async json() { return { ok: true, action: 'stub', label: 'stub', message: '已发送' } },
    }
  }
  if (String(url).includes('/export')) {
    return {
      ok: true, status: 200,
      headers: { get: (name) => (name === 'content-disposition' ? 'attachment; filename="baby-rsa-solve-WRITEUP.md"' : null) },
      async blob() { return { size: 12 } },
      async json() { return {} },
    }
  }
  if (String(url).includes('/files')) {
    return { ok: true, status: 200, headers: { get: () => null }, async json() { return servedFiles } }
  }
  return { ok: true, status: 200, headers: { get: () => null }, async json() { return servedPayload } }
}

/* ── the client plugin contract ─────────────────────────────────────────── */

const exportsObject = unit.factory((id) => {
  if (id === 'react') return hookReact
  throw new Error(`unexpected client module request: ${id}`)
})
check('exports the plugin apply function', typeof exportsObject.apply === 'function')
check('inject asks for the slot ledger',
  Array.isArray(exportsObject.inject) && exportsObject.inject.includes('slots'), JSON.stringify(exportsObject.inject))

const registrations = []
const fakeCtx = {
  effect(generator) {
    const cleanup = generator()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
    return () => {}
  },
  slots: {
    inject(name, callback) {
      registrations.push({ injected: name })
      return callback()
    },
    register(definition, component) {
      registrations.push({ definition, component })
      return () => {}
    },
  },
}
exportsObject.apply(fakeCtx)

const injected = registrations.find((entry) => entry.injected !== undefined)
const registered = registrations.find((entry) => entry.definition !== undefined)
check('waits for the conversation.view slot', injected?.injected === 'conversation.view', String(injected?.injected))
check('registers the dashboard tab',
  registered?.definition?.name === 'conversation.view'
  && registered?.definition?.id === 'ctf-teams-dashboard'
  && typeof registered?.definition?.order === 'number'
  && registered?.definition?.label() === '解题面板',
  JSON.stringify(registered?.definition))
check('the tab receives its session id',
  registered?.definition?.inject('session-9')?.sessionId === 'session-9',
  JSON.stringify(registered?.definition?.inject('session-9')))
check('registers a component for the tab', typeof registered?.component === 'function')

/* ── render helpers ─────────────────────────────────────────────────────── */

/** Render one component with a stable state frame, React-style. */
function renderComponent(type, props) {
  if (!frames.has(type)) frames.set(type, [])
  const previousFrame = currentFrame
  const previousCursor = hookCursor
  currentFrame = frames.get(type)
  hookCursor = 0
  try {
    return type(props)
  } finally {
    currentFrame = previousFrame
    hookCursor = previousCursor
  }
}

/** Flatten a rendered tree to text, calling function components like React. */
function textOf(node, out = []) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (Array.isArray(node)) {
    for (const child of node) textOf(child, out)
    return out
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (typeof node === 'object' && node.props) {
    if (typeof node.type === 'function') {
      textOf(renderComponent(node.type, node.props), out)
      return out
    }
    textOf(node.props.children, out)
    return out
  }
  return out
}

/** Find the first button whose whole label matches. */
function findButton(node, label) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (node.props === undefined) return undefined
  if (node.type === 'button' && textOf(node).join('') === label) return node
  if (typeof node.type === 'function') {
    const found = findButton(renderComponent(node.type, node.props), label)
    if (found !== undefined) return found
  }
  return findButton(node.props.children, label)
}

/** Find the first element of one tag/type in the rendered tree. */
function findElement(node, type, match) {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, type, match)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (node.props === undefined) return undefined
  if (node.type === type && (match === undefined || match(node.props))) return node
  if (typeof node.type === 'function') {
    const found = findElement(renderComponent(node.type, node.props), type, match)
    if (found !== undefined) return found
  }
  return findElement(node.props.children, type, match)
}

const View = registered.component
const store = exportsObject.__test.storeFor('session-1')
const render = () => renderComponent(View, { sessionId: 'session-1' })
const settle = async () => {
  // Publish a fresh host payload immediately instead of waiting a poll interval.
  store.refresh()
  await new Promise((resolve) => setTimeout(resolve, 10))
}

const baseTeam = {
  teamId: 'baby-rsa-solve',
  name: 'baby-rsa-solve',
  description: '解出 baby_rsa 并写出可复现的解题链',
  workspace: 'E:\\ctf\\baby-rsa',
  workspaceTitle: 'baby-rsa',
  captainSessionId: 'session-1',
  role: 'captain',
  archived: false,
  phase: 'running',
  halted: false,
  escalated: false,
  round: 4,
  createdAt: Date.now() - 12 * 60_000,
  lastBeatAt: Date.now() - 30_000,
  solved: false,
  challenge: { title: 'baby_rsa', category: 'crypto', points: 500, remote: 'nc chal.local:9999', attachments: ['rsa.pem'], flagFormat: 'flag\\{[^}]+\\}' },
  nextStep: 'verify f1 against the platform, then ctf_teams_mark_flag',
  members: [{
    id: 'child-1', name: 'agent-1', role: 'full-stack CTF expert', provider: '', model: 'deepseek-flash',
    reasoningEffort: '', status: 'working', activity: 'working', behind: 2, unread: 1, currentTask: 't3 写 writeup', done: 1, total: 2,
  }],
  tasks: [
    { id: 't3', subject: 'Write the reproducible solve chain to WRITEUP.md', description: '', status: 'in_progress', state: 'running', assignee: 'agent-1', dependencies: [], depth: 0, updatedAt: Date.now() },
    { id: 't1', subject: 'Recon attachments', description: '', status: 'completed', state: 'completed', assignee: 'agent-1', dependencies: [], depth: 0, updatedAt: Date.now() },
  ],
  findings: [{ id: 'fd1', from: 'agent-1', category: 'recon', content: '两个附件 rsa.pem + out.txt', round: 1, ts: Date.now() - 60_000 }],
  flags: [{ id: 'f1', flag: 'flag{w13n3r_4ttack}', submittedBy: 'agent-1', status: 'candidate', ts: Date.now() - 30_000 }],
  captainUnread: 1,
  counts: { members: 1, working: 1, tasks: 2, done: 1, active: 1, pending: 0, findings: 1, flags: 1, verified: 0 },
}
const withTeam = (patch) => {
  servedPayload = {
    generatedAt: Date.now(),
    sessionId: 'session-1',
    workspace: 'E:\\ctf\\baby-rsa',
    archived: false,
    profiles: ['ctf-teams', 'web-only'],
    teams: [{ ...baseTeam, ...patch }],
  }
}
withTeam({})

/* ── read path ──────────────────────────────────────────────────────────── */

const loading = textOf(render()).join(' ')
check('renders the loading state before the first response', loading.includes('正在读取战队状态'), loading.slice(0, 120))

await settle()
const live = textOf(render()).join(' ')
check('polls the host route with the session id',
  fetched.some((url) => url.includes('/plugins/dsh-ctf-teams/state?session=session-1')), fetched.join(', '))
check('renders the live challenge, lanes, tasks, findings and flags',
  live.includes('baby_rsa') && live.includes('agent-1') && live.includes('t3')
  && live.includes('两个附件') && live.includes('flag{w13n3r_4ttack}'), live.slice(0, 200))
check('renders the next-step line from the host', live.includes('下一步') && live.includes('ctf_teams_mark_flag'))
check('renders the progress bar and census', live.includes('1/2') && live.includes('已验证'))

failFetch = true
await new Promise((resolve) => setTimeout(resolve, 1700))
const stale = textOf(render()).join(' ')
check('keeps the last snapshot when the host goes away', stale.includes('baby_rsa') && stale.includes('重连中'), stale.slice(0, 160))
failFetch = false

/* ── interaction: buttons become user turns ─────────────────────────────── */

withTeam({ phase: 'staged', nextStep: 'the plan is staged — approve & run to dispatch the squad' })
await settle()
const stagedTree = render()
const stagedText = textOf(stagedTree).join(' ')
check('a staged team offers approval, attachments and a report export',
  stagedText.includes('批准并运行') && stagedText.includes('附件') && stagedText.includes('导出复盘'), stagedText.slice(0, 160))
check('a staged plan is badged as awaiting approval', stagedText.includes('计划待批准'))

posts.length = 0
const approveButton = findButton(stagedTree, '批准并运行')
check('the approve button is enabled for the captain', approveButton !== undefined && approveButton.props.disabled !== true)
approveButton.props.onClick()
await settle()
check('clicking approve posts one action turn for this team',
  posts.length === 1
  && posts[0].url.endsWith('/plugins/dsh-ctf-teams/action')
  && posts[0].body.action === 'approve'
  && posts[0].body.sessionId === 'session-1'
  && posts[0].body.teamId === 'baby-rsa-solve',
  JSON.stringify(posts))
check('the panel reports the host answer', textOf(render()).join(' ').includes('已发送'), 'notice missing')

withTeam({ phase: 'staged', role: 'member' })
await settle()
check('a member cannot approve from the panel',
  findButton(render(), '批准并运行')?.props.disabled === true)

withTeam({ phase: 'running' })
await settle()
const runningTree = render()
const runningText = textOf(runningTree).join(' ')
check('a running solve offers nudge, halt, writeup, verify and exports',
  ['推进一轮', '暂停', '写 WRITEUP', '导出 WP', '导出复盘', '核对 flag f1'].every((label) => runningText.includes(label)),
  runningText.slice(0, 200))

posts.length = 0
findButton(runningTree, '核对 flag f1').props.onClick()
await settle()
check('verify-flag carries the candidate id',
  posts.length === 1 && posts[0].body.action === 'verify-flag' && posts[0].body.flagId === 'f1', JSON.stringify(posts))

posts.length = 0
findButton(runningTree, '推进一轮').props.onClick()
await settle()
check('nudge posts the operational action',
  posts.length === 1 && posts[0].body.action === 'nudge', JSON.stringify(posts))

downloads.length = 0
findButton(runningTree, '导出 WP').props.onClick()
await settle()
check('export downloads through the browser',
  downloads.length === 1 && downloads[0] === 'baby-rsa-solve-WRITEUP.md'
  && fetched.some((url) => url.includes('/export?session=session-1&kind=writeup')),
  JSON.stringify({ downloads, tail: fetched.slice(-1) }))

withTeam({ phase: 'halted' })
await settle()
const haltedText = textOf(render()).join(' ')
check('a halted team offers resume', haltedText.includes('继续') && !haltedText.includes('暂停'), haltedText.slice(0, 160))

withTeam({ archived: true })
await settle()
const archivedText = textOf(render()).join(' ')
check('an archived team is read-only and exportable',
  archivedText.includes('已归档') && archivedText.includes('导出复盘') && !archivedText.includes('推进一轮'),
  archivedText.slice(0, 200))

/* ── interaction: start form ────────────────────────────────────────────── */

servedPayload = { generatedAt: Date.now(), sessionId: 'session-1', workspace: 'E:\\ctf\\baby-rsa', archived: false, profiles: ['ctf-teams'], teams: [] }
await settle()
const emptyTree = render()
const emptyText = textOf(emptyTree).join(' ')
check('an empty session offers the start button and explains the flow',
  emptyText.includes('开始解题') && emptyText.includes('这个会话还没有 CTFTeams 战队'), emptyText.slice(0, 160))

findButton(emptyTree, '开始解题').props.onClick()
const formTree = render()
const formText = textOf(formTree).join(' ')
check('the start form asks for the challenge facts',
  ['题目描述 / 目标（必填）', '模板', '远程目标', '分类', '分值', 'flag 格式（正则）'].every((label) => formText.includes(label)),
  formText.slice(0, 200))

// Type into the form and submit: the panel must post exactly what was typed.
const goalInput = findElement(formTree, 'textarea')
goalInput.props.onChange({ target: { value: '解 http://chal.local:8000' } })
const remoteInput = findElement(formTree, 'input')
remoteInput.props.onChange({ target: { value: 'http://chal.local:8000' } })
posts.length = 0
findElement(render(), 'form').props.onSubmit({ preventDefault() {} })
await settle()
check('submitting the form posts a start action with the typed goal',
  posts.length === 1 && posts[0].body.action === 'start' && posts[0].body.goal === '解 http://chal.local:8000'
  && posts[0].body.remote === 'http://chal.local:8000', JSON.stringify(posts))

/* ── interaction: attachment picker ─────────────────────────────────────── */

withTeam({ phase: 'staged' })
await settle()
findButton(render(), '附件').props.onClick()
// Walk once to mount the dialog (the picker's fetch starts on mount), then let it land.
textOf(render())
await settle()
const pickerText = textOf(render()).join(' ')
check('the attachment picker lists workspace files',
  pickerText.includes('dist/rsa.pem') && pickerText.includes('out.txt') && pickerText.includes('加入题目'),
  pickerText.slice(-200))
posts.length = 0
// The picker's first input is the filter field; the file row is the checkbox.
findElement(render(), 'input', (props) => props.type === 'checkbox').props.onChange()
await settle()
const submitPicker = findButton(render(), '加入题目 (1)')
check('picking a file arms the submit with its path', submitPicker !== undefined && submitPicker.props.disabled !== true)
submitPicker.props.onClick()
await settle()
check('the picker posts the picked attachment paths',
  posts.length === 1 && posts[0].body.action === 'attachments'
  && Array.isArray(posts[0].body.attachments) && posts[0].body.attachments.includes('dist/rsa.pem'),
  JSON.stringify(posts))

for (const cleanup of cleanups) {
  if (typeof cleanup === 'function') cleanup()
}
check('registration cleanups run without throwing', true)

if (failures > 0) {
  console.error(`\n${failures} client verification check(s) failed`)
  process.exit(1)
}
console.log('\nclient bundle verification passed')

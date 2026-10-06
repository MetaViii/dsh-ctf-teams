/* dsh-ctf-teams client bundle — generated from src/client/entry.js by scripts/build-client.mjs. Do not edit by hand. */
window.__ModuleLoader__.load({
	id: "@nanmicoder/dsh-ctf-teams",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		/**
		 * CTFTeams dashboard view — the browser half of the plugin.
		 *
		 * A `conversation.view` list-slot contributor, so the solving picture is a tab
		 * next to 对话 / 轨迹 instead of text scrolled away in the transcript. The tab
		 * polls the host's read-only `…/state` route (durable team files are the truth
		 * source, `nextStep` comes from the same helper the text panel uses) and drives
		 * the session through `…/action`: each button composes **one user turn**, so
		 * the captain agent remains the only writer of team state. `…/files` feeds the
		 * attachment picker and `…/export` downloads WRITEUP.md or a review report.
		 *
		 * This file is a plain-JS CommonJS factory body (`require` / `exports`, no JSX,
		 * no imports). `scripts/build-client.mjs` wraps it in the harness
		 * `window.__ModuleLoader__.load({ id, factory })` envelope, so the plugin needs
		 * no client bundler and no extra build dependency.
		 */

		var VIEW_ID = 'ctf-teams-dashboard'
		var VIEW_ORDER = 20
		var STATE_PATH = '/plugins/dsh-ctf-teams/state'
		var ACTION_PATH = '/plugins/dsh-ctf-teams/action'
		var EXPORT_PATH = '/plugins/dsh-ctf-teams/export'
		var FILES_PATH = '/plugins/dsh-ctf-teams/files'
		/** Live cadence while the tab is mounted; ages re-render every second. */
		var POLL_MS = 1500

		var TONE = {
		  muted: 'rgba(127,127,127,0.7)',
		  line: 'rgba(127,127,127,0.28)',
		  soft: 'rgba(127,127,127,0.10)',
		  ok: '#2ea043',
		  warn: '#d29922',
		  bad: '#d1242f',
		  info: '#4493f8',
		}

		var TASK_GLYPH = { completed: '✓', failed: '✗', cancelled: '⊘', running: '▶', blocked: '⏸', open: '·' }

		var REACT = require('react')
		var h = REACT.createElement
		var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

		/* ── formatting ─────────────────────────────────────────────────────────── */

		/** `12s 前` / `3m 前` / `2h 前` — the freshness of one board beat. */
		function age(ts, now) {
		  if (typeof ts !== 'number' || !isFinite(ts)) return ''
		  var seconds = Math.max(0, Math.floor((now - ts) / 1000))
		  if (seconds < 5) return '刚刚'
		  if (seconds < 60) return seconds + 's 前'
		  var minutes = Math.floor(seconds / 60)
		  if (minutes < 60) return minutes + 'm 前'
		  var hours = Math.floor(minutes / 60)
		  if (hours < 24) return hours + 'h 前'
		  return Math.floor(hours / 24) + 'd 前'
		}

		function duration(ts, now) {
		  return age(ts, now).replace(' 前', '')
		}

		/** `[████░░░░] 3/8` — the one-glance progress marker. */
		function bar(done, total, width) {
		  var cells = width || 16
		  var filled = total <= 0 ? 0 : Math.max(0, Math.min(cells, Math.round((done / total) * cells)))
		  var out = ''
		  for (var index = 0; index < cells; index += 1) out += index < filled ? '█' : '░'
		  return '[' + out + '] ' + done + '/' + total
		}

		/* ── polling store (one per session, reference counted) ─────────────────── */

		var stores = new Map()

		function createStore(sessionId) {
		  var state = { status: 'loading', payload: undefined, archived: undefined, error: undefined, archivedOpen: false }
		  var listeners = new Set()
		  var timer
		  var controller
		  var inFlight = false
		  var refs = 0

		  function emit(next) {
		    state = Object.assign({}, state, next)
		    listeners.forEach(function (listener) { listener() })
		  }

		  function alive() {
		    return refs > 0
		  }

		  function schedule() {
		    if (timer !== undefined) clearTimeout(timer)
		    if (!alive()) return
		    timer = setTimeout(function () { void tick() }, POLL_MS)
		  }

		  async function fetchTeams(archived, signal) {
		    var query = '?session=' + encodeURIComponent(sessionId) + (archived ? '&archived=1' : '')
		    var response = await fetch(STATE_PATH + query, { cache: 'no-store', signal: signal })
		    if (!response.ok) throw new Error('HTTP ' + response.status)
		    var body = await response.json()
		    if (body === null || typeof body !== 'object' || !Array.isArray(body.teams)) throw new Error('响应格式不正确')
		    return body
		  }

		  async function tick() {
		    if (inFlight || !alive()) return
		    if (typeof document !== 'undefined' && document.hidden) { schedule(); return }
		    inFlight = true
		    controller = new AbortController()
		    try {
		      var body = await fetchTeams(false, controller.signal)
		      if (alive()) emit({ status: 'ready', payload: body, error: undefined })
		    } catch (error) {
		      // A restarting host keeps the last snapshot on screen and retries.
		      if (!error || error.name !== 'AbortError') {
		        if (alive()) emit({ status: state.payload === undefined ? 'error' : 'stale', error: String((error && error.message) || error) })
		      }
		    } finally {
		      inFlight = false
		      schedule()
		    }
		  }

		  function onVisibility() {
		    if (typeof document !== 'undefined' && !document.hidden && alive()) void tick()
		  }

		  var store = {
		    subscribe: function (listener) {
		      listeners.add(listener)
		      return function () { listeners.delete(listener) }
		    },
		    getSnapshot: function () { return state },
		    /** Force an immediate poll (used after a panel action changed the world). */
		    refresh: function () {
		      if (alive()) void tick()
		    },
		    retain: function () {
		      refs += 1
		      if (refs !== 1) return
		      document.addEventListener('visibilitychange', onVisibility)
		      void tick()
		    },
		    release: function () {
		      if (refs === 0) return
		      refs -= 1
		      if (refs > 0) return
		      document.removeEventListener('visibilitychange', onVisibility)
		      if (timer !== undefined) clearTimeout(timer)
		      timer = undefined
		      if (controller !== undefined) controller.abort()
		    },
		    toggleArchived: async function () {
		      var open = !state.archivedOpen
		      emit({ archivedOpen: open })
		      if (!open || state.archived !== undefined) return
		      controller = new AbortController()
		      try {
		        var body = await fetchTeams(true, controller.signal)
		        if (alive()) emit({ archived: body.teams })
		      } catch (error) {
		        if (!error || error.name !== 'AbortError') {
		          if (alive()) emit({ archived: [], error: String((error && error.message) || error) })
		        }
		      }
		    },
		  }
		  return store
		}

		function storeFor(sessionId) {
		  var key = sessionId === undefined || sessionId === null || sessionId === '' ? '(none)' : String(sessionId)
		  var existing = stores.get(key)
		  if (existing !== undefined) return existing
		  var created = createStore(key)
		  stores.set(key, created)
		  return created
		}

		/* ── presentation ───────────────────────────────────────────────────────── */

		function chip(text, tone, key) {
		  return h('span', {
		    key: key === undefined ? 'chip:' + text : key,
		    style: {
		      display: 'inline-block', padding: '1px 7px', marginRight: 6, borderRadius: 999,
		      border: '1px solid ' + TONE.line, fontSize: 11, lineHeight: '16px',
		      color: tone || 'inherit', whiteSpace: 'nowrap',
		    },
		  }, text)
		}

		function sectionTitle(title, right) {
		  return h('div', {
		    key: 'section:' + title,
		    style: {
		      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
		      margin: '16px 0 6px', paddingBottom: 4, borderBottom: '1px solid ' + TONE.line,
		      fontSize: 11.5, letterSpacing: '0.08em', color: TONE.muted,
		    },
		  }, [
		    h('span', { key: 'title' }, title),
		    right === undefined ? null : h('span', { key: 'right', style: { letterSpacing: 0 } }, right),
		  ])
		}

		function row(children, key, extra) {
		  return h('div', Object.assign({
		    key: key,
		    style: {
		      display: 'flex', gap: 10, alignItems: 'baseline', padding: '5px 8px',
		      borderBottom: '1px solid ' + TONE.soft, fontSize: 12.5, lineHeight: '18px',
		    },
		  }, extra), children)
		}

		function mono(text, extra) {
		  return h('code', Object.assign({ style: { fontFamily: MONO, fontSize: 12 } }, extra), text)
		}

		function activityDot(activity) {
		  var color = activity === 'working' ? TONE.ok : activity === 'unspawned' ? TONE.muted : TONE.line
		  return h('span', {
		    key: 'dot',
		    style: {
		      display: 'inline-block', width: 8, height: 8, borderRadius: 999, marginRight: 7, flex: '0 0 auto',
		      background: color, boxShadow: activity === 'working' ? '0 0 0 3px rgba(46,160,67,0.18)' : 'none',
		    },
		  })
		}

		function challengeLine(team) {
		  var challenge = team.challenge || {}
		  var bits = []
		  if (challenge.title) bits.push(challenge.title)
		  if (challenge.category) bits.push(challenge.category)
		  if (typeof challenge.points === 'number') bits.push(challenge.points + ' pts')
		  return bits.join(' · ')
		}

		function teamButton(team, selected, onSelect) {
		  var role = team.role === 'captain' ? '队长' : team.role === 'member' ? '成员' : '旁观'
		  return h('button', {
		    key: 'team:' + team.teamId,
		    onClick: function () { onSelect(team.teamId) },
		    title: team.teamId,
		    style: {
		      padding: '3px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 12, color: 'inherit',
		      border: '1px solid ' + TONE.line, background: selected ? TONE.soft : 'transparent',
		    },
		  }, [team.name + ' · ' + role, team.solved ? ' 🚩' : ''])
		}

		function headerRow(team, now) {
		  var counts = team.counts
		  var meta = [
		    '第 ' + team.round + ' 轮',
		    '已进行 ' + duration(team.createdAt, now),
		    team.lastBeatAt === undefined ? '' : '最后进展 ' + age(team.lastBeatAt, now),
		    counts.working + '/' + counts.members + ' 在跑',
		  ].filter(function (part) { return part !== '' })

		  var challenge = team.challenge || {}
		  return h('div', { key: 'header', style: { padding: '12px 4px 0' } }, [
		    h('div', { key: 'title', style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } }, [
		      h('span', { key: 'badge', style: { fontSize: 18, lineHeight: 1 } }, team.solved ? '🚩' : '◌'),
		      h('strong', { key: 'name', style: { fontSize: 16 } }, challengeLine(team) || team.name),
		      team.solved ? chip('已解出', TONE.ok, 'solved') : chip('进行中', TONE.warn, 'open'),
		      team.phase === 'staged' ? chip('计划待批准', TONE.info, 'staged') : null,
		      team.archived === true ? chip('已归档', TONE.muted, 'archived') : null,
		      team.halted ? chip('已暂停', TONE.warn, 'halted') : null,
		      team.escalated ? chip('已升级', TONE.bad, 'escalated') : null,
		    ]),
		    team.description
		      ? h('div', { key: 'goal', style: { marginTop: 5, color: TONE.muted, fontSize: 12.5 } }, team.description)
		      : null,
		    h('div', { key: 'meta', style: { marginTop: 6, fontSize: 12.5, color: TONE.muted } }, meta.join(' · ')),
		    h('div', { key: 'challenge', style: { marginTop: 6, fontSize: 12.5 } }, [
		      challenge.remote ? h('span', { key: 'remote', style: { marginRight: 14 } }, ['目标 ', mono(challenge.remote)]) : null,
		      challenge.attachments && challenge.attachments.length > 0
		        ? h('span', { key: 'files', style: { marginRight: 14 } }, ['附件 ', mono(challenge.attachments.join(', '))])
		        : null,
		      challenge.flagFormat ? h('span', { key: 'fmt' }, ['flag 格式 ', mono(challenge.flagFormat)]) : null,
		    ]),
		    h('div', { key: 'progress', style: { marginTop: 10, fontFamily: MONO, fontSize: 13 } }, [
		      bar(counts.done, counts.tasks, 18),
		      h('span', {
		        key: 'census',
		        style: { marginLeft: 10, fontFamily: 'inherit', color: TONE.muted, fontSize: 12.5 },
		      }, counts.done + ' 完成 · ' + counts.active + ' 进行中 · ' + counts.pending + ' 待办 · '
		        + counts.findings + ' findings · ' + counts.flags + ' flag（' + counts.verified + ' 已验证）'),
		    ]),
		  ])
		}

		function nextStepRow(team) {
		  return h('div', {
		    key: 'next',
		    style: {
		      marginTop: 16, padding: '10px 12px', borderRadius: 8, border: '1px solid ' + TONE.line,
		      background: TONE.soft, fontSize: 12.5, lineHeight: '18px',
		    },
		  }, [
		    h('strong', { key: 'label', style: { color: TONE.info } }, '下一步 ▸ '),
		    h('span', { key: 'text' }, team.nextStep),
		  ])
		}

		function agentsSection(team) {
		  return h('div', { key: 'agents' }, [
		    sectionTitle('成员', team.counts.working + '/' + team.counts.members + ' 在跑'),
		    h('div', { key: 'rows' }, team.members.map(function (member) {
		      var badges = []
		      if (member.behind > 0) badges.push(chip('⚡ ' + member.behind + ' 未同步', TONE.warn, 'behind'))
		      if (member.unread > 0) badges.push(chip('✉ ' + member.unread, TONE.info, 'unread'))
		      if (member.total > 0) badges.push(chip(member.done + '/' + member.total + ' 任务', TONE.muted, 'tasks'))
		      if (member.model) badges.push(chip(member.model, TONE.muted, 'model'))
		      var label = member.activity === 'working' ? 'working'
		        : member.activity === 'unspawned' ? '未启动'
		          : member.status === 'removed' ? '已移除' : 'idle'
		      return row([
		        h('span', { key: 'name', style: { width: 108, display: 'inline-flex', alignItems: 'center', flex: '0 0 auto' } }, [
		          activityDot(member.activity),
		          h('span', { key: 'text', style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, member.name),
		        ]),
		        h('span', {
		          key: 'state',
		          style: { width: 62, flex: '0 0 auto', color: member.activity === 'working' ? TONE.ok : TONE.muted },
		        }, label),
		        h('span', {
		          key: 'work',
		          style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
		        }, member.currentTask || member.role || ''),
		        h('span', { key: 'badges', style: { whiteSpace: 'nowrap', flex: '0 0 auto' } }, badges),
		      ], member.id || member.name)
		    })),
		  ])
		}

		function tasksSection(team) {
		  var order = { running: 0, open: 1, blocked: 2, failed: 3, completed: 4, cancelled: 5 }
		  var tasks = team.tasks.slice().sort(function (left, right) {
		    var leftOrder = order[left.state] === undefined ? 9 : order[left.state]
		    var rightOrder = order[right.state] === undefined ? 9 : order[right.state]
		    return leftOrder !== rightOrder ? leftOrder - rightOrder : left.id.localeCompare(right.id)
		  })
		  return h('div', { key: 'tasks' }, [
		    sectionTitle('任务', bar(team.counts.done, team.counts.tasks, 12)),
		    h('div', { key: 'rows' }, tasks.map(function (task) {
		      var glyph = TASK_GLYPH[task.state] || TASK_GLYPH[task.status] || '·'
		      var color = task.state === 'completed' ? TONE.ok
		        : task.state === 'running' ? TONE.info
		          : task.state === 'failed' ? TONE.bad : 'inherit'
		      var badges = []
		      if (task.kind) badges.push(chip(task.kind, TONE.muted, 'kind'))
		      if (task.round !== undefined) badges.push(chip('r' + task.round, TONE.muted, 'round'))
		      if (task.verdict) {
		        badges.push(chip(task.verdict === 'pass' ? '审查通过' : '审查未通过', task.verdict === 'pass' ? TONE.ok : TONE.bad, 'verdict'))
		      }
		      if (task.dependencies.length > 0) badges.push(chip('依赖 ' + task.dependencies.join(','), TONE.muted, 'deps'))
		      return row([
		        h('span', { key: 'id', style: { width: 130, flex: '0 0 auto', whiteSpace: 'nowrap', color: color } }, [glyph + ' ', mono(task.id)]),
		        h('span', { key: 'subject', style: { flex: 1, minWidth: 0 } }, task.subject),
		        h('span', { key: 'badges', style: { whiteSpace: 'nowrap', flex: '0 0 auto' } }, badges),
		        h('span', {
		          key: 'who',
		          style: { width: 92, flex: '0 0 auto', textAlign: 'right', color: TONE.muted, whiteSpace: 'nowrap' },
		        }, task.assignee || '未指派'),
		      ], task.id)
		    })),
		  ])
		}

		function findingsSection(team, now) {
		  var findings = team.findings.slice(-8)
		  return h('div', { key: 'findings' }, [
		    sectionTitle('Findings（最新）', team.counts.findings + ' 条'),
		    findings.length === 0
		      ? row([h('span', { key: 'empty', style: { color: TONE.muted } }, '还没有进展上报——成员每轮会把结果发上看板（死胡同也算结果）')], 'empty')
		      : h('div', { key: 'rows' }, findings.map(function (finding) {
		        var tag = finding.category ? finding.from + '/' + finding.category : finding.from
		        var deadEnd = finding.category === 'dead-end'
		        return row([
		          h('span', { key: 'id', style: { width: 96, flex: '0 0 auto', whiteSpace: 'nowrap', color: TONE.muted } }, ['r' + finding.round + ' ', mono(finding.id)]),
		          h('span', { key: 'tag', style: { width: 150, flex: '0 0 auto', overflow: 'hidden' } }, chip(tag, deadEnd ? TONE.bad : TONE.info, 'tag')),
		          h('span', { key: 'text', style: { flex: 1, minWidth: 0 } }, finding.content),
		          h('span', { key: 'age', style: { width: 68, flex: '0 0 auto', textAlign: 'right', color: TONE.muted, whiteSpace: 'nowrap' } }, age(finding.ts, now)),
		        ], finding.id)
		      })),
		  ])
		}

		function flagsSection(team) {
		  var flags = team.flags.slice(-8)
		  return h('div', { key: 'flags' }, [
		    sectionTitle('Flag 看板', team.counts.flags + ' 条 · ' + team.counts.verified + ' 已验证'),
		    flags.length === 0
		      ? row([h('span', { key: 'empty', style: { color: TONE.muted } }, '还没有候选 flag——成员用 ctf_teams_submit_flag 提交，队长核对平台后标记')], 'empty')
		      : h('div', { key: 'rows' }, flags.map(function (flag) {
		        var glyph = flag.status === 'verified' ? '✓' : flag.status === 'rejected' ? '✗' : '?'
		        var color = flag.status === 'verified' ? TONE.ok : flag.status === 'rejected' ? TONE.bad : TONE.warn
		        return row([
		          h('span', { key: 'id', style: { width: 62, flex: '0 0 auto', whiteSpace: 'nowrap', color: color } }, [glyph + ' ', mono(flag.id)]),
		          h('span', { key: 'flag', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, mono(flag.flag)),
		          flag.note ? h('span', { key: 'note', style: { color: TONE.muted, whiteSpace: 'nowrap', flex: '0 0 auto' } }, flag.note) : null,
		          h('span', {
		            key: 'who',
		            style: { width: 92, flex: '0 0 auto', textAlign: 'right', color: TONE.muted, whiteSpace: 'nowrap' },
		          }, flag.submittedBy),
		        ], flag.id)
		      })),
		  ])
		}

		function TeamView(props) {
		  var team = props.team
		  return h('div', { key: 'team:' + team.teamId, style: { paddingBottom: 24 } }, [
		    headerRow(team, props.now),
		    agentsSection(team),
		    tasksSection(team),
		    findingsSection(team, props.now),
		    flagsSection(team),
		    nextStepRow(team),
		  ])
		}

		/* ── interaction: one click becomes one user turn ───────────────────────── */

		/** POST one panel action; resolve to the host's message or reject with its error. */
		async function postAction(body) {
		  var response = await fetch(ACTION_PATH, {
		    method: 'POST',
		    cache: 'no-store',
		    headers: { 'content-type': 'application/json' },
		    body: JSON.stringify(body),
		  })
		  var payload
		  try {
		    payload = await response.json()
		  } catch {
		    payload = undefined
		  }
		  if (!response.ok) {
		    throw new Error((payload && payload.error) || ('HTTP ' + response.status))
		  }
		  return payload
		}

		/** Download one exported document through the browser's download path. */
		async function downloadExport(sessionId, teamId, kind, fallbackName) {
		  var query = '?session=' + encodeURIComponent(sessionId) + '&kind=' + kind
		    + (teamId === undefined ? '' : '&teamId=' + encodeURIComponent(teamId))
		  var response = await fetch(EXPORT_PATH + query, { cache: 'no-store' })
		  if (!response.ok) {
		    var payload
		    try { payload = await response.json() } catch { payload = undefined }
		    throw new Error((payload && payload.error) || ('HTTP ' + response.status))
		  }
		  var disposition = response.headers.get('content-disposition') || ''
		  var matched = /filename="([^"]+)"/.exec(disposition)
		  var name = matched === null ? fallbackName : matched[1]
		  var blob = await response.blob()
		  var url = URL.createObjectURL(blob)
		  var anchor = document.createElement('a')
		  anchor.href = url
		  anchor.download = name
		  document.body.appendChild(anchor)
		  anchor.click()
		  document.body.removeChild(anchor)
		  setTimeout(function () { URL.revokeObjectURL(url) }, 30_000)
		  return name
		}

		function ActionButton(props) {
		  return h('button', {
		    key: props.id,
		    onClick: props.onClick,
		    disabled: props.disabled === true,
		    title: props.title,
		    style: {
		      padding: '4px 12px', borderRadius: 6, cursor: props.disabled === true ? 'default' : 'pointer',
		      fontSize: 12.5, color: 'inherit', whiteSpace: 'nowrap',
		      border: '1px solid ' + (props.primary === true ? TONE.info : TONE.line),
		      background: props.primary === true ? 'rgba(68,147,248,0.14)' : 'transparent',
		      opacity: props.disabled === true ? 0.5 : 1,
		    },
		  }, props.label)
		}

		function Modal(props) {
		  REACT.useEffect(function () {
		    function onKey(event) { if (event.key === 'Escape') props.onClose() }
		    document.addEventListener('keydown', onKey)
		    return function () { document.removeEventListener('keydown', onKey) }
		  }, [props])
		  return h('div', {
		    style: {
		      position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center',
		      background: 'rgba(0,0,0,0.45)', padding: 24,
		    },
		    onClick: function (event) { if (event.target === event.currentTarget) props.onClose() },
		  }, h('div', {
		    role: 'dialog',
		    'aria-label': props.title,
		    style: {
		      width: 'min(560px, 100%)', maxHeight: '80vh', overflowY: 'auto', borderRadius: 12, padding: '16px 18px',
		      border: '1px solid ' + TONE.line, background: 'var(--dsh-surface, Canvas)', color: 'inherit', fontSize: 13,
		    },
		  }, [
		    h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 } }, [
		      h('strong', { key: 'title', style: { fontSize: 14 } }, props.title),
		      h('span', { key: 'spacer', style: { flex: 1 } }),
		      h('button', {
		        key: 'close', onClick: props.onClose, 'aria-label': '关闭',
		        style: { border: '1px solid ' + TONE.line, background: 'transparent', color: 'inherit', borderRadius: 6, cursor: 'pointer', padding: '2px 8px' },
		      }, '关闭'),
		    ]),
		    props.children,
		  ]))
		}

		function field(label, control) {
		  return h('label', { key: 'field:' + label, style: { display: 'block', marginBottom: 10 } }, [
		    h('span', { key: 'label', style: { display: 'block', fontSize: 12, color: TONE.muted, marginBottom: 4 } }, label),
		    control,
		  ])
		}

		var INPUT_STYLE = {
		  width: '100%', boxSizing: 'border-box', padding: '6px 8px', borderRadius: 6, fontSize: 13,
		  border: '1px solid ' + TONE.line, background: 'transparent', color: 'inherit',
		}

		function StartForm(props) {
		  var goalState = REACT.useState('')
		  var remoteState = REACT.useState('')
		  var categoryState = REACT.useState('')
		  var pointsState = REACT.useState('')
		  var formatState = REACT.useState('')
		  var profileState = REACT.useState('')
		  // The challenge usually arrives with files: pick them here instead of
		  // attaching after the team exists.
		  var workspace = useWorkspaceFiles(props.sessionId)
		  var filterState = REACT.useState('')
		  var pickedState = REACT.useState([])
		  var openState = REACT.useState(false)
		  var picked = pickedState[0]
		  return h('form', {
		    onSubmit: function (event) {
		      event.preventDefault()
		      props.onSubmit({
		        goal: goalState[0].trim(),
		        profile: profileState[0] === '' ? undefined : profileState[0],
		        remote: remoteState[0].trim() === '' ? undefined : remoteState[0].trim(),
		        category: categoryState[0].trim() === '' ? undefined : categoryState[0].trim(),
		        points: pointsState[0].trim() === '' || isNaN(Number(pointsState[0])) ? undefined : Number(pointsState[0]),
		        flagFormat: formatState[0].trim() === '' ? undefined : formatState[0].trim(),
		        attachments: picked.length === 0 ? undefined : picked,
		      })
		    },
		  }, [
		    field('题目描述 / 目标（必填）', h('textarea', {
		      key: 'goal', value: goalState[0], rows: 4, required: true, placeholder: '例如：解 https://chal.local:8000，源码在 ./src；或：从 rsa.pem + out.txt 解出 baby_rsa',
		      style: Object.assign({}, INPUT_STYLE, { resize: 'vertical', font: 'inherit' }),
		      onChange: function (event) { goalState[1](event.target.value) },
		    })),
		    field('模板', h('select', {
		      key: 'profile', value: profileState[0], style: INPUT_STYLE,
		      onChange: function (event) { profileState[1](event.target.value) },
		    }, [h('option', { key: '', value: '' }, '默认（内置 ctf-teams 小队）')].concat(props.profiles.map(function (name) {
		      return h('option', { key: name, value: name }, name)
		    })))),
		    field('远程目标', h('input', {
		      key: 'remote', value: remoteState[0], placeholder: 'http://chal.local:8000 或 nc chal.local 9999',
		      style: INPUT_STYLE, onChange: function (event) { remoteState[1](event.target.value) },
		    })),
		    h('div', { key: 'row', style: { display: 'flex', gap: 10 } }, [
		      h('div', { key: 'cat', style: { flex: 1 } }, field('分类', h('input', {
		        key: 'category', value: categoryState[0], placeholder: 'web / pwn / crypto …',
		        style: INPUT_STYLE, onChange: function (event) { categoryState[1](event.target.value) },
		      }))),
		      h('div', { key: 'pts', style: { width: 110 } }, field('分值', h('input', {
		        key: 'points', value: pointsState[0], placeholder: '500', inputMode: 'numeric',
		        style: INPUT_STYLE, onChange: function (event) { pointsState[1](event.target.value) },
		      }))),
		    ]),
		    field('flag 格式（正则）', h('input', {
		      key: 'format', value: formatState[0], placeholder: 'flag\\{[^}]+\\}',
		      style: INPUT_STYLE, onChange: function (event) { formatState[1](event.target.value) },
		    })),
		    h('div', { key: 'attach', style: { marginBottom: 10 } }, [
		      h('div', { key: 'head', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } }, [
		        h('span', { key: 'label', style: { fontSize: 12, color: TONE.muted } }, '题目附件'),
		        h(ActionButton, {
		          key: 'toggle', id: 'toggle',
		          label: openState[0] ? '收起文件列表' : (picked.length === 0 ? '选择附件' : '选择附件 (' + picked.length + ')'),
		          disabled: workspace.loading,
		          onClick: function () { openState[1](!openState[0]) },
		        }),
		        workspace.loading
		          ? h('span', { key: 'loading', style: { fontSize: 12, color: TONE.muted } }, '正在列出工作区文件…')
		          : workspace.error !== undefined
		            ? h('span', { key: 'error', style: { fontSize: 12, color: TONE.bad } }, '读取文件列表失败：' + workspace.error)
		            : h('span', { key: 'count', style: { fontSize: 12, color: TONE.muted } },
		              workspace.files.length === 0 ? '工作区里没有可选的题目文件' : workspace.files.length + ' 个可选文件'),
		      ]),
		      picked.length === 0
		        ? null
		        : h('div', { key: 'picked', style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 } }, picked.map(function (path) {
		          return h('span', {
		            key: path,
		            style: {
		              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '2px 8px', borderRadius: 999,
		              border: '1px solid ' + TONE.line, fontSize: 11.5,
		            },
		          }, [
		            mono(path, { key: 'path' }),
		            h('button', {
		              key: 'remove', type: 'button', 'aria-label': '移除 ' + path,
		              onClick: function () {
		                pickedState[1](picked.filter(function (item) { return item !== path }))
		              },
		              style: { border: 'none', background: 'transparent', color: TONE.muted, cursor: 'pointer', padding: 0 },
		            }, '×'),
		          ])
		        })),
		      openState[0]
		        ? h('div', { key: 'picker' }, [
		          field('过滤', h('input', {
		            key: 'filter', value: filterState[0], placeholder: '输入路径片段，例如 rsa / dist / src',
		            style: INPUT_STYLE, onChange: function (event) { filterState[1](event.target.value) },
		          })),
		          h(FilePickerList, {
		            key: 'files',
		            files: workspace.files,
		            filter: filterState[0],
		            picked: picked,
		            maxHeight: '26vh',
		            onToggle: function (path) {
		              pickedState[1](picked.indexOf(path) >= 0
		                ? picked.filter(function (item) { return item !== path })
		                : picked.concat([path]))
		            },
		          }),
		        ])
		        : null,
		    ]),
		    h('div', { key: 'actions', style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 } }, [
		      h(ActionButton, { key: 'cancel', id: 'cancel', label: '取消', onClick: props.onClose }),
		      h(ActionButton, { key: 'ok', id: 'ok', label: props.busy ? '发送中…' : '开始解题', primary: true, disabled: props.busy === true || goalState[0].trim() === '' }),
		    ]),
		    h('p', { key: 'note', style: { color: TONE.muted, fontSize: 12, marginTop: 8 } },
		      props.autoApprove === false
		        ? '面板只负责把这条指令作为你自己的一条消息发给会话：队长记录题目信息、提交 staged 计划，等你在面板上点「批准并运行」。附件可以在上面直接选，也可以之后用「附件」按钮补。'
		        : '面板只负责把这条指令作为你自己的一条消息发给会话：队长记录题目信息、建队并立刻开跑，不需要你点批准；附件在上面选好会一起交出去，之后也能用「附件」按钮补。'),
		  ])
		}

		/**
		 * Load the workspace file list once per mount. Shared by the standalone
		 * 附件 action and the 开始解题 form, so both offer the same real paths.
		 */
		function useWorkspaceFiles(sessionId) {
		  var filesState = REACT.useState(undefined)
		  var errorState = REACT.useState(undefined)
		  var loadingState = REACT.useState(true)

		  REACT.useEffect(function () {
		    var cancelled = false
		    void (async function () {
		      try {
		        var response = await fetch(FILES_PATH + '?session=' + encodeURIComponent(sessionId), { cache: 'no-store' })
		        if (!response.ok) throw new Error('HTTP ' + response.status)
		        var body = await response.json()
		        if (!cancelled) filesState[1](Array.isArray(body.files) ? body.files : [])
		      } catch (error) {
		        if (!cancelled) errorState[1](String((error && error.message) || error))
		      } finally {
		        if (!cancelled) loadingState[1](false)
		      }
		    })()
		    return function () { cancelled = true }
		  }, [sessionId])

		  return { files: filesState[0] === undefined ? [] : filesState[0], error: errorState[0], loading: loadingState[0] }
		}

		/** Filter box + checkbox list of workspace files (no footer of its own). */
		function FilePickerList(props) {
		  var files = props.files
		  var filter = props.filter.trim().toLowerCase()
		  var shown = filter === '' ? files : files.filter(function (file) { return file.path.toLowerCase().indexOf(filter) >= 0 })
		  return h('div', {
		    key: 'list',
		    style: { maxHeight: props.maxHeight || '38vh', overflowY: 'auto', border: '1px solid ' + TONE.line, borderRadius: 8 },
		  }, shown.length === 0
		    ? h('div', { key: 'empty', style: { padding: '10px 12px', color: TONE.muted } }, props.emptyText || '没有匹配的文件')
		    : shown.slice(0, 200).map(function (file) {
		      var checked = props.picked.indexOf(file.path) >= 0
		      return h('label', {
		        key: file.path,
		        style: { display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 10px', borderBottom: '1px solid ' + TONE.soft, cursor: 'pointer' },
		      }, [
		        h('input', {
		          key: 'box', type: 'checkbox', checked: checked,
		          onChange: function () { props.onToggle(file.path) },
		        }),
		        h('span', { key: 'path', style: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, mono(file.path)),
		        h('span', { key: 'size', style: { color: TONE.muted, fontSize: 11, whiteSpace: 'nowrap' } }, humanSize(file.size)),
		      ])
		    }))
		}

		/** The standalone 附件 dialog: pick files for an existing team. */
		function AttachmentPicker(props) {
		  var workspace = useWorkspaceFiles(props.sessionId)
		  var filterState = REACT.useState('')
		  var pickedState = REACT.useState([])
		  var picked = pickedState[0]

		  return h('div', {}, [
		    h('p', { key: 'hint', style: { color: TONE.muted, fontSize: 12, marginTop: 0 } },
		      '选择工作区里的题目文件（最多 20 个），点击「加入题目」后队长会把它们写进题目附件。'),
		    field('过滤', h('input', {
		      key: 'filter', value: filterState[0], placeholder: '输入路径片段，例如 rsa / dist / src',
		      style: INPUT_STYLE, onChange: function (event) { filterState[1](event.target.value) },
		    })),
		    workspace.loading
		      ? h('p', { key: 'loading', style: { color: TONE.muted } }, '正在列出工作区文件…')
		      : workspace.error !== undefined
		        ? h('p', { key: 'error', style: { color: TONE.bad } }, '读取文件列表失败：' + workspace.error)
		        : h(FilePickerList, {
		          key: 'files',
		          files: workspace.files,
		          filter: filterState[0],
		          picked: picked,
		          onToggle: function (path) {
		            pickedState[1](picked.indexOf(path) >= 0
		              ? picked.filter(function (item) { return item !== path })
		              : picked.concat([path]))
		          },
		        }),
		    h('div', { key: 'actions', style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 } }, [
		      h(ActionButton, { key: 'cancel', id: 'cancel', label: '取消', onClick: props.onClose }),
		      h(ActionButton, {
		        key: 'ok', id: 'ok', label: props.busy ? '发送中…' : '加入题目 (' + picked.length + ')', primary: true,
		        disabled: props.busy === true || picked.length === 0,
		        onClick: function () { props.onSubmit(picked) },
		      }),
		    ]),
		  ])
		}

		function humanSize(bytes) {
		  if (typeof bytes !== 'number' || !isFinite(bytes)) return ''
		  if (bytes < 1024) return bytes + ' B'
		  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
		  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
		}

		/** What a delete would touch, so the confirm is about facts, not a vibe. */
		function usageLine(team) {
		  var parts = []
		  if (typeof team.fileCount === 'number') parts.push(team.fileCount + ' 个文件')
		  if (typeof team.diskBytes === 'number') parts.push(humanSize(team.diskBytes))
		  return parts.join(' · ')
		}

		/**
		 * Team cleanup. Archiving keeps the record reviewable under 「已归档」; purging
		 * frees the space. Both are one click away, but never zero clicks — and an
		 * unsolved team says out loud what gets lost.
		 */
		function DeleteDialog(props) {
		  var team = props.team
		  var unsolved = team.solved !== true
		  return h('div', {}, [
		    h('p', { key: 'facts', style: { marginTop: 0, fontSize: 12.5 } }, [
		      h('span', { key: 'id', style: { marginRight: 10 } }, ['战队 ', mono(team.teamId)]),
		      h('span', { key: 'usage', style: { color: TONE.muted } }, usageLine(team)),
		    ]),
		    h('p', { key: 'path', style: { fontSize: 12, color: TONE.muted, wordBreak: 'break-all' } }, mono(team.workspace)),
		    h('p', {
		      key: 'warning',
		      style: { fontSize: 12.5, color: unsolved ? TONE.warn : TONE.muted },
		    }, unsolved
		      ? '该队尚未解出：删除会丢失成员、任务、findings 与 flag 看板的全部状态（工作区里的文件与 writeup 不受影响）。'
		      : '已解出：writeup 与解题产物都在工作区里，删除只影响队伍状态本身。'),
		    h('div', { key: 'actions', style: { display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end', marginTop: 10 } }, [
		      h(ActionButton, { key: 'cancel', id: 'cancel', label: '取消', onClick: props.onClose }),
		      h(ActionButton, {
		        key: 'archive', id: 'archive', label: props.busy ? '处理中…' : '移到归档', disabled: props.busy === true,
		        title: '保留记录，面板的「已归档」里还能回看',
		        onClick: function () { props.onConfirm('archive') },
		      }),
		      h(ActionButton, {
		        key: 'purge', id: 'purge', label: props.busy ? '处理中…' : '彻底删除', disabled: props.busy === true,
		        title: '从磁盘删除该战队目录，不可恢复',
		        onClick: function () { props.onConfirm('purge') },
		      }),
		    ]),
		  ])
		}

		/** Bulk cleanup: finished teams pile up under `archive/`. */
		function PurgeDialog(props) {
		  var bytes = props.teams.reduce(function (sum, team) {
		    return sum + (typeof team.diskBytes === 'number' ? team.diskBytes : 0)
		  }, 0)
		  return h('div', {}, [
		    h('p', { key: 'facts', style: { marginTop: 0, fontSize: 12.5, wordBreak: 'break-all' } },
		      '将永久删除归档目录里的全部战队记录：' + props.teams.map(function (team) { return team.teamId; }).join('、')),
		    h('p', { key: 'usage', style: { fontSize: 12, color: TONE.muted } },
		      '共 ' + props.teams.length + ' 个 · ' + humanSize(bytes) + '，不可恢复。工作区里的文件与 writeup 不受影响。'),
		    h('div', { key: 'actions', style: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 } }, [
		      h(ActionButton, { key: 'cancel', id: 'cancel', label: '取消', onClick: props.onClose }),
		      h(ActionButton, {
		        key: 'purge', id: 'purge', label: props.busy ? '清理中…' : '清空归档', disabled: props.busy === true,
		        onClick: props.onConfirm,
		      }),
		    ]),
		  ])
		}

		/**
		 * The action bar: every button is one user turn in this session, labelled by
		 * what the captain will do with it. Buttons that only the captain session may
		 * perform are disabled for a member/bystander view instead of failing later.
		 */
		function ActionBar(props) {
		  var team = props.team
		  var isCaptain = team !== undefined && team.role === 'captain'
		  var participates = team !== undefined && team.role !== 'bystander'
		  var candidates = team === undefined ? [] : team.flags.filter(function (flag) { return flag.status === 'candidate' })
		  var newestCandidate = candidates.length === 0 ? undefined : candidates[candidates.length - 1].id
		  var busy = props.busy === true
		  var buttons = []

		  if (team === undefined) {
		    buttons.push(h(ActionButton, { key: 'start', id: 'start', label: '开始解题', primary: true, disabled: busy, onClick: function () { props.onDialog('start') } }))
		  } else if (team.archived === true) {
		    // An archived solve is history: export it, or free the space it occupies.
		    buttons.push(h(ActionButton, { key: 'wp', id: 'wp', label: '导出 WP', onClick: function () { props.onExport('writeup') } }))
		    buttons.push(h(ActionButton, { key: 'report', id: 'report', label: '导出复盘', primary: true, onClick: function () { props.onExport('report') } }))
		    buttons.push(h(ActionButton, {
		      key: 'purge-archive', id: 'purge-archive', label: '清空归档 (' + props.archivedCount + ')',
		      disabled: busy || !isCaptain, title: isCaptain ? '永久删除归档目录里的全部战队记录' : '只有队长会话可以清理',
		      onClick: function () { props.onDialog('purge') },
		    }))
		    buttons.push(h('span', { key: 'note', style: { fontSize: 11.5, color: TONE.muted } }, '已归档战队 · 只读'))
		  } else if (team.phase === 'staged') {
		    buttons.push(h(ActionButton, {
		      key: 'approve', id: 'approve', label: '批准并运行', primary: true, disabled: busy || !isCaptain,
		      title: isCaptain ? undefined : '只有队长会话可以批准',
		      onClick: function () { props.onAction({ action: 'approve' }) },
		    }))
		    buttons.push(h(ActionButton, { key: 'files', id: 'files', label: '附件', disabled: busy || !isCaptain, onClick: function () { props.onDialog('files') } }))
		    buttons.push(h(ActionButton, { key: 'report', id: 'report', label: '导出复盘', onClick: function () { props.onExport('report') } }))
		    buttons.push(h(ActionButton, {
		      key: 'delete', id: 'delete', label: '删除战队', disabled: busy || !isCaptain,
		      title: isCaptain ? '放弃这份计划：归档或彻底删除' : '只有队长会话可以清理战队',
		      onClick: function () { props.onDialog('delete') },
		    }))
		  } else {
		    if (team.phase === 'halted') {
		      buttons.push(h(ActionButton, { key: 'resume', id: 'resume', label: '继续', primary: true, disabled: busy || !isCaptain, onClick: function () { props.onAction({ action: 'resume' }) } }))
		    } else {
		      buttons.push(h(ActionButton, { key: 'nudge', id: 'nudge', label: '推进一轮', disabled: busy || !participates, onClick: function () { props.onAction({ action: 'nudge' }) } }))
		      buttons.push(h(ActionButton, { key: 'halt', id: 'halt', label: '暂停', disabled: busy || !isCaptain, onClick: function () { props.onAction({ action: 'halt' }) } }))
		    }
		    if (newestCandidate !== undefined) {
		      buttons.push(h(ActionButton, {
		        key: 'verify', id: 'verify', label: '核对 flag ' + newestCandidate, disabled: busy || !isCaptain,
		        title: candidates.length > 1 ? '核对最新候选：' + newestCandidate : undefined,
		        onClick: function () { props.onAction({ action: 'verify-flag', flagId: newestCandidate }) },
		      }))
		    }
		    buttons.push(h(ActionButton, { key: 'files', id: 'files', label: '附件', disabled: busy || !isCaptain, onClick: function () { props.onDialog('files') } }))
		    buttons.push(h(ActionButton, { key: 'writeup', id: 'writeup', label: '写 WRITEUP', disabled: busy || !participates, onClick: function () { props.onAction({ action: 'writeup' }) } }))
		    buttons.push(h(ActionButton, { key: 'wp', id: 'wp', label: '导出 WP', disabled: busy, onClick: function () { props.onExport('writeup') } }))
		    buttons.push(h(ActionButton, { key: 'report', id: 'report', label: '导出复盘', disabled: busy, onClick: function () { props.onExport('report') } }))
		    buttons.push(h(ActionButton, {
		      key: 'delete', id: 'delete', label: '删除战队', disabled: busy || !isCaptain,
		      title: isCaptain ? '归档保留记录，或彻底删除释放磁盘' : '只有队长会话可以清理战队',
		      onClick: function () { props.onDialog('delete') },
		    }))
		  }
		  // Deliberately no one-click "archive/delete" here: discarding team work is a
		  // captain-only, protocol-governed decision (`ctf_teams_delete`), and the
		  // panel never gets an affordance that could throw away an unfinished solve.


		  return h('div', {
		    key: 'actions',
		    style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '8px 4px 0' },
		  }, [
		    h('span', { key: 'label', style: { fontSize: 11.5, color: TONE.muted, letterSpacing: '0.08em', marginRight: 2 } }, '操作'),
		    ...buttons,
		  ])
		}

		function DashboardView(props) {
		  var sessionId = props.sessionId
		  var store = REACT.useMemo(function () { return storeFor(sessionId) }, [sessionId])
		  var state = REACT.useSyncExternalStore(store.subscribe, store.getSnapshot)
		  var nowState = REACT.useState(Date.now())
		  var now = nowState[0]
		  var selectedState = REACT.useState(undefined)
		  var selectedId = selectedState[0]
		  var setSelectedId = selectedState[1]
		  var dialogState = REACT.useState(undefined)
		  var dialog = dialogState[0]
		  var busyState = REACT.useState(false)
		  var busy = busyState[0]
		  var noticeState = REACT.useState(undefined)
		  var notice = noticeState[0]

		  REACT.useEffect(function () {
		    store.retain()
		    return function () { store.release() }
		  }, [store])

		  // Re-render every second so the relative ages stay honest between polls.
		  REACT.useEffect(function () {
		    var timer = setInterval(function () { nowState[1](Date.now()) }, 1000)
		    return function () { clearInterval(timer) }
		  }, [nowState])

		  var payload = state.payload
		  var live = payload === undefined ? [] : payload.teams
		  var archived = state.archived === undefined ? [] : state.archived
		  var visible = state.archivedOpen && archived.length > 0 ? archived : live
		  var selected = visible.filter(function (candidate) { return candidate.teamId === selectedId })[0]
		  if (selected === undefined) {
		    selected = visible.filter(function (candidate) { return candidate.role !== 'bystander' })[0] || visible[0]
		  }

		  var statusText = state.status === 'ready' ? '实时'
		    : state.status === 'stale' ? '重连中'
		      : state.status === 'error' ? '连接失败' : '加载中'
		  var statusColor = state.status === 'ready' ? TONE.ok
		    : state.status === 'stale' ? TONE.warn
		      : state.status === 'error' ? TONE.bad : TONE.muted

		  /** Send one panel action and surface the host's answer. */
		  function runAction(body) {
		    busyState[1](true)
		    noticeState[1](undefined)
		    var request = Object.assign({ sessionId: sessionId }, selected === undefined ? {} : { teamId: selected.teamId }, body)
		    void postAction(request).then(function (result) {
		      busyState[1](false)
		      noticeState[1]({ kind: 'ok', text: (result && result.message) || '已发送' })
		      store.refresh()
		    }, function (error) {
		      busyState[1](false)
		      noticeState[1]({ kind: 'bad', text: String((error && error.message) || error) })
		    })
		  }

		  /** Export a document; the browser owns the download. */
		  function runExport(kind) {
		    if (selected === undefined) return
		    busyState[1](true)
		    noticeState[1](undefined)
		    void downloadExport(sessionId, selected.teamId, kind, selected.teamId + (kind === 'report' ? '-report.md' : '-WRITEUP.md'))
		      .then(function (name) {
		        busyState[1](false)
		        noticeState[1]({ kind: 'ok', text: '已导出 ' + name })
		      }, function (error) {
		        busyState[1](false)
		        noticeState[1]({ kind: 'bad', text: String((error && error.message) || error) })
		      })
		  }

		  var dialogs = []
		  if (dialog === 'start') {
		    dialogs.push(h(Modal, { key: 'start', title: '开始解题', onClose: function () { dialogState[1](undefined) } }, h(StartForm, {
		      sessionId: sessionId,
		      profiles: payload === undefined || !Array.isArray(payload.profiles) ? [] : payload.profiles,
		      autoApprove: payload === undefined ? true : payload.autoApprove !== false,
		      busy: busy,
		      onClose: function () { dialogState[1](undefined) },
		      onSubmit: function (form) {
		        dialogState[1](undefined)
		        runAction(Object.assign({ action: 'start' }, form))
		      },
		    })))
		  }
		  if (dialog === 'delete' && selected !== undefined) {
		    dialogs.push(h(Modal, { key: 'delete', title: '清理战队', onClose: function () { dialogState[1](undefined) } }, h(DeleteDialog, {
		      team: selected,
		      busy: busy,
		      onClose: function () { dialogState[1](undefined) },
		      onConfirm: function (mode) {
		        dialogState[1](undefined)
		        runAction({ action: 'delete-team', mode: mode })
		      },
		    })))
		  }
		  if (dialog === 'purge') {
		    dialogs.push(h(Modal, { key: 'purge', title: '清空归档', onClose: function () { dialogState[1](undefined) } }, h(PurgeDialog, {
		      teams: archived,
		      busy: busy,
		      onClose: function () { dialogState[1](undefined) },
		      onConfirm: function () {
		        dialogState[1](undefined)
		        runAction({ action: 'purge-archive' })
		      },
		    })))
		  }
		  if (dialog === 'files' && selected !== undefined) {
		    dialogs.push(h(Modal, { key: 'files', title: '选择题目附件', onClose: function () { dialogState[1](undefined) } }, h(AttachmentPicker, {
		      sessionId: sessionId,
		      busy: busy,
		      onClose: function () { dialogState[1](undefined) },
		      onSubmit: function (paths) {
		        dialogState[1](undefined)
		        runAction({ action: 'attachments', attachments: paths })
		      },
		    })))
		  }

		  return h('div', {
		    'data-ctf-teams-dashboard': 'true',
		    style: {
		      height: '100%', minHeight: 0, boxSizing: 'border-box', overflowY: 'auto',
		      padding: '0 20px 24px', color: 'inherit', font: 'inherit',
		    },
		  }, [
		    h('div', {
		      key: 'statusbar',
		      style: {
		        position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', gap: 10,
		        padding: '10px 4px 8px', borderBottom: '1px solid ' + TONE.line, background: 'inherit',
		      },
		    }, [
		      h('strong', { key: 'title', style: { fontSize: 13, letterSpacing: '0.04em' } }, 'CTF 解题面板'),
		      h('span', {
		        key: 'dot',
		        style: { width: 7, height: 7, borderRadius: 999, background: statusColor, display: 'inline-block', flex: '0 0 auto' },
		      }),
		      h('span', { key: 'status', style: { fontSize: 12, color: TONE.muted } },
		        statusText + (payload === undefined ? '' : ' · 数据 ' + age(payload.generatedAt, now))),
		      h('span', { key: 'spacer', style: { flex: 1 } }),
		      state.error ? h('span', { key: 'error', style: { fontSize: 12, color: TONE.bad } }, state.error) : null,
		    ]),
		    h(ActionBar, {
		      key: 'actionbar',
		      team: selected,
		      busy: busy,
		      archivedCount: archived.length,
		      onAction: runAction,
		      onDialog: function (which) { dialogState[1](which) },
		      onExport: runExport,
		    }),
		    notice === undefined
		      ? null
		      : h('div', {
		        key: 'notice',
		        role: 'status',
		        style: {
		          margin: '6px 4px 0', padding: '6px 10px', borderRadius: 6, fontSize: 12.5,
		          border: '1px solid ' + (notice.kind === 'ok' ? TONE.line : TONE.bad),
		          color: notice.kind === 'ok' ? 'inherit' : TONE.bad,
		          background: notice.kind === 'ok' ? TONE.soft : 'rgba(209,36,47,0.08)',
		        },
		      }, notice.text),
		    (live.length + archived.length) > 0
		      ? h('div', { key: 'switcher', style: { display: 'flex', gap: 6, flexWrap: 'wrap', padding: '8px 4px 0' } }, [
		        live.length + archived.length > 1
		          ? live.map(function (team) { return teamButton(team, selected !== undefined && selected.teamId === team.teamId, setSelectedId) })
		          : null,
		        archived.length > 0
		          ? h('button', {
		            key: 'archived-toggle',
		            onClick: function () { void store.toggleArchived() },
		            style: {
		              padding: '3px 10px', borderRadius: 999, cursor: 'pointer', fontSize: 12, color: 'inherit',
		              border: '1px solid ' + TONE.line, background: state.archivedOpen ? TONE.soft : 'transparent',
		            },
		          }, state.archivedOpen ? '返回进行中' : '查看已归档 (' + archived.length + ')')
		          : null,
		      ])
		      : null,
		    selected === undefined
		      ? (state.status === 'loading'
		        ? h('div', { key: 'loading', style: { padding: '28px 8px', color: TONE.muted, fontSize: 13 } }, '正在读取战队状态…')
		        : h('div', { key: 'empty', style: { padding: '28px 8px', color: TONE.muted, fontSize: 13 } }, [
		          h('div', { key: 'title', style: { fontSize: 15, color: 'inherit', marginBottom: 6 } }, '这个会话还没有 CTFTeams 战队'),
		          h('div', { key: 'body' }, '点上面的「开始解题」填题目信息，面板会把它作为你的一条消息发给会话；也可以直接说「用 CTFTeams 解这道题」。'),
		        ]))
		      : h(TeamView, { key: 'view:' + selected.teamId, team: selected, now: now }),
		    dialogs,
		  ])
		}

		/* ── client plugin contract ─────────────────────────────────────────────── */

		/** Required client services: the slot ledger hosting the conversation views. */
		exports.inject = ['slots']

		/**
		 * Test seam for the headless bundle gate (`scripts/client-verify.mjs`): it
		 * needs to publish a new host payload without waiting a poll interval. Not a
		 * public API and not used by the view itself.
		 */
		exports.__test = { storeFor: storeFor }

		exports.apply = function apply(ctx) {
		  ctx.effect(function () {
		    return ctx.slots.inject('conversation.view', function () {
		      return ctx.slots.register({
		        name: 'conversation.view',
		        id: VIEW_ID,
		        order: VIEW_ORDER,
		        label: function () { return '解题面板' },
		        inject: function (sessionId) { return { sessionId: sessionId } },
		      }, DashboardView)
		    })
		  }, 'ctf-teams: dashboard view')
		}
		return module.exports;
	}
});

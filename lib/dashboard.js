/**
 * The CTFTeams terminal dashboard.
 *
 * A pure renderer: one box-drawing panel that turns durable team state into
 * the at-a-glance solving picture (challenge, lanes, task board, findings,
 * flags). No web UI — the panel renders into the harness transcript itself,
 * as the `ctf_teams_status` tool output and as the `/ctf-teams-board` command
 * result. Alignment is display-width aware so CJK findings stay inside the
 * box.
 *
 * @module dsh-ctf-teams/dashboard
 */
import { challengeOf, DEFAULT_FLAG_FORMAT } from "./findings.js";
/** Panel content width (between the `│` borders), including the 1-space pads. */
export const PANEL_WIDTH = 78;
/** East-Asian width and emoji count as 2 columns; everything else as 1. */
export function displayWidth(text) {
    let width = 0;
    for (const char of text) {
        const code = char.codePointAt(0) ?? 0;
        width += (code >= 0x1100 && (code <= 0x115f // Hangul Jamo
            || code === 0x2329 || code === 0x232a
            || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
            || (code >= 0xac00 && code <= 0xd7a3)
            || (code >= 0xf900 && code <= 0xfaff)
            || (code >= 0xfe30 && code <= 0xfe6f)
            || (code >= 0xff00 && code <= 0xff60)
            || (code >= 0xffe0 && code <= 0xffe6)
            || (code >= 0x1f300 && code <= 0x1f64f)
            || (code >= 0x1f900 && code <= 0x1f9ff)
            || (code >= 0x20000 && code <= 0x3fffd))) ? 2 : 1;
    }
    return width;
}
/** Cut a string to at most `width` display columns, appending `…` when cut. */
export function truncateToWidth(text, width) {
    if (width <= 0)
        return '';
    let out = '';
    let used = 0;
    for (const char of text) {
        const charWidth = displayWidth(char);
        if (used + charWidth > width) {
            // The cut marker needs a column of its own; drop trailing columns until
            // it fits, so the result is exactly `width` columns and never silently
            // eats a string that already fits.
            while (used > 0 && used + 1 > width) {
                const dropped = [...out].pop() ?? '';
                out = out.slice(0, out.length - dropped.length);
                used -= displayWidth(dropped);
            }
            return `${out}…`;
        }
        out += char;
        used += charWidth;
    }
    return out;
}
/** Pad a string with spaces to exactly `width` display columns. */
export function padEndWidth(text, width) {
    const padding = width - displayWidth(text);
    return padding <= 0 ? text : text + ' '.repeat(padding);
}
function fit(text, width) {
    return padEndWidth(truncateToWidth(text, width), width);
}
function row(label, content) {
    return `│ ${fit(label, 11)}${fit(content, PANEL_WIDTH - 15)} │`;
}
/** Section bar; `detail` (a live counter, progress bar, …) rides the right side. */
function section(title, detail = '') {
    const inner = PANEL_WIDTH - 4;
    if (detail === '')
        return `├─ ${fit(title, inner)}┤`;
    const detailText = truncateToWidth(detail, Math.max(8, inner - 6));
    const head = truncateToWidth(title, Math.max(1, inner - displayWidth(detailText) - 4));
    const dashes = '─'.repeat(Math.max(2, inner - displayWidth(head) - displayWidth(detailText) - 2));
    return `├─ ${fit(`${head} ${dashes} ${detailText}`, inner)}┤`;
}
function blank() {
    return `│${' '.repeat(PANEL_WIDTH - 2)}│`;
}
function statusGlyph(status) {
    switch (status) {
        case 'completed': return '✓';
        case 'in_progress': return '▶';
        case 'claimed': return '▶';
        case 'failed': return '✗';
        case 'cancelled': return '⊘';
        default: return '·';
    }
}
function flagGlyph(status) {
    switch (status) {
        case 'verified': return '✓';
        case 'rejected': return '✗';
        default: return '?';
    }
}
function agentGlyph(member) {
    if (member.status === 'removed')
        return '⊘';
    if (member.activity === 'working' || member.status === 'working')
        return '●';
    if (member.activity === 'unspawned' || member.status === 'unspawned')
        return '◇';
    return '○';
}
/** The solved/pending marker shown in the panel header. */
function challengeState(challenge) {
    if (challenge.solved === true)
        return '🚩 SOLVED';
    return '◌ unsolved';
}
function challengeTitle(challenge, fallback) {
    const title = challenge.title?.trim() || fallback;
    const bits = [
        title,
        challenge.category,
        challenge.points === undefined ? undefined : `${challenge.points}pts`,
    ].filter((bit) => bit !== undefined && bit !== '');
    return bits.join(' · ');
}
const FINDING_ROW_LIMIT = 6;
const FLAG_ROW_LIMIT = 5;
const TASK_ROW_LIMIT = 8;
/** `[██████░░░░░░] 8/12` — the one-glance progress marker. */
export function progressBar(done, total, width = 16) {
    if (!Number.isFinite(total) || total <= 0)
        return `[${'░'.repeat(width)}] 0/0`;
    const filled = Math.max(0, Math.min(width, Math.round((done / total) * width)));
    return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${done}/${total}`;
}
/** Compact age, so a stale board reads as stale at a glance. */
export function formatAge(ms) {
    if (!Number.isFinite(ms) || ms < 0)
        return '-';
    const seconds = Math.floor(ms / 1000);
    if (seconds < 5)
        return 'just now';
    if (seconds < 60)
        return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours}h${String(minutes % 60).padStart(2, '0')}m ago`;
    return `${Math.floor(hours / 24)}d ago`;
}
/**
 * The single most useful next action for whoever reads the panel, derived from
 * the same state the panel shows. Ordered by urgency: a human decision first,
 * then an unverified flag, then idle lanes with ready work.
 */
export function nextStepHint(input) {
    const challenge = input.challenge;
    const open = input.tasks.filter((task) => !['completed', 'failed', 'cancelled'].includes(task.status));
    const pending = open.filter((task) => task.status === 'pending');
    const active = open.filter((task) => task.status === 'in_progress' || task.status === 'claimed');
    const candidates = input.flags.filter((flag) => flag.status === 'candidate');
    const live = input.members.filter((member) => member.status !== 'removed');
    const working = live.filter((member) => member.status === 'working' || member.activity === 'working');
    if (input.phase === 'staged')
        return 'the plan is staged — approve & run to dispatch the squad';
    if (input.phase === 'halted')
        return 'team halted — ctf_teams_resume with a reason to continue';
    if (input.phase === 'escalated')
        return 'review loop hit its ceiling — escalate to the user or amend the contract';
    if (challenge.solved === true)
        return 'solved — finish WRITEUP.md, then clean the team up (归档 / 删除) from the panel';
    if (candidates.length > 0)
        return `verify ${candidates.map((flag) => flag.id).join(', ')} against the platform, then ctf_teams_mark_flag`;
    if (input.tasks.length === 0)
        return 'no task graph yet — create the team plan (recon first, then one task per angle)';
    if (working.length === 0 && pending.length > 0)
        return `${pending.length} pending task(s) and nobody working — dispatch or reassign`;
    if (working.length > 0)
        return 'lanes are working — round sync pushes findings; ctf_teams_sync pulls the rest';
    if (active.length > 0)
        return `${active.length} task(s) in flight — wait for the owner, then verify the result`;
    if (pending.length > 0)
        return `${pending.length} ready task(s) — dispatch them or let the scheduler wake the owners`;
    return 'every task is terminal — present the result and converge on the writeup';
}
/**
 * Render the full dashboard panel. Pure; never throws on partial state, so a
 * damaged team record still renders whatever is readable.
 */
export function renderDashboard(input) {
    const challenge = { flagFormat: DEFAULT_FLAG_FORMAT, ...input.challenge };
    const title = challengeTitle(challenge, input.teamName);
    const now = input.now ?? Date.now();
    const verified = input.flags.filter((flag) => flag.status === 'verified').length;
    const working = input.members.filter((member) => member.status !== 'removed' && (member.status === 'working' || member.activity === 'working')).length;
    const live = input.members.filter((member) => member.status !== 'removed').length;
    const done = input.tasks.filter((task) => task.status === 'completed').length;
    const elapsed = input.createdAt === undefined ? undefined : formatAge(now - input.createdAt).replace(' ago', '');
    const lastBeat = input.lastBeatAt === undefined ? undefined : formatAge(now - input.lastBeatAt);
    const meta = [
        input.phase === 'running' ? 'running' : input.phase,
        `round ${input.round}`,
        ...elapsed === undefined ? [] : [elapsed],
        `${input.findingCount} finding${input.findingCount === 1 ? '' : 's'}`,
        `${input.flags.length} flag${input.flags.length === 1 ? '' : 's'}`,
    ].join(' · ');
    const top = `╭─ CTF TEAMS ── ${challengeState(challenge)} ${'─'.repeat(Math.max(2, PANEL_WIDTH - 18 - displayWidth(challengeState(challenge))))}╮`;
    const lines = [
        top,
        row('Challenge', title),
        ...(challenge.remote === undefined ? [] : [row('Remote', challenge.remote)]),
        ...(challenge.attachments === undefined || challenge.attachments.length === 0 ? [] : [row('Files', challenge.attachments.join(', '))]),
        ...(challenge.flagFormat === undefined ? [] : [row('Flag fmt', `/${challenge.flagFormat}/`)]),
        row('Status', meta),
    ];
    if (input.description !== undefined && input.description.trim() !== '') {
        lines.push(row('Goal', input.description));
    }
    // Agents: one row per lane — name, live state (with sync badge), and the
    // task it currently owns or its role.
    lines.push(section('Agents', `${working}/${live} working`));
    if (input.members.length === 0) {
        lines.push(row('', '(no members yet — the plan is staged)'));
    }
    for (const member of input.members) {
        const state = member.status === 'removed'
            ? 'removed'
            : member.activity === 'unspawned' || member.status === 'unspawned' ? 'unspawned' : member.activity ?? member.status;
        const behind = member.behind ?? 0;
        const lane = `${agentGlyph(member)} ${member.name}`;
        const stateText = behind > 0 ? `${state} ⚡${behind}` : state;
        const work = member.workingOn ?? member.role ?? '';
        const body = `${fit(lane, 14)}${fit(stateText, 13)}${fit(work, PANEL_WIDTH - 15 - 14 - 13)}`;
        lines.push(`│ ${fit(body, PANEL_WIDTH - 4)} │`);
    }
    // Task board: the progress bar and the last board beat ride the section bar,
    // open work first, then a one-line census.
    const beatDetail = lastBeat === undefined ? '' : ` · last beat ${lastBeat}`;
    lines.push(section('Task board', `${progressBar(done, input.tasks.length)}${beatDetail}`));
    const open = input.tasks.filter((task) => !['completed', 'failed', 'cancelled'].includes(task.status));
    const closed = input.tasks.filter((task) => ['completed', 'failed', 'cancelled'].includes(task.status));
    const rows = [...open, ...closed.slice(-Math.max(0, TASK_ROW_LIMIT - open.length))].slice(0, TASK_ROW_LIMIT);
    if (input.tasks.length === 0) {
        lines.push(row('', '(no tasks yet)'));
    }
    for (const task of rows) {
        const glyph = statusGlyph(task.status);
        const who = task.assignee ?? 'unassigned';
        const title = truncateToWidth(task.subject, PANEL_WIDTH - 26);
        lines.push(row(`${task.id} ${glyph}`, `${title} → ${who}`));
    }
    const census = [
        `${done} done`,
        `${open.filter((task) => task.status === 'in_progress' || task.status === 'claimed').length} active`,
        `${open.filter((task) => task.status === 'pending').length} pending`,
        ...input.tasks.filter((task) => task.status === 'failed').length === 0
            ? [] : [`${input.tasks.filter((task) => task.status === 'failed').length} failed`],
        ...input.tasks.filter((task) => task.status === 'cancelled').length === 0
            ? [] : [`${input.tasks.filter((task) => task.status === 'cancelled').length} cancelled`],
    ].join(' · ');
    lines.push(row('', census));
    // Findings: oldest of the window at the top; the section bar carries the
    // count and how fresh the newest beat is, so row width stays with content.
    const recentFindings = input.findings.slice(-FINDING_ROW_LIMIT);
    const newestFinding = recentFindings.at(-1);
    const freshness = newestFinding === undefined || !Number.isFinite(newestFinding.ts)
        ? ''
        : ` · newest ${formatAge(now - newestFinding.ts)}`;
    lines.push(section('Findings (latest)', `${input.findingCount} total${freshness}`));
    if (recentFindings.length === 0) {
        lines.push(row('', '(nothing reported yet — members post findings as they work)'));
    }
    for (const finding of recentFindings) {
        const tag = finding.category === undefined ? finding.from : `${finding.from}/${finding.category}`;
        lines.push(row(`r${finding.round} ${finding.id}`, `[${tag}] ${finding.content}`));
    }
    // Flags: verification state is the single most important signal.
    const verifiedNote = verified === 0 ? '' : ` · ${verified} verified`;
    lines.push(section('Flags', `${input.flags.length} total${verifiedNote}`));
    const recentFlags = input.flags.slice(-FLAG_ROW_LIMIT);
    if (recentFlags.length === 0) {
        lines.push(row('', '(no candidates yet — submit with ctf_teams_submit_flag)'));
    }
    for (const flag of recentFlags) {
        const flagText = flag.status === 'verified' ? flag.flag : truncateToWidth(flag.flag, 34);
        const note = flag.note === undefined ? '' : ` — ${truncateToWidth(flag.note, 24)}`;
        lines.push(row(`${flag.id} ${flagGlyph(flag.status)}`, `${flagText} by ${flag.submittedBy}${note}`));
    }
    if (input.captainUnread !== undefined && input.captainUnread > 0) {
        lines.push(row('', `✉ ${input.captainUnread} unread captain message${input.captainUnread === 1 ? '' : 's'}`));
    }
    // The actionable line: what to do next, straight from the state above.
    lines.push(row('Next', `▸ ${nextStepHint(input)}`));
    const phase = input.phase === 'running' ? 'live' : input.phase;
    lines.push(`╰─ ${fit(`${phase} · ctf_teams_status for the full detail`, PANEL_WIDTH - 4)}╯`);
    return lines.join('\n');
}
/**
 * Build the dashboard input from a durable team snapshot plus live extras.
 * `activity` maps member id → harness activity label; missing ids render as
 * `unspawned`.
 */
export function dashboardInputFromTeam(team, extras = {}) {
    const phase = team.halted === true
        ? 'halted'
        : team.escalated === true ? 'escalated' : team.phase ?? 'running';
    const members = team.members
        .filter((member) => member.status !== 'removed')
        .map((member) => ({
        name: member.name,
        role: member.role,
        status: member.status,
        activity: member.id === '' ? 'unspawned' : extras.activity?.get(member.id) ?? member.status,
        route: member.provider !== undefined && member.model !== undefined ? `${member.provider}/${member.model}` : undefined,
        behind: extras.memberBehind?.get(member.name) ?? 0,
        workingOn: extras.openTaskByMember?.get(member.name),
    }));
    return {
        teamName: team.name,
        description: team.description,
        phase,
        challenge: challengeOf(team),
        round: team.round ?? 0,
        findingCount: team.findings?.length ?? 0,
        flags: team.flags ?? [],
        findings: team.findings ?? [],
        members,
        tasks: team.tasks,
        captainUnread: extras.captainUnread,
        createdAt: team.createdAt,
        lastBeatAt: lastBoardBeat(team),
        now: Date.now(),
    };
}
/** Newest recorded board beat: a finding, a flag, or a task update. */
function lastBoardBeat(team) {
    const stamps = [
        ...(team.findings ?? []).map((finding) => finding.ts),
        ...(team.flags ?? []).map((flag) => flag.ts),
        ...team.tasks.map((task) => task.updatedAt),
    ].filter((stamp) => Number.isFinite(stamp));
    return stamps.length === 0 ? undefined : Math.max(...stamps);
}
/** Compact single-line header for command results that do not need the panel. */
export function renderDashboardHeader(team) {
    const challenge = challengeOf(team);
    const verified = (team.flags ?? []).filter((flag) => flag.status === 'verified').length;
    const tasks = team.tasks ?? [];
    const done = tasks.filter((task) => task.status === 'completed').length;
    const state = challenge.solved === true ? 'SOLVED' : 'unsolved';
    return `CTF "${team.name}" — ${challengeTitle(challenge, team.name)} — ${state} — round ${team.round ?? 0} · ${progressBar(done, tasks.length)} · flags ${(team.flags ?? []).length} (${verified} verified)`;
}

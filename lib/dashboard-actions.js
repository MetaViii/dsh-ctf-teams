/**
 * The dashboard's interactive half: validated panel actions.
 *
 * Every button in the 解题面板 becomes **one user turn in the session** — the
 * panel never mutates team state itself. That keeps a single authority (the
 * captain agent + the `ctf_teams_*` tools, which already enforce the protocol:
 * staged approval, flag verdicts, attachment writes) and keeps the transcript
 * honest: the panel action appears as the user's own message, so a later
 * reader can see exactly what was clicked.
 *
 * The endpoint is therefore deliberately not a generic "run this prompt"
 * gadget: the client sends an action name plus typed parameters, the host
 * validates them against durable state and composes the instruction text here.
 *
 * @module dsh-ctf-teams/dashboard-actions
 */
import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { WRITEUP_PATH, WRITEUP_SPEC } from "./writeup.js";
const ACTIONS = [
    'start', 'approve', 'halt', 'resume', 'verify-flag', 'nudge', 'attachments', 'writeup',
    'delete-team', 'purge-archive',
];
const LIMITS = {
    text: 4000,
    short: 500,
    tiny: 120,
    attachments: 20,
    attachmentPath: 400,
};
function clip(value, max) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    if (trimmed === '')
        return undefined;
    return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}
function stringList(value, max, itemMax) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value))
        return undefined;
    const items = value
        .map((item) => clip(item, itemMax))
        .filter((item) => item !== undefined);
    return [...new Set(items)].slice(0, max);
}
/**
 * Validate one panel request.
 * @param raw - the parsed JSON body.
 * @returns the typed body, or a rejection describing what is wrong.
 */
export function parseActionBody(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        return { ok: false, status: 400, error: 'body must be a JSON object' };
    }
    const record = raw;
    const sessionId = clip(record.sessionId, LIMITS.short);
    if (sessionId === undefined)
        return { ok: false, status: 400, error: 'sessionId is required' };
    const action = clip(record.action, LIMITS.tiny);
    if (action === undefined || !ACTIONS.includes(action)) {
        return { ok: false, status: 400, error: `unknown action; expected one of ${ACTIONS.join(', ')}` };
    }
    const mode = record.mode === 'purge' ? 'purge' : record.mode === 'archive' ? 'archive' : undefined;
    const pointsRaw = record.points;
    const points = typeof pointsRaw === 'number' && Number.isFinite(pointsRaw) && pointsRaw >= 0
        ? Math.floor(pointsRaw)
        : undefined;
    const body = {
        sessionId,
        action,
        ...mode === undefined ? {} : { mode },
        ...clip(record.teamId, LIMITS.tiny) === undefined ? {} : { teamId: clip(record.teamId, LIMITS.tiny) },
        ...clip(record.goal, LIMITS.text) === undefined ? {} : { goal: clip(record.goal, LIMITS.text) },
        ...clip(record.profile, LIMITS.tiny) === undefined ? {} : { profile: clip(record.profile, LIMITS.tiny) },
        ...clip(record.remote, LIMITS.short) === undefined ? {} : { remote: clip(record.remote, LIMITS.short) },
        ...clip(record.category, LIMITS.tiny) === undefined ? {} : { category: clip(record.category, LIMITS.tiny) },
        ...points === undefined ? {} : { points },
        ...clip(record.flagFormat, LIMITS.tiny) === undefined ? {} : { flagFormat: clip(record.flagFormat, LIMITS.tiny) },
        ...stringList(record.attachments, LIMITS.attachments, LIMITS.attachmentPath) === undefined
            ? {} : { attachments: stringList(record.attachments, LIMITS.attachments, LIMITS.attachmentPath) },
        ...clip(record.flagId, LIMITS.tiny) === undefined ? {} : { flagId: clip(record.flagId, LIMITS.tiny) },
        ...clip(record.reason, LIMITS.short) === undefined ? {} : { reason: clip(record.reason, LIMITS.short) },
    };
    return { ok: true, body };
}
/** The panel-origin banner every composed instruction carries. */
function panelBlock(lines) {
    return ['【解题面板】', ...lines].join('\n');
}
/**
 * Compose the instruction for one action.
 * @param body - the validated body.
 * @param context - durable facts the composition depends on.
 * @returns the instruction text plus its authority requirement, or a rejection.
 */
export function prepareAction(body, context) {
    const autoApprove = context.autoApprove ?? true;
    const team = context.team;
    switch (body.action) {
        case 'start': {
            if (team !== undefined) {
                return { ok: false, status: 409, error: `team "${team.id}" already exists in this session — approve or continue it instead` };
            }
            if (body.goal === undefined)
                return { ok: false, status: 400, error: 'goal is required to start a solve' };
            if (body.profile !== undefined && !context.profiles.includes(body.profile)) {
                return { ok: false, status: 400, error: `unknown CTFTeams profile "${body.profile}"` };
            }
            const facts = [
                `- 目标/题目描述: ${body.goal}`,
                ...body.remote === undefined ? [] : [`- 远程: ${body.remote}`],
                ...body.category === undefined ? [] : [`- 分类: ${body.category}`],
                ...body.points === undefined ? [] : [`- 分值: ${body.points}`],
                ...body.flagFormat === undefined ? [] : [`- flag 格式: ${body.flagFormat}`],
                ...body.attachments === undefined ? [] : [`- 附件: ${body.attachments.join(', ')}`],
            ];
            const invocation = `/ctf-teams${body.profile === undefined ? '' : ` --profile ${body.profile}`} ${body.goal}`;
            return {
                ok: true,
                prepared: {
                    action: 'start',
                    label: '开始解题',
                    requires: 'none',
                    prompt: [
                        invocation,
                        '',
                        panelBlock([
                            '用户在 CTF 解题面板点击了「开始解题」，题目信息如下：',
                            ...facts,
                            autoApprove
                                ? '按 CTFTeams 协议执行：先用 ctf_teams_set_challenge 记录以上题目信息，再用 ctf_teams_create(approval="automatic") 在同一次调用里提交完整阵容与任务 DAG 并立刻开跑——用户已经明确不要人工批准这一步，不要提交 staged 计划、不要停下来等确认。随后按调度派发就绪任务，盯到 flag 验证通过且 writeup 写完为止；中途不要把控制权交回给用户。'
                                : '按 CTFTeams 协议执行：先用 ctf_teams_set_challenge 记录以上题目信息，再用 ctf_teams_create(approval="required") 提交完整的 staged 计划（阵容 + 任务 DAG），然后停下等我在面板上批准。不要在本轮批准或启动。',
                        ]),
                    ].join('\n'),
                },
            };
        }
        case 'approve': {
            if (team === undefined)
                return { ok: false, status: 404, error: 'no team to approve' };
            if (team.phase !== 'staged')
                return { ok: false, status: 409, error: 'the team is not staged' };
            return {
                ok: true,
                prepared: {
                    action: 'approve', label: '批准并运行', requires: 'captain',
                    prompt: panelBlock([
                        `用户在解题面板点击了「批准并运行」，批准战队 ${team.id} 的 staged 计划。`,
                        '按 CTFTeams 协议调用 ctf_teams_approve 启动它，然后按调度规则派发就绪任务、唤醒空闲成员。',
                    ]),
                },
            };
        }
        case 'halt': {
            if (team === undefined)
                return { ok: false, status: 404, error: 'no team to halt' };
            if (team.halted === true)
                return { ok: false, status: 409, error: 'the team is already halted' };
            return {
                ok: true,
                prepared: {
                    action: 'halt', label: '暂停', requires: 'captain',
                    prompt: panelBlock([
                        `用户在解题面板点击了「暂停」战队 ${team.id}。`,
                        '按协议把人工作为停止信号：停止派发新任务、把队伍置为 halted，并简要说明当前已完成的检查点（不要丢弃任何工作）。',
                    ]),
                },
            };
        }
        case 'resume': {
            if (team === undefined)
                return { ok: false, status: 404, error: 'no team to resume' };
            if (team.halted !== true)
                return { ok: false, status: 409, error: 'the team is not halted' };
            return {
                ok: true,
                prepared: {
                    action: 'resume', label: '继续', requires: 'captain',
                    prompt: panelBlock([
                        `用户在解题面板点击了「继续」，要求恢复战队 ${team.id}。`,
                        `理由: ${body.reason ?? '用户在面板上确认继续'}`,
                        '按协议用 ctf_teams_resume 恢复，并派发尚未完成的就绪任务。',
                    ]),
                },
            };
        }
        case 'verify-flag': {
            if (team === undefined)
                return { ok: false, status: 404, error: 'no team' };
            const flag = (team.flags ?? []).find((candidate) => candidate.id === body.flagId);
            if (flag === undefined)
                return { ok: false, status: 404, error: `unknown flag candidate "${body.flagId ?? ''}"` };
            if (flag.status !== 'candidate')
                return { ok: false, status: 409, error: `flag ${flag.id} is already ${flag.status}` };
            return {
                ok: true,
                prepared: {
                    action: 'verify-flag', label: '核对 flag', requires: 'captain',
                    prompt: panelBlock([
                        `用户在解题面板要求核对候选 flag ${flag.id}（${flag.flag}）。`,
                        '先核对平台/出题人给出的判定，再用 ctf_teams_mark_flag 记录 verdict；不要在没有核对的情况下标记 verified。',
                    ]),
                },
            };
        }
        case 'nudge': {
            if (team === undefined)
                return { ok: false, status: 404, error: 'no team' };
            return {
                ok: true,
                prepared: {
                    action: 'nudge', label: '推进一轮', requires: 'participant',
                    prompt: panelBlock([
                        `用户在解题面板点击了「推进一轮」（战队 ${team.id}，当前第 ${team.round ?? 0} 轮）。`,
                        '用 ctf_teams_status 检查状态，派发就绪任务、唤醒落后成员（⚡ 未同步的），然后把本轮结论简要汇报后结束本轮；不要空转。',
                    ]),
                },
            };
        }
        case 'attachments': {
            if (team === undefined)
                return { ok: false, status: 404, error: 'no team' };
            if (body.attachments === undefined || body.attachments.length === 0) {
                return { ok: false, status: 400, error: 'attachments[] is required' };
            }
            return {
                ok: true,
                prepared: {
                    action: 'attachments', label: '加入附件', requires: 'captain',
                    prompt: panelBlock([
                        `用户在解题面板为题目选择了这些附件（工作区相对路径）：`,
                        ...body.attachments.map((path) => `- ${path}`),
                        `用 ctf_teams_set_challenge 把它们并入题目附件列表（保留已有附件，去重），然后用一句话确认。`,
                    ]),
                },
            };
        }
        case 'writeup': {
            if (team === undefined)
                return { ok: false, status: 404, error: 'no team' };
            return {
                ok: true,
                prepared: {
                    action: 'writeup', label: '写 WRITEUP', requires: 'participant',
                    prompt: panelBlock([
                        `用户在解题面板要求产出 writeup（战队 ${team.id}）。`,
                        `把解题记录写入工作区根目录的 ${WRITEUP_PATH}。`,
                        '',
                        WRITEUP_SPEC,
                    ]),
                },
            };
        }
        default: {
            return { ok: false, status: 400, error: 'unknown action' };
        }
    }
}
/**
 * Validate one panel request and decide how it is carried out: a prompt turn
 * for anything that needs the captain, or a direct housekeeping mutation for
 * the two actions that only touch durable files.
 * @param body - the validated body.
 * @param context - durable facts the decision depends on.
 * @returns the prepared request, or a rejection.
 */
export function prepareRequest(body, context) {
    if (body.action === 'delete-team') {
        const team = context.team;
        if (team === undefined)
            return { ok: false, status: 404, error: 'no team to delete' };
        return {
            ok: true,
            request: {
                kind: 'mutation',
                mutation: {
                    action: 'delete-team',
                    label: body.mode === 'purge' ? '彻底删除' : '移到归档',
                    mode: body.mode ?? 'archive',
                    requires: 'captain',
                },
            },
        };
    }
    if (body.action === 'purge-archive') {
        return {
            ok: true,
            request: {
                kind: 'mutation',
                mutation: { action: 'purge-archive', label: '清空归档', requires: 'live' },
            },
        };
    }
    const prepared = prepareAction(body, context);
    if (prepared.ok !== true)
        return prepared;
    return { ok: true, request: { kind: 'prompt', prepared: prepared.prepared } };
}
const FILE_SCAN = {
    depth: 4,
    maxEntries: 300,
    /** Bigger files are almost never challenge attachments. */
    maxBytes: 20 * 1024 * 1024,
    /**
     * Only directories that can never hold a challenge attachment: package
     * caches, VCS metadata, and this plugin's own state. `dist/` and `build/` are
     * deliberately NOT skipped — shipping a challenge as `dist/` is common.
     */
    skipDirectories: new Set(['node_modules', '.git', '.ctf-teams', '.dsh']),
};
/**
 * List candidate attachment files inside one workspace, bounded on every axis.
 * The picker needs a short, relevant list — not a filesystem dump.
 * @param workspace - absolute workspace root.
 * @returns workspace-relative paths with sizes, sorted by path.
 */
export async function listWorkspaceFiles(workspace) {
    const files = [];
    async function walk(directory, depth) {
        if (depth > FILE_SCAN.depth || files.length >= FILE_SCAN.maxEntries)
            return;
        let entries;
        try {
            entries = await readdir(directory, { withFileTypes: true });
        }
        catch {
            return;
        }
        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            if (files.length >= FILE_SCAN.maxEntries)
                return;
            const absolute = join(directory, entry.name);
            if (entry.isDirectory()) {
                if (entry.name.startsWith('.') || FILE_SCAN.skipDirectories.has(entry.name))
                    continue;
                await walk(absolute, depth + 1);
                continue;
            }
            if (!entry.isFile())
                continue;
            let size = 0;
            try {
                size = (await stat(absolute)).size;
            }
            catch {
                continue;
            }
            if (size > FILE_SCAN.maxBytes)
                continue;
            files.push({ path: relative(workspace, absolute).split(sep).join('/'), size });
        }
    }
    await walk(workspace, 0);
    return files.sort((left, right) => left.path.localeCompare(right.path));
}
/**
 * Render one team as a markdown review report (the "导出复盘" payload).
 * Pure: it formats a snapshot that was assembled from durable state.
 * @param snapshot - the assembled team snapshot.
 * @param generatedAt - the export timestamp.
 * @returns a markdown document.
 */
export function renderTeamReport(snapshot, generatedAt) {
    const challenge = snapshot.challenge;
    const lines = [
        `# CTFTeams 复盘报告 — ${snapshot.name}`,
        '',
        `- 生成时间: ${new Date(generatedAt).toISOString()}`,
        `- 工作区: \`${snapshot.workspace}\``,
        `- 状态: ${snapshot.solved ? '🚩 已解出' : '◌ 未解出'} · 第 ${snapshot.round} 轮 · ${snapshot.phase}`,
        `- 我的角色: ${snapshot.role}`,
        `- 下一步建议: ${snapshot.nextStep}`,
        '',
        '## 题目',
        '',
        `- 标题: ${challenge.title ?? '(未记录)'}`,
        `- 分类: ${challenge.category ?? '(未记录)'}`,
        `- 分值: ${challenge.points ?? '(未记录)'}`,
        `- 远程: ${challenge.remote ?? '(无)'}`,
        `- 附件: ${challenge.attachments === undefined || challenge.attachments.length === 0 ? '(无)' : challenge.attachments.join(', ')}`,
        `- flag 格式: ${challenge.flagFormat ?? '(默认)'}`,
        '',
        `## 成员 (${snapshot.members.length})`,
        '',
        '| 成员 | 角色 | 模型 | 状态 | 任务 | 未读 |',
        '|---|---|---|---|---|---|',
        ...snapshot.members.map((member) => `| ${member.name} | ${member.role || '-'} | ${member.model || '-'} | ${member.activity} | ${member.done}/${member.total} | ${member.unread} |`),
        '',
        `## 任务 (${snapshot.counts.done}/${snapshot.counts.tasks} 完成)`,
        '',
        '| id | 任务 | 状态 | 负责人 | 类型 | 结论 |',
        '|---|---|---|---|---|---|',
        ...snapshot.tasks.map((task) => `| \`${task.id}\` | ${task.subject} | ${task.status}${task.state === 'blocked' ? ' (阻塞)' : ''} | ${task.assignee || '-'} | ${task.kind ?? '-'} | ${task.verdict ?? '-'} |`),
        '',
        `## Findings (${snapshot.findings.length})`,
        '',
        ...snapshot.findings.length === 0
            ? ['(没有上报任何进展)']
            : snapshot.findings.map((finding) => `- **r${finding.round} ${finding.id}** [${finding.from}${finding.category === undefined ? '' : `/${finding.category}`}] ${finding.content}`),
        '',
        `## Flag 看板 (${snapshot.counts.verified}/${snapshot.counts.flags} 已验证)`,
        '',
        ...snapshot.flags.length === 0
            ? ['(没有候选 flag)']
            : snapshot.flags.map((flag) => `- \`${flag.id}\` ${flag.status === 'verified' ? '✓' : flag.status === 'rejected' ? '✗' : '?'} \`${flag.flag}\` — ${flag.submittedBy}${flag.note === undefined ? '' : ` (${flag.note})`}`),
        '',
        '> 本报告是队伍内部的状态快照（题目、成员、任务、findings、flag 看板）。对外发布的 writeup 见工作区的 `WRITEUP.md`。',
        '',
    ];
    return lines.join('\n');
}

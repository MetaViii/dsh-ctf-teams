/**
 * Server-side assembly of the CTFTeams dashboard snapshot.
 *
 * The dashboard view in the Web client is a pure renderer over this payload:
 * durable team files are the truth source (a model that skipped a tool
 * "ritual" cannot desync the panel), enriched with live subagent activity and
 * mailbox depth, exactly like the terminal panel rendered by
 * `ctf_teams_status`. `nextStep` is computed with the same
 * {@link nextStepHint} the text panel uses, so the tab and the transcript can
 * never disagree about what should happen next.
 *
 * @module dsh-ctf-teams/dashboard-snapshot
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CAPTAIN_KEY, listArchivedTeamIds, readArchivedTeam, readTeam, readUnreadMailbox, taskDepthsById, taskVisualState, } from "./state.js";
import { memberActivity } from "./members.js";
import { challengeOf } from "./findings.js";
import { readCursor } from "./findings.js";
import { dashboardInputFromTeam, nextStepHint } from "./dashboard.js";
function currentTaskOf(memberName, tasks) {
    for (const task of tasks) {
        if (task.assignee === memberName && (task.status === 'claimed' || task.status === 'in_progress')) {
            return `${task.id} ${task.subject}`;
        }
    }
    return '';
}
function roleOf(team, sessionId) {
    if (sessionId === undefined || sessionId === '')
        return 'bystander';
    if (team.captainSessionId === sessionId)
        return 'captain';
    return team.members.some((member) => member.id === sessionId) ? 'member' : 'bystander';
}
/**
 * Assemble one team's dashboard snapshot from its durable record plus live
 * activity. Never throws on partial state: an unreadable mailbox counts as
 * empty so the panel keeps rendering.
 * @param ctx - plugin context (injects `agents`).
 * @param root - the owning workspace.
 * @param stateRoot - absolute state root of that workspace.
 * @param team - the durable team record.
 * @param options - `archived` renders a historic, activity-free snapshot.
 * @returns the snapshot the Web dashboard renders.
 */
export async function assembleDashboardTeam(ctx, root, stateRoot, team, options = {}) {
    const tasks = team.tasks;
    const depths = taskDepthsById(tasks);
    const roster = team.members.filter((member) => member.status !== 'removed');
    // Live activity is an enrichment: a host without the agent registry (or a
    // damaged one) must still render the durable team rather than drop it.
    let activity = new Map();
    if (options.archived !== true) {
        try {
            activity = memberActivity(ctx, roster.map((member) => member.id));
        }
        catch (error) {
            ctx.logger.warn(`ctf-teams: live member activity unavailable: ${String(error)}`);
        }
    }
    const members = [];
    for (const member of roster) {
        let unread = 0;
        try {
            unread = (await readUnreadMailbox(stateRoot, team.id, member.name)).length;
        }
        catch (error) {
            ctx.logger.warn(`ctf-teams: mailbox read failed for ${member.name}: ${String(error)}`);
        }
        const cursor = readCursor(team, member.name);
        const behind = Math.max((team.findingSeq ?? 0) - cursor.findingSeq, (team.flagSeq ?? 0) - cursor.flagSeq);
        const owned = tasks.filter((task) => task.assignee === member.name);
        const done = owned.filter((task) => task.status === 'completed').length;
        const live = member.id === '' ? 'unspawned' : activity.get(member.id) === 'running' ? 'working' : 'idle';
        members.push({
            id: member.id,
            name: member.name,
            role: member.role ?? '',
            provider: member.provider ?? '',
            model: member.model ?? '',
            reasoningEffort: member.reasoningEffort ?? '',
            status: member.status,
            activity: live,
            behind,
            unread,
            currentTask: currentTaskOf(member.name, tasks),
            done,
            total: owned.length,
        });
    }
    let captainUnread = 0;
    try {
        captainUnread = (await readUnreadMailbox(stateRoot, team.id, CAPTAIN_KEY)).length;
    }
    catch (error) {
        ctx.logger.warn(`ctf-teams: captain mailbox read failed: ${String(error)}`);
    }
    const challenge = challengeOf(team);
    const phase = team.halted === true ? 'halted' : team.escalated === true ? 'escalated' : team.phase ?? 'running';
    const openTaskByMember = new Map();
    for (const member of members) {
        if (member.currentTask !== '')
            openTaskByMember.set(member.name, member.currentTask);
    }
    const memberBehind = new Map(members.map((member) => [member.name, member.behind]));
    const completed = tasks.filter((task) => task.status === 'completed').length;
    const active = tasks.filter((task) => task.status === 'claimed' || task.status === 'in_progress').length;
    const pending = tasks.filter((task) => task.status === 'pending').length;
    const stamps = [
        ...(team.findings ?? []).map((finding) => finding.ts),
        ...(team.flags ?? []).map((flag) => flag.ts),
        ...tasks.map((task) => task.updatedAt),
    ].filter((stamp) => Number.isFinite(stamp));
    const dashboardInput = dashboardInputFromTeam(team, {
        activity: new Map(members.filter((member) => member.id !== '').map((member) => [member.id, member.activity])),
        memberBehind,
        captainUnread,
        openTaskByMember,
    });
    return {
        teamId: team.id,
        name: team.name,
        ...team.description === undefined ? {} : { description: team.description },
        workspace: root.path,
        workspaceTitle: root.title,
        captainSessionId: team.captainSessionId,
        role: roleOf(team, options.sessionId),
        archived: options.archived === true,
        phase,
        halted: team.halted === true,
        escalated: team.escalated === true,
        round: team.round ?? 0,
        createdAt: team.createdAt,
        ...stamps.length === 0 ? {} : { lastBeatAt: Math.max(...stamps) },
        solved: challenge.solved === true,
        challenge,
        nextStep: nextStepHint(dashboardInput),
        members,
        tasks: tasks.map((task) => ({
            id: task.id,
            subject: task.subject,
            description: task.description ?? '',
            status: task.status,
            state: taskVisualState(task.status, task.dependencies, tasks),
            assignee: task.assignee ?? '',
            dependencies: [...task.dependencies],
            depth: depths.get(task.id) ?? 0,
            updatedAt: task.updatedAt,
            ...task.kind === undefined ? {} : { kind: task.kind },
            ...task.round === undefined ? {} : { round: task.round },
            ...task.verdict === undefined ? {} : { verdict: task.verdict },
            ...task.objective === undefined ? {} : { objective: task.objective },
            ...task.acceptance === undefined ? {} : { acceptance: [...task.acceptance] },
            ...task.inScope === undefined ? {} : { inScope: [...task.inScope] },
            ...task.verify === undefined ? {} : { verify: [...task.verify] },
        })),
        findings: team.findings ?? [],
        flags: team.flags ?? [],
        captainUnread,
        counts: {
            members: members.length,
            working: members.filter((member) => member.activity === 'working').length,
            tasks: tasks.length,
            done: completed,
            active,
            pending,
            findings: team.findings?.length ?? 0,
            flags: team.flags?.length ?? 0,
            verified: (team.flags ?? []).filter((flag) => flag.status === 'verified').length,
        },
    };
}
/** Read the team directories under one workspace's state root. */
async function listTeamIds(stateRoot) {
    try {
        const entries = await readdir(stateRoot, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isDirectory() && entry.name !== 'archive')
            .map((entry) => entry.name)
            .sort();
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
}
/**
 * Collect the live teams of every given workspace root.
 * @param ctx - plugin context.
 * @param roots - workspace roots to scan.
 * @param stateDir - state directory name under each workspace.
 * @param options - the requesting session id.
 * @returns one snapshot per readable team, ordered by workspace then team id.
 */
export async function collectDashboardTeams(ctx, roots, stateDir, options = {}) {
    const teams = [];
    for (const root of roots) {
        const stateRoot = join(root.path, stateDir);
        for (const teamId of await listTeamIds(stateRoot)) {
            try {
                const team = await readTeam(stateRoot, teamId);
                if (team === undefined)
                    continue;
                teams.push(await assembleDashboardTeam(ctx, root, stateRoot, team, { sessionId: options.sessionId }));
            }
            catch (error) {
                ctx.logger.warn(`ctf-teams: skipped unreadable team "${teamId}" in "${root.path}": ${String(error)}`);
            }
        }
    }
    return teams;
}
/**
 * Collect archived teams (the `archive/` subdirectory of each state root), so
 * a finished solve stays reviewable in the dashboard after deletion.
 * @param ctx - plugin context.
 * @param roots - workspace roots to scan.
 * @param stateDir - state directory name under each workspace.
 * @param options - the requesting session id.
 * @returns one snapshot per archived team.
 */
export async function collectArchivedDashboardTeams(ctx, roots, stateDir, options = {}) {
    const teams = [];
    for (const root of roots) {
        const stateRoot = join(root.path, stateDir);
        const archiveRoot = join(stateRoot, 'archive');
        for (const teamId of await listArchivedTeamIds(stateRoot)) {
            try {
                const team = await readArchivedTeam(stateRoot, teamId);
                if (team === undefined)
                    continue;
                teams.push(await assembleDashboardTeam(ctx, root, archiveRoot, team, { sessionId: options.sessionId, archived: true }));
            }
            catch (error) {
                ctx.logger.warn(`ctf-teams: skipped unreadable archived team "${teamId}" in "${root.path}": ${String(error)}`);
            }
        }
    }
    return teams;
}

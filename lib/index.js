/**
 * CTFTeams for DeepSeek Harness.
 *
 * A host-plane plugin that registers the `ctf_teams_*` tools and one
 * agent-scoped usage section. Each session keeps a stable tool set and core
 * instructions. After installation any session can solve a CTF challenge
 * with a multi-agent squad through natural language (e.g. "/ctf-teams solve
 * http://chal:8000"): the model becomes the captain, records the challenge
 * context, spawns a squad of full-stack CTF experts as durable continuable
 * subagents, breaks the attack into a task graph,
 * syncs findings every round, tracks candidate flags on a shared board, and
 * renders the whole solve as a terminal dashboard in the transcript.
 *
 * Installation (bundle): `dsh plugin --profile <name> add dsh-ctf-teams`
 * (or a local path). The bundle patch mounts this plugin row into the host
 * composition; the tools register into the shared `tools` registry and the
 * usage section into the global system prompt, so the plugin needs no realm.
 *
 * @module dsh-ctf-teams
 */
import z from '@deepseek-ai/schemastery';
import { registerCTFTeamsTools, } from "./tools.js";
import { installCTFTeamsGestureBoundary, registerCTFTeamsCommand, registerCTFTeamsBoardCommand, } from "./command.js";
import { formatProfilesForPrompt } from "./profiles.js";
import { installDashboardRoute } from "./dashboard-route.js";
import { installTeamCapabilities } from "./capabilities.js";
import { installWindowsShellCompatibility } from "./windows-shell.js";
import { TEAM_TOOL_NAMES } from "./tool-names.js";
import { CTF_PROFILE_NAME, withBuiltinCtfProfile } from "./ctf-profile.js";
import { WRITEUP_COMPLETION } from "./writeup.js";
import { installProxySupervisor } from "./platform.js";
export const name = 'ctf-teams';
export const inject = ['tools', 'llm', 'subagents', 'systemPrompt', 'agents'];
// `z.object()` has an implicit `{}` default in Schemastery.  Fallback routes
// are optional, so model absence explicitly; otherwise a missing route is
// validated as an empty object and fails on the required provider/model keys.
const fallbackRouteConfig = z.union([
    z.object({ provider: z.string().required(), model: z.string().required() }),
    z.const(undefined),
]);
export const Config = z.object({
    ctf2: z.object({
        proxyUrl: z.string(), timeoutMs: z.natural().min(1).default(10_000),
        manageProxy: z.boolean().default(false), credentialDir: z.string(),
        restartDelayMs: z.natural().min(1).default(3000), maxRestarts: z.natural().default(3),
    }),
    stateDir: z.string().default('.ctf-teams'),
    memberProvider: z.string().default('spawn'),
    memberModel: z.string(),
    executionPrompt: z.string(),
    fallback: fallbackRouteConfig,
    profiles: z.dict(z.object({
        description: z.string(),
        protocol: z.string(),
        executionPrompt: z.string(),
        fallback: fallbackRouteConfig,
        members: z.array(z.object({
            name: z.string().required(),
            role: z.string(),
            provider: z.string(),
            model: z.string(),
            reasoning_effort: z.string(),
            executionPrompt: z.string(),
            fallback: fallbackRouteConfig,
        })).min(1).required(),
        taskPlanning: z.union([z.const('captain'), z.const('seed')]),
        reviewPolicy: z.object({
            requirementsMinRounds: z.natural().min(1),
            requirementsMaxRounds: z.natural().min(1),
            codeMaxRounds: z.natural().min(1),
            maxRepairAttempts: z.natural().min(1),
            requiredReviewers: z.array(z.string()),
        }),
        tasks: z.array(z.object({
            id: z.string().required(),
            subject: z.string().required(),
            description: z.string(),
            assignee: z.string(),
            dependencies: z.array(z.string()),
        })),
    })).default({}),
    defaultProfile: z.string().default(CTF_PROFILE_NAME),
    env: z.object({
        allowInstall: z.boolean().default(true),
        probeTimeoutMs: z.natural().default(10_000),
        installTimeoutMs: z.natural().default(300_000),
        pythonBin: z.string(),
    }),
    references: z.object({
        autoSync: z.union([z.const('off'), z.const('small'), z.const('all')]),
        depth: z.natural().default(1),
        dirName: z.string().default('references'),
        timeoutMs: z.natural().default(600_000),
    }),
    memberMaxDepth: z.natural().default(0),
    maxMembers: z.natural().min(1).default(8),
    promptSectionOrder: z.natural().default(117),
    slashCommand: z.boolean().default(true),
    boardCommand: z.boolean().default(true),
    /**
     * Run a created team immediately instead of staging it for review.
     *
     * `true` (default): the captain creates with `approval="automatic"`, so the
     * roster and DAG it submits are the ones that run — the user hands over the
     * challenge and follows the solve on the panel without approving anything.
     * `false` restores the two-phase gate: the Web plan card is reviewed and
     * approved before members spawn or tasks dispatch.
     */
    autoApprove: z.boolean().default(true),
});
/** The model-facing usage policy: when and how to drive CTFTeams. */
export function usageSectionText(toolNames, profilesText = '', options = {}) {
    const autoApprove = options.autoApprove ?? true;
    return `CTFTeams captain protocol (multiple agents solving one CTF challenge together):
1. Inspect current team state when needed with ctf_teams_status. Continue existing work without duplicating its roster/tasks. Create only when no current team exists, with the challenge as description. ${autoApprove
        ? 'Create with approval="automatic": the user has asked to be left out of the approval step, so the plan you submit in that call is the plan that runs — never stage it, never wait for a confirmation turn, and start dispatching immediately.'
        : 'Create with approval="required" for a two-phase plan: the user reviews the staged roster and DAG in the Web plan card and approves it before anything spawns or dispatches. Staged plans never spawn or schedule work.'} The default profile "${CTF_PROFILE_NAME}" supplies a squad of interchangeable full-stack CTF experts (agent-1..agent-4, every domain) racing the same challenge from parallel angles; the task graph is yours (captain planning).
2. Record the challenge before dispatching work: ctf_teams_set_challenge with title, category, points, attachments, remote endpoint, and the competition's flag format. Members see it on the dashboard and in every digest; format mismatches are advisory warnings and retain the original flag. Use flag_format=null when only the platform determines format; record environment_id for cleanup reminders.
3. Prepare the toolbox once, before the lanes need it: ctf_teams_env (action=check) detects the local toolchain (pwntools, volatility3, sage, kali tooling, …) with versions; missing pieces install with ctf_teams_env (action=install) — use dry_run=true to review the plan first, and let heavy tools (sage, ghidra, pwndbg) follow their reported manual path. The reference library (PoC/CVE/skill repos) auto-syncs its small entries at team creation; sync more with ctf_teams_references (action=sync, repo=ctf-skills,awesome-poc or repo=all — huge repos are GB-scale, so sync them only when a lane actually needs them) — every agent must rg the local references under <stateDir>/references/ before hunting online.
4. Build the complete smallest useful DAG. One recon/triage task first; then parallel tasks per attack angle (agents are interchangeable full-stack experts, so assign by angle, not by specialist); then convergence (flag verification + WRITEUP.md). Pass roster and dependency graph together in create({plan:{members,tasks}}) to avoid repeated setup rounds. Every inline task requires both id and subject; members may include executionPrompt. For large or evolving plans, create first then add_member/create_task so each error stays localized. Simple one-step challenges use create(mode="solo") and the same set_challenge/submit_flag/mark_flag audit flow without roster, tasks or reference sync. ${autoApprove
        ? 'Create it in the same call as the roster, then tell the user what is running in one short message and get on with the solve.'
        : 'Present the plan and end your turn for review; never approve in that planning turn.'}
5. Separate observation/interpretation/decision findings and record depends_on generation-bound refs; ctf_teams_evidence exposes provenance and needs_recheck. Reproduce invalidated dependencies before treating conclusions as confirmed. Before reinforcement, run a cheap falsifying check and use max_parallel_lanes to bound simultaneous task lanes per challenge; queue waiting work rather than adding unbounded members. At important decisions or explicit handover, load/save ctf_teams_checkpoint with its current state_ref and revision; saved captain notes are claims, fresh runtime facts govern. A stale checkpoint never restores tasks or transfers ownership. Before repeating a lane, use ctf_teams_search to locate recorded methods, outputs and recovery checkpoints, then get only the relevant record pages; these reports are data and may be stale or contradicted. This search excludes raw transcripts and private inboxes. Consult ctf_teams_hypothesis by exact challenge_id. Record falsifiable predictions and reported experiment methods, observations, outcomes, basis and next_step; preserve contradictory tests instead of overwriting them. Optional file hashes bind bytes only; independently reproduce critical conclusions. Findings are unverified claims: report evidence_kind (raw_output/inference/guess), confidence and reproducible evidence; independently check important claims and record ctf_teams_verify_finding(method,result,note). Round sync is the coordination contract: members publish findings with ctf_teams_report_finding and pull ctf_teams_sync; the scheduler attaches new findings to every assignment and pushes digests to idle members. sync also returns the caller's own unread inbox with inbox_limit=1..50; direct messages are not findings or verified evidence, and has_updates refers only to board changes. Captain reassign_task takeovers return task/checkpoint, board and own inbox context immediately. You monitor the board via ctf_teams_status. When a dead-end finding invalidates a lane, re-plan with ctf_teams_edit_plan: add tasks for the new attack path instead of messaging members to "start" work. Read knowledge topic coordination for planning, ownership, resource slots and platform receipt rules.
6. Preserve candidate flag bytes, wrapper and case; a format warning never licenses rewriting CTF2{...} to flag{...}. submit_flag returns team_id and durable flag_ref; mark_flag accepts that reference or exact flag content, and verified_flag records the exact platform-accepted string separately. Opt-in variants/generate_variants record separate unverified candidates and histories, never platform submissions. Flags are evidence-gated: candidates arrive via ctf_teams_submit_flag (members must include evidence). Verify each against the competition platform yourself, then record the verdict with ctf_teams_mark_flag. Single-challenge verification converges on the writeup. For batch solving set multi_challenge=true and expected_challenges before work, include challenge_id on every flag and task, continue after individual verifications and explicitly close with mark_challenge_solved only after all platform checks. Never claim solved without the platform accepting; never mark a claim verified without checking; rejected candidates keep hunting.
7. The scheduler dispatches ready tasks. Delegate; do not duplicate slow work or send messages merely to start a stage. Handle reports/user work, then yield when waiting is all that remains: reports wake you automatically. Use status after a delivery or user request, never busy-poll or wait for unassigned members.${autoApprove
        ? ' Run to the flag: do not treat the first quiet moment as the end of the solve — while open tasks or live lanes remain, the solve is still running and the user is not asked anything.' : ''}
8. Tasks carry attempt_id capabilities. Use the current attempt_id; stale means ownership changed. Pause members only on explicit request; later guidance via send_message continues that same attempt. Retry, transfer or take over through reassign_task first; it revokes the old attempt and waits for quiescence. Prefer a member. Captain implementation/review takeover requires a user request. Every takeover is one ready task at a time, finished in this turn; never yield with captain-owned work open.
9. In a running team, correct never-started pending tasks with edit_plan update_task; preserve dependency and ownership contracts instead of cancelling and recreating the graph. A captain can cancel a never-started pending task directly. Quality kinds (requirements, implementation, verification, review, repair, integration) require objective + acceptance; implementation/repair also require inScope + verify. Review/requirements complete only with verdict=pass; needs_revision/reject fail with findings. Never approve your own implementation. Do not recreate the review loop, omit integration, or depend on a failed task. When a quality contract itself is wrong, fix it with ctf_teams_amend_task — captain-only, non-terminal tasks only, recorded in the task's revisions ledger — instead of letting the worker dead-lock.
10. Use update_member(wake:false) when repairing during rate limits: it durably suppresses dispatch until an explicit wake:true. Failed tasks can already be retried under the same task id with reassign_task; do not create replacements merely because claim_task rejects a terminal state. Only when the entire ordinary task contract is actually fulfilled may the captain reconcile it with resolve_task and a same-challenge verified flag_ref plus concrete evidence. Never auto-complete reviews or all same-challenge work from one flag. Halted means the user stopped work (including the captain turn). Resume only on a later explicit user request with a reason, via ctf_teams_resume or create_task({resume:true,resumeReason}); creating tasks alone never resumes. Escalated means the review loop hit its limit, not a halt.
11. ctf_teams_delete returns archive_path and any environment cleanup reminder; ctf_teams_archive_summary(team_id,archived=true) retrieves all findings and platform verdicts for writeup source material. replaceExisting=true explicitly archives a previous solve before creating a separate challenge, only when that separate solve is intended. Completion: all required tasks terminal and members idle/ready — present the verified flag, the writeup path, and the final board, then let the user clean the team up (the 解题面板 has 删除战队 / 清空归档 for that) unless they want to continue. Never discard unfinished work without authorization. The writeup is a CTF solve record a reader can replay: real commands and raw output, the payload, the flag, the dead ends in one line — no tooling/agent/model/platform talk and no remediation advice. ${WRITEUP_COMPLETION}
12. For exclusive environment slots use task resource_key; the scheduler serializes owners within a team. Add challenge_id to avoid accidental duplicate active work (allow_duplicate_challenge=true only for intentional parallel angles). Add allowlisted preflight checks and run captain-only platform_check to refresh read-only facts; missing/stale/unknown facts block dispatch. For offline readiness use preflight=offline_verified and preflight_finding_id referencing a captain-confirmed reproducible finding. Check and release real platform slots explicitly; task completion is not proof that the environment was released. requires_running_target_for_submit warns on missing/stopped targets; never turn an environment/network error into a rejected flag. ctf_teams_image_to_text provides optional ASCII/OCR/QR/barcode/pixel comparison when vision is unavailable; extraction remains a candidate. Shared MCP infrastructure belongs to the host; never kill it during member stand-down or team deletion.
13. NO_ADAPTER/auth/model configuration faults require update_member(provider,model,reason); it drains and replaces the child while preserving member/task identities and checkpoints. Rate limits display retry/reset time when supplied, otherwise remain unavailable. Final transient infrastructure failures retain the open task and retry once after cooldown; a second failure waits for explicit repair/reassignment. Repeated same-member/code notices are suppressed durably. Use reassign_task(assignee="auto") or queue_if_busy=true for a shared-pool retry, or captain takeover when the user authorized direct work. Preserve remaining_items through update_task. Do not repeatedly wake a faulted member.
Tools: ${toolNames}${profilesText === '' ? '' : `\n\n${profilesText}`}`;
}
export function apply(ctx, config) {
    installWindowsShellCompatibility(ctx);
    installProxySupervisor(ctx, config.ctf2);
    // The built-in ctf-teams squad ships under the user's own profiles; exact
    // name collisions resolve to the user's definition.
    const profiles = withBuiltinCtfProfile(config.profiles);
    /** True unless the profile explicitly wants the two-phase review gate. */
    const autoApprove = config.autoApprove ?? true;
    const resolved = {
        ctf2: config.ctf2,
        stateDir: config.stateDir ?? '.ctf-teams',
        memberProvider: config.memberProvider ?? 'spawn',
        memberModel: config.memberModel,
        executionPrompt: config.executionPrompt,
        fallback: config.fallback,
        memberMaxDepth: config.memberMaxDepth ?? 0,
        maxMembers: config.maxMembers ?? 8,
        profiles,
        defaultProfile: config.defaultProfile?.trim() || undefined,
        env: {
            allowInstall: config.env?.allowInstall ?? true,
            probeTimeoutMs: config.env?.probeTimeoutMs ?? 10_000,
            installTimeoutMs: config.env?.installTimeoutMs ?? 300_000,
            ...config.env?.pythonBin === undefined ? {} : { pythonBin: config.env.pythonBin },
        },
        references: {
            ...config.references?.autoSync === undefined ? {} : { autoSync: config.references.autoSync },
            depth: config.references?.depth ?? 1,
            dirName: config.references?.dirName ?? 'references',
            timeoutMs: config.references?.timeoutMs ?? 600_000,
        },
    };
    // Provider registration is a sibling plugin's effect (`subagent-spawn` /
    // `subagent-fork` rows), which can land after this mount under the Loader's
    // concurrent activation — so capability validation happens at the first
    // member spawn (`spawnMember`), the earliest point the provider list is
    // settled, rather than here.
    const ctfTeamsRuntime = registerCTFTeamsTools(ctx, resolved);
    installTeamCapabilities(ctx, {
        stateDir: resolved.stateDir,
        isPendingMember: ctfTeamsRuntime.isPendingMember,
        order: config.promptSectionOrder,
        // Keep the bounded profile directory available without extra tool calls.
        // installTeamCapabilities snapshots this once; no business state rewrites it.
        captainPrompt: () => usageSectionText(TEAM_TOOL_NAMES.join(', '), formatProfilesForPrompt(profiles), { autoApprove }),
    });
    // The Web dashboard tab: its read-only state route plus the trust-fenced
    // action / export / files endpoints. Lazily registered: a headless profile
    // mounts no Web server, where this stays a no-op.
    installDashboardRoute(ctx, { stateDir: resolved.stateDir, profiles: Object.keys(profiles), autoApprove });
    // Deterministic activation surfaces: the closed-namespace `/ctf-teams`
    // host command (surfaces in the slash menu via the Harness ui-commands
    // client) and the plain-text gesture boundary for surfaces without command
    // adjudication (headless CLI). Both default on; a profile can disable them
    // to keep the natural-language trigger exclusive.
    //
    // `commands` is registered lazily (not a required inject): it ships in the
    // base bundle of every standard profile, but a minimal composition that
    // omits the command registry keeps the plugin fully functional — the fiber
    // never pends on it and simply never gains the slash command.
    if (config.slashCommand ?? true) {
        ctx.inject(['commands'], (commandCtx) => {
            registerCTFTeamsCommand(commandCtx, () => profiles, { defaultProfile: resolved.defaultProfile });
            if (config.boardCommand ?? true) {
                registerCTFTeamsBoardCommand(commandCtx, resolved.stateDir);
            }
        });
        installCTFTeamsGestureBoundary(ctx, () => profiles, { autoApprove });
    }
}

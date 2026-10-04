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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { type TeamProfileConfig } from './profiles.ts';
export declare const name = "ctf-teams";
export declare const inject: string[];
/** Plugin configuration. */
export interface Config {
    /**
     * State directory name under the captain's workspace; team state lives at
     * `<workspace>/<stateDir>/<teamId>/` (default `.ctf-teams`).
     */
    stateDir?: string;
    /** `ctx.subagents` provider used to spawn members; must support continuable children and personas (default `spawn`). */
    memberProvider?: string;
    /** Optional model override applied to every member. */
    memberModel?: string;
    /** Prompt injected into member personas and automatic task assignments. */
    executionPrompt?: string;
    /** Plugin-wide fallback route for unavailable member models. */
    fallback?: import('./profiles.ts').TeamModelFallbackConfig;
    /** Member delegation depth cap (default `0`; `0` forbids delegation entirely). */
    memberMaxDepth?: number;
    /** Team size cap in members (default `8`). */
    maxMembers?: number;
    /** Named multi-role team profiles; they override the built-in on name collision. */
    profiles?: Record<string, TeamProfileConfig>;
    /**
     * Profile applied when `ctf_teams_create` is called without `profile` or
     * `plan` (default `ctf-teams`, the shipped CTF squad). Set to an empty
     * string to disable the default and require an explicit choice.
     */
    defaultProfile?: string;
    /** Toolchain service options for `ctf_teams_env` (detect + install). */
    env?: {
        /** Allow the install action to execute (default `true`; `false` keeps dry-run only). */
        allowInstall?: boolean;
        /** Per-probe timeout in ms (default `10000`). */
        probeTimeoutMs?: number;
        /** Per-install-command timeout in ms (default `300000`). */
        installTimeoutMs?: number;
        /** Explicit Python launcher (default: `python3`, `python` on Windows). */
        pythonBin?: string;
    };
    /** References library options for `ctf_teams_references`. */
    references?: {
        /**
         * Clone reference repos automatically when a team is created so the
         * PoC/CVE collections are already on disk (`small`: ctf-skills +
         * awesome-poc, the default; `all`: every manifest repo including the
         * multi-GB ones; `off`). Already-provisioned repos are never touched.
         */
        autoSync?: 'off' | 'small' | 'all';
        /** Shallow-clone depth (default `1`). */
        depth?: number;
        /** Directory name under the state root (default `references`). */
        dirName?: string;
        /** Per git command timeout in ms (default `600000`). */
        timeoutMs?: number;
    };
    /** Prompt-section order for the usage policy (default `117`, after delegation policy). */
    promptSectionOrder?: number;
    /**
     * Register the deterministic `/ctf-teams` activation surfaces (the
     * closed-namespace slash command and the plain-text gesture boundary).
     * Disable to keep the natural-language trigger as the only entry point.
     */
    slashCommand?: boolean;
    /**
     * Register `/ctf-teams-board`, the harness-native dashboard command that
     * prints the solving panel straight into the transcript without waking the
     * model (default on).
     */
    boardCommand?: boolean;
}
export declare const Config: z<Config>;
/** The model-facing usage policy: when and how to drive CTFTeams. */
export declare function usageSectionText(toolNames: string, profilesText?: string): string;
export declare function apply(ctx: Context, config: Config): void;

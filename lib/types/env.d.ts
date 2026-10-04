/**
 * The CTFTeams toolchain service: detect what a working box already has
 * (pwntools, volatility3, sage, kali tooling, …) and install what is missing.
 *
 * Two phases, both exposed through the `ctf_teams_env` tool:
 * 1. `check` — probe every managed tool in parallel (binary lookup + version
 *    probe, or a Python import probe) with an injectable command runner.
 * 2. `install` — build a per-platform install plan from curated package maps
 *    (apt / pip / brew / gem) and execute it argv-by-argv with no shell, or
 *    return the plan with `dry_run`. Heavy tools (sage, ghidra, gdb plugins)
 *    report a manual command instead of executing.
 *
 * Pure logic (`planInstall`, probe matching) is separated from the default
 * runner so the offline verify can drive both without spawning processes.
 *
 * @module dsh-ctf-teams/env
 */
/** How a managed tool is probed. Absent → the tool reports its manual path. */
export type ToolProbe = {
    kind: 'binary';
    command: string;
    args?: readonly string[];
    versionRe?: string;
} | {
    kind: 'python';
    module: string;
};
/** One managed CTF tool. */
export interface ToolSpec {
    /** Stable tool id used by the tool API (`pwntools`, `volatility3`, …). */
    name: string;
    category: 'recon' | 'web' | 'binary' | 'crypto' | 'forensics' | 'misc';
    summary: string;
    /** Platforms the tool can realistically run on; default is all. */
    platforms?: readonly NodeJS.Platform[];
    probe?: ToolProbe;
    /** Curated install sources; absent → manual only (see `manual`). */
    install?: {
        apt?: readonly string[];
        pip?: readonly string[];
        brew?: readonly string[];
        gem?: readonly string[];
    };
    /** Heavy/manual-only tools: the exact command or pointer to run. */
    manual?: string;
}
/** Outcome of one probe. */
export interface ToolStatus {
    name: string;
    category: ToolSpec['category'];
    summary: string;
    status: 'ok' | 'missing' | 'unavailable' | 'manual';
    version?: string;
    /** Where the binary was found (`which`/`where` line), for binaries. */
    path?: string;
    /** The install path forward: manager + package or the manual command. */
    installHint: string;
}
/** One planned install step. */
export interface InstallStep {
    tool: string;
    manager: 'apt' | 'pip' | 'brew' | 'gem' | 'manual';
    /** Exact argv to execute (no shell), or the manual command text. */
    argv?: readonly string[];
    packages?: readonly string[];
    note?: string;
}
/** Outcome of one executed install step. */
export interface InstallOutcome {
    tool: string;
    ok: boolean;
    manager: InstallStep['manager'];
    detail: string;
    version?: string;
}
export type CommandRunner = (argv: readonly string[], timeoutMs: number) => Promise<{
    code: number;
    stdout: string;
    stderr: string;
    error?: string;
}>;
/** Default runner: argv-spawn (never a shell), bounded by the timeout. */
export declare const defaultCommandRunner: CommandRunner;
/** The curated managed-tool registry. Names are the stable tool API. */
export declare const TOOL_SPECS: readonly ToolSpec[];
/** The Python launcher used for import probes and pip installs. */
export declare function pythonBin(configured: string | undefined, platform?: NodeJS.Platform): string;
/**
 * Build the ordered install plan for the requested tools. Callers decide
 * which tools need work (usually the `missing` ones from `detectTools`); the
 * plan maps each tool to its platform's preferred manager and exact argv.
 */
export declare function planInstall(requested: readonly string[], specs: readonly ToolSpec[], platform?: NodeJS.Platform, options?: {
    sudo?: boolean;
    python?: string;
}): {
    steps: InstallStep[];
    unknown: string[];
};
/** Detect a set of tools (default: everything managed). */
export declare function detectTools(options?: {
    tools?: readonly string[];
    runner?: CommandRunner;
    timeoutMs?: number;
    python?: string;
    specs?: readonly ToolSpec[];
}): Promise<ToolStatus[]>;
/** Execute an install plan sequentially; re-probe installed tools afterwards. */
export declare function runInstallPlan(steps: readonly InstallStep[], options?: {
    runner?: CommandRunner;
    timeoutMs?: number;
    python?: string;
    specs?: readonly ToolSpec[];
}): Promise<InstallOutcome[]>;
/** Compact human/model-facing render of a detection report. */
export declare function renderStatuses(statuses: readonly ToolStatus[]): string;

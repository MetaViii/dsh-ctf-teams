import type { Context } from '@deepseek-ai/cordis';
/** WinPS bootstrap scripts must find their own modules before inherited PS7 modules. */
export declare function windowsPowerShellModulePath(env: NodeJS.ProcessEnv): string;
/** Process-local and reversible: no profile, registry, ACL or third-party files are edited. */
export declare function installWindowsShellCompatibility(ctx: Pick<Context, 'effect'>, options?: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
}): void;

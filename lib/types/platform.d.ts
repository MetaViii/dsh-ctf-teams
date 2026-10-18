import type { Context } from '@deepseek-ai/cordis';
import type { TeamState } from './types.ts';
export interface PlatformConfig {
    proxyUrl?: string;
    timeoutMs?: number;
    manageProxy?: boolean;
    credentialDir?: string;
    restartDelayMs?: number;
    maxRestarts?: number;
}
export declare function proxyUrl(config?: PlatformConfig): URL;
export declare function proxyHealth(config?: PlatformConfig): Promise<{
    up: boolean;
    state: string;
    probe: string;
    url: string;
    http_status?: number;
}>;
/** Allowlisted read-only calls only; unknown schema fields remain unknown. */
export declare function readPlatformSnapshot(config: PlatformConfig, ground: string, challengeId?: string): Promise<NonNullable<TeamState['platformSnapshot']>>;
/** Shared infrastructure belongs to the host. Team deletion never controls this process. */
export declare function installProxySupervisor(ctx: Context, config?: PlatformConfig): void;

/** Explicit local/WSL inspection; never infer Linux tools from Windows PATH. */
import { type CommandRunner, type ToolSpec, type ToolStatus } from './env.ts';
export interface RuntimeToolReport {
    runtime: 'local' | 'wsl';
    host_platform: NodeJS.Platform;
    probe_platform: NodeJS.Platform;
    runtime_ready: boolean;
    distribution?: string;
    available_distributions?: string[];
    python: string;
    search_path?: string;
    unknown: string[];
    statuses: ToolStatus[];
    error?: string;
}
export declare function detectRuntimeTools(options?: {
    runtime?: 'local' | 'wsl';
    distribution?: string;
    tools?: readonly string[];
    python?: string;
    timeoutMs?: number;
    runner?: CommandRunner;
    hostPlatform?: NodeJS.Platform;
    specs?: readonly ToolSpec[];
}): Promise<RuntimeToolReport>;

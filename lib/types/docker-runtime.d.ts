import type { TeamState } from './types.ts';
export declare const TOOLKIT_VERSION = "0.1.36";
export declare const DEFAULT_CTF_IMAGE = "dsh-ctf-tools:0.1.36";
export interface ExecutionConfig {
    backend?: 'docker' | 'native';
    image?: string;
    autoBuild?: boolean;
    memoryMb?: number;
    cpus?: number;
}
export interface RuntimeScope {
    key: string;
    container: string;
    workspace: string;
    host_workdir: string;
    state_dir: string;
}
export interface RuntimeJob {
    id: string;
    owner: string;
    task_id?: string;
    attempt_id?: string;
    command: string;
    status: string;
    started_at: number;
    exit_code?: number | null;
    stdout?: string;
    stderr?: string;
    stdout_path?: string;
    stderr_path?: string;
    experiment_ref?: string;
}
interface RuntimeState {
    version: 1;
    scope: RuntimeScope;
    image: string;
    image_id: string;
    container_id: string;
    container_started_at?: string;
    jobs: RuntimeJob[];
    paused: boolean;
}
interface RunResult {
    code: number;
    stdout: string;
    stderr: string;
}
/** No host shell, no model-supplied Docker flags, bounded output, and real cancellation. */
export declare function dockerCommand(argv: readonly string[], options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    input?: string;
}): Promise<RunResult>;
export declare function runtimeScope(workspace: string, team: Pick<TeamState, 'id' | 'captainSessionId' | 'boardId' | 'createdAt'>): RuntimeScope;
export declare function runtimeStatus(scope: RuntimeScope): Promise<Record<string, unknown>>;
export declare function prepareRuntime(scope: RuntimeScope, config: ExecutionConfig, signal: AbortSignal, admit: () => Promise<void>): Promise<RuntimeState>;
export declare function readRuntimeJob(scope: RuntimeScope, id: string, owner: string, captain: boolean, signal?: AbortSignal): Promise<RuntimeJob>;
export declare function executeRuntime(scope: RuntimeScope, config: ExecutionConfig, input: {
    command: string;
    workdir?: string;
    timeoutMs?: number;
    waitMs?: number;
    owner: string;
    taskId?: string;
    attemptId?: string;
    beforeLaunch?: (id: string, timeout: number) => Promise<{
        timeoutMs: number;
        experimentRef?: string;
    }>;
}, signal: AbortSignal, admit: () => Promise<void>): Promise<RuntimeJob>;
export declare function cancelRuntimeJob(scope: RuntimeScope, id: string, owner: string, captain: boolean): Promise<RuntimeJob>;
export declare function pauseTeamRuntime(workspace: string, team: TeamState): Promise<{
    stopped: boolean;
    error?: string;
}>;
export declare function cancelMemberRuntimeJobs(workspace: string, team: TeamState, owner: string, taskId?: string): Promise<void>;
/** Stage explicit attachments only. No full workspace, credentials, or Docker socket mounts. */
export declare function stageRuntimeInput(scope: RuntimeScope, source: string, destination?: string): Promise<{
    host_path: string;
    container_path: string;
    files: number;
}>;
export declare function runtimeController(scope: RuntimeScope): AbortController;
export {};

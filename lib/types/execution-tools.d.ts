/** Model-facing container entry points; all calls re-enter normal DSH tool policy. */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { type ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
import type { TeamState } from './types.ts';
import type { ResearchHooks } from './research-tools.ts';
import { type ExecutionConfig } from './docker-runtime.ts';
export interface ExecutionAccess {
    agent: Agent;
    team: TeamState;
    owner: string;
    captain: boolean;
    workspace: string;
    taskId?: string;
    attemptId?: string;
}
export type AuthorizeExecution = (exec: ToolRunContext, options?: {
    mutate?: boolean;
    taskId?: string;
    attemptId?: string;
    command?: boolean;
    updateState?: (access: ExecutionAccess) => boolean;
}) => Promise<ExecutionAccess>;
export declare const DOCKER_EXECUTION_PROMPT = "CTF execution defaults to Docker. After creating the team, use ctf_teams_runtime(action=\"prepare\") to prepare the shipped dsh-ctf-tools:0.1.36 toolchain. Use ctf_teams_exec for ALL solving commands (Bash syntax), including Python, Sage, debugger and network tools; never silently fall back to pwsh/bash/ops_bash on the host. Runtime preparation may build the image on first use. No Docker image means an environment blocker, not a reason to reinstall host dependencies. ctf_teams_runtime(action=\"status\") is read-only and never starts a container.\nThe runtime returns host_workdir and container_workdir=/work. Stage explicit existing attachments with runtime(action=\"import\",source=\"workspace-relative/path\"); the receipt identifies the container path. Write solve scripts with the normal file tools under host_workdir, and execute those relative paths in /work. Only this dedicated work subtree is mounted; Windows paths and host-local proxy URLs do not become container paths or endpoints. Keep separate per-member script/output names and use shared/ for explicit handoffs. Native reference/platform helpers remain host-managed; the captain uses ctf_teams_ctf2 for the CTF2 proxy, listings, attachment URLs, target lifecycle and explicit submissions. Its connect action uses existing host OAuth files without mounting them in Docker. Never mount the Docker socket or read host credentials into a challenge container.\nMembers must pass task_id and the current attempt_id to ctf_teams_exec. A running result has job_id: poll with runtime(action=\"job\",job_id=...), or cancel your own job explicitly. wait_ms controls only the foreground wait; timeout_ms is the command deadline. Large output is saved as full host log files on completion/pause; the returned text is a bounded tail. Detached services belong in a background job with a foreground service command. Team pause stops the whole owned container, preserving workspace and logs; resume does not replay old commands or automatically restart background services. Recheck the checkpoint and rerun the necessary service after explicit team resume. Container tools, files and reports are not independent proof of a solve.";
/** Read the same effective host policy as native shell tools. No fallback on service errors. */
export declare function requireExecutionPolicy(agent: Agent): void;
export declare function registerExecutionTools(ctx: Context, config: ExecutionConfig, authorize: AuthorizeExecution, research?: ResearchHooks): void;
export declare function checkDockerEnvironment(exec: ToolRunContext, config: ExecutionConfig, authorize: AuthorizeExecution, tools?: readonly string[]): Promise<Record<string, JsonValue>>;
export declare function bashQuote(text: string): string;
export declare function dockerImageAnalysis(exec: ToolRunContext, config: ExecutionConfig, authorize: AuthorizeExecution, args: {
    image: string;
    compare?: string;
    action?: string;
    width?: number;
}): Promise<string>;

/** Tools share the existing team transaction and Docker admission boundary. */
import type { Context } from '@deepseek-ai/cordis';
import { type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { type AuthorizeExecution } from './execution-tools.ts';
export interface ResearchHooks {
    check(exec: ToolRunContext, taskId?: string, attemptId?: string, ref?: string): Promise<void>;
    reserve(exec: ToolRunContext, jobId: string, timeoutMs: number, taskId?: string, attemptId?: string, ref?: string): Promise<{
        timeoutMs: number;
        experimentRef?: string;
    }>;
}
export declare function registerResearchTools(ctx: Context, authorize: AuthorizeExecution): ResearchHooks;

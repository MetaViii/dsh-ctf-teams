/** Optional exact-host capability: human panel/stop action only, never model inference. */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
export declare function pauseCaptainGoal(ctx: Context, captain: Agent): {
    status: string;
    goal_id?: string;
};

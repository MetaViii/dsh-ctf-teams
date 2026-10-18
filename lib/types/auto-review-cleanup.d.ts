/** Optional host entry: retain upstream review policy; patch only the audited teardown. */
import type { Context } from '@deepseek-ai/cordis';
export declare const name = "ctf-auto-review-cleanup-compat";
export declare const inject: string[];
export declare function apply(ctx: Context): Promise<void>;

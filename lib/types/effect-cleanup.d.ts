import type { Context } from '@deepseek-ai/cordis';
/** Finish every reverse-order teardown even when one rejects; report errors after release. */
export declare function drainCleanup(disposers: readonly (() => unknown)[]): Promise<void>;
/** Scoped workaround for the audited Auto lifecycle; never monkey-patch Cordis globally. */
export declare function autoReviewCleanupContext(ctx: Context): Context;

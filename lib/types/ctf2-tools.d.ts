/** Typed host-side platform bridge; OAuth never enters a solving container. */
import type { Context } from '@deepseek-ai/cordis';
import { type PlatformConfig } from './platform.ts';
import { type AuthorizeExecution } from './execution-tools.ts';
import type { JsonValue } from '@deepseek-ai/dsh-util-values';
export declare function callPlatformBridge(config: PlatformConfig, action: string, args: Record<string, JsonValue>, signal: AbortSignal): Promise<JsonValue>;
export declare function registerCtf2Bridge(ctx: Context, config: PlatformConfig, authorize: AuthorizeExecution): void;

import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
/** Inspect actual presence, independently of the host validator's nested failures. */
export declare function diagnosePlan(plan: unknown): string | undefined;
/** Preserve the published Schema; add diagnostics before the typed executor. */
export declare function withPlanDiagnostics(tool: ToolDefinition): ToolDefinition;

/** Strict JSON-RPC/MCP boundary shared by the CLI and read-only platform adapter. */
export declare class Ctf2ProtocolError extends Error {
    readonly exitCode: number;
    constructor(message: string, exitCode?: number);
}
/** Inspect only an error envelope, never arbitrary challenge objects or nested source code. */
export declare function toolBusinessError(payload: unknown): Record<string, unknown> | undefined;
/** Add MCP failure semantics while preserving the platform's full error and retry metadata. */
export declare function normalizeToolResult(result: unknown): unknown;
export declare function parseRpcResponse(body: string, id: string | number): unknown;
export declare function unwrapToolResult(result: unknown): unknown;
/** Local defence for an explicitly requested unsolved filter; no status is guessed. */
export declare function filterUnsolved(payload: unknown): {
    payload: unknown;
    received: number;
    returned: number;
    unknown: number;
};

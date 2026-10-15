/** Strict JSON-RPC/MCP boundary shared by the CLI and read-only platform adapter. */
export declare class Ctf2ProtocolError extends Error {
    readonly exitCode: number;
    constructor(message: string, exitCode?: number);
}
export declare function parseRpcResponse(body: string, id: string | number): unknown;
export declare function unwrapToolResult(result: unknown): unknown;
/** Local defence for an explicitly requested unsolved filter; no status is guessed. */
export declare function filterUnsolved(payload: unknown): {
    payload: unknown;
    received: number;
    returned: number;
    unknown: number;
};

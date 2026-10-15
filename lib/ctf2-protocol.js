/** Strict JSON-RPC/MCP boundary shared by the CLI and read-only platform adapter. */
export class Ctf2ProtocolError extends Error {
    exitCode;
    constructor(message, exitCode = 2) {
        super(message);
        this.exitCode = exitCode;
        this.name = 'Ctf2ProtocolError';
    }
}
function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseRpcResponse(body, id) {
    const frames = body.split(/\r?\n\r?\n/).map(frame => frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')).filter(data => data && data !== '[DONE]');
    let envelopes;
    try {
        envelopes = frames.length ? frames.map(data => JSON.parse(data)) : [JSON.parse(body)];
    }
    catch {
        throw new Ctf2ProtocolError('Malformed JSON/SSE response; operation outcome is unknown. Inspect platform state before retrying a mutation.');
    }
    const envelope = envelopes.find(value => record(value) && value.id === id);
    if (!record(envelope))
        throw new Ctf2ProtocolError('No JSON-RPC response matching this request id; do not treat notifications as a tool result.');
    if (envelope.error !== undefined)
        throw new Ctf2ProtocolError('JSON-RPC tool request failed; check the tool name, arguments, OAuth and platform state.', 1);
    if (envelope.result === undefined || envelope.result === null)
        throw new Ctf2ProtocolError('Empty/null RPC result; check the tool name. A successful HTTP status is not a successful tool result. Inspect state before retrying mutations.');
    return envelope.result;
}
export function unwrapToolResult(result) {
    if (!record(result))
        throw new Ctf2ProtocolError('Invalid MCP tool result; expected a result object');
    if (result.isError === true) {
        const text = Array.isArray(result.content) ? result.content.filter(record).filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n').slice(0, 600) : '';
        throw new Ctf2ProtocolError(`MCP tool returned isError=true${text ? `: ${text}` : ''}`, 1);
    }
    let payload = result.structuredContent;
    if (payload === undefined) {
        const parts = Array.isArray(result.content) ? result.content.map(item => record(item) && item.type === 'text' ? item.text : item) : [];
        payload = parts.length === 1 ? parts[0] : parts;
        if (typeof payload === 'string') {
            try {
                payload = JSON.parse(payload);
            }
            catch { }
        }
    }
    if (payload === null || payload === undefined || payload === '' || Array.isArray(payload) && payload.length === 0)
        throw new Ctf2ProtocolError('Empty/null tool payload; check the tool name and response contract. Mutation outcome is unknown; inspect state before retrying.');
    return payload;
}
/** Local defence for an explicitly requested unsolved filter; no status is guessed. */
export function filterUnsolved(payload) {
    const paths = [[], ['challenges'], ['items'], ['recommendations'], ['data'], ['data', 'challenges'], ['data', 'items'], ['data', 'recommendations']];
    let selected, values;
    for (const path of paths) {
        let value = payload;
        for (const key of path)
            value = record(value) ? value[key] : undefined;
        if (Array.isArray(value)) {
            selected = path;
            values = value;
            break;
        }
    }
    if (!values || !selected)
        throw new Ctf2ProtocolError('Cannot apply unsolved_only to this response shape; inspect the tool schema instead of trusting an unfiltered list');
    const status = (item) => record(item) ? item.is_solved ?? (record(item.challenge) ? item.challenge.is_solved : undefined) : undefined;
    const filtered = values.filter(item => status(item) === false);
    const unknown = values.filter(item => typeof status(item) !== 'boolean').length;
    if (!selected.length)
        return { payload: filtered, received: values.length, returned: filtered.length, unknown };
    const copy = structuredClone(payload);
    let parent = copy;
    for (const key of selected.slice(0, -1))
        parent = parent[key];
    parent[selected.at(-1)] = filtered;
    copy.client_filter = { unsolved_only: true, received: values.length, returned: filtered.length, unknown_status_omitted: unknown, server_totals_unchanged: true };
    return { payload: copy, received: values.length, returned: filtered.length, unknown };
}

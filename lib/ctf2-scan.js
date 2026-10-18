import { Ctf2ProtocolError } from "./ctf2-protocol.js";
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const bounded = (value, fallback, max, name) => {
    if (value === undefined)
        return fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > max)
        throw new Ctf2ProtocolError(`${name} must be an integer from 1 to ${max}`);
    return value;
};
/** Explicit read-only enumeration. Completeness describes pagination, never an atomic platform snapshot. */
export async function scanUnsolved(input, readPage) {
    if (typeof input.practice_ground_id !== 'string' || !input.practice_ground_id.trim())
        throw new Ctf2ProtocolError('scan-unsolved requires practice_ground_id');
    const maxPages = bounded(input.max_pages, 100, 500, 'max_pages');
    const limit = bounded(input.limit, 50, 100, 'limit');
    const { max_pages: _max, page: _page, unsolved_only: _unsolved, ...filters } = input;
    const startedAt = new Date().toISOString(), seen = new Map(), pageKeys = new Set();
    let pages = 0, rows = 0, duplicates = 0, missingIds = 0, conflicts = 0, lastTotal;
    let complete = false;
    const warnings = [];
    for (let page = 1; page <= maxPages; page++) {
        const response = await readPage({ ...filters, unsolved_only: false, page, limit });
        const body = record(response) && record(response.data) ? response.data : response;
        const items = Array.isArray(body) ? body : record(body) ? body.items ?? body.challenges : undefined;
        if (!Array.isArray(items))
            throw new Ctf2ProtocolError(`scan-unsolved page ${page}: expected items/challenges array`);
        pages++;
        rows += items.length;
        const rawTotal = record(body) ? body.total_page ?? body.total_pages : undefined;
        const total = typeof rawTotal === 'number' && Number.isSafeInteger(rawTotal) && rawTotal >= 0 ? rawTotal : undefined;
        if (total === 0 && items.length)
            warnings.push(`page ${page}: nonempty results with zero advertised pages`);
        if (rawTotal !== undefined && total === undefined)
            warnings.push(`page ${page}: invalid page count`);
        if (lastTotal !== undefined && total !== undefined && lastTotal !== total)
            warnings.push(`page count changed from ${lastTotal} to ${total}; rescan before concluding exhaustion`);
        if (total !== undefined)
            lastTotal = total;
        if (items.length === 0) {
            complete = total === undefined || page >= total;
            if (!complete)
                warnings.push(`empty page ${page} before advertised end ${total}`);
            break;
        }
        const keys = [];
        for (const item of items) {
            if (!record(item) || typeof item.id !== 'string' || !item.id.trim()) {
                missingIds++;
                continue;
            }
            keys.push(item.id);
            const prior = seen.get(item.id);
            if (prior) {
                duplicates++;
                if (typeof prior.is_solved === 'boolean' && typeof item.is_solved === 'boolean' && prior.is_solved !== item.is_solved)
                    conflicts++;
            }
            // A later stale/unknown row must not erase a positive solved observation.
            const status = prior?.is_solved === true || item.is_solved === true ? true
                : typeof item.is_solved === 'boolean' ? item.is_solved : prior?.is_solved;
            seen.set(item.id, { ...prior, ...item, is_solved: status });
        }
        const fingerprint = JSON.stringify([...keys].sort());
        if (!keys.length || pageKeys.has(fingerprint)) {
            warnings.push(`page ${page}: missing identities or repeated page; enumeration stopped`);
            break;
        }
        pageKeys.add(fingerprint);
        if (total !== undefined && page >= total) {
            complete = true;
            break;
        }
        if (total === undefined && items.length < limit) {
            complete = true;
            break;
        }
    }
    if (!complete && pages >= maxPages)
        warnings.push(`max_pages=${maxPages} reached; result is partial`);
    if (missingIds)
        warnings.push(`${missingIds} row(s) omitted without a usable id`);
    if (warnings.length || missingIds || conflicts)
        complete = false;
    if (conflicts)
        warnings.push(`${conflicts} conflicting solved observation(s); solved=true retained conservatively`);
    const values = [...seen.values()], unknown = values.filter(item => typeof item.is_solved !== 'boolean').length;
    if (unknown)
        warnings.push(`${unknown} challenge(s) have unknown solved status and were omitted`);
    return { practice_ground_id: filters.practice_ground_id, filters: { ...filters, limit, unsolved_only: false }, started_at: startedAt, finished_at: new Date().toISOString(), complete: complete && unknown === 0,
        pages_scanned: pages, rows_received: rows, distinct_challenges: seen.size, duplicates, conflicts, unknown_status: unknown,
        items: values.filter(item => item.is_solved === false), warnings,
        notice: 'Read-only observations collected over time, not an atomic snapshot. Recheck a challenge before work; a partial/empty scan does not prove the ground is exhausted.' };
}

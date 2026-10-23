import type { TeamState } from './types.ts';
export type SearchSource = 'finding' | 'task' | 'hypothesis' | 'experiment';
export declare function searchTeamRecords(team: TeamState, input: {
    action: string;
    query?: string;
    source?: string;
    challenge_id?: string;
    offset?: number;
    limit?: number;
    record_ref?: string;
    content_offset?: number;
    content_limit?: number;
}): {
    content_sha256: string;
    content: string;
    content_offset: number;
    total_characters: number;
    next_content_offset: number | null;
    note: string;
    record_ref: string;
    source: SearchSource;
    challenge_id: string | null;
    title: string;
    status: string;
    ts: number;
    ledger_ref: string;
    results?: undefined;
    total?: undefined;
    next_offset?: undefined;
} | {
    ledger_ref: string;
    results: {
        content_sha256: string;
        snippet: string;
        snippet_truncated: boolean;
        record_ref: string;
        source: SearchSource;
        challenge_id: string | null;
        title: string;
        status: string;
        ts: number;
    }[];
    total: number;
    next_offset: number | null;
    note: string;
};

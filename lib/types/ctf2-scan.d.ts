type Row = Record<string, unknown>;
/** Explicit read-only enumeration. Completeness describes pagination, never an atomic platform snapshot. */
export declare function scanUnsolved(input: Row, readPage: (args: Row) => Promise<unknown>): Promise<{
    practice_ground_id: unknown;
    filters: {
        limit: number;
        unsolved_only: boolean;
    };
    started_at: string;
    finished_at: string;
    complete: boolean;
    pages_scanned: number;
    rows_received: number;
    distinct_challenges: number;
    duplicates: number;
    conflicts: number;
    unknown_status: number;
    items: Row[];
    warnings: string[];
    notice: string;
}>;
export {};

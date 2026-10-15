import type { TeamState } from './types.ts';
export interface InboxEntry {
    id: string;
    from: string;
    content: string;
    ts: number;
}
export declare function syncInboxLimit(value?: number): number;
/** Caller holds the team lock and checks participant identity. This function never reacquires it. */
export declare function collectParticipantInbox(root: string, team: TeamState, recipient: string, limit: number): Promise<{
    inbox: InboxEntry[];
    ids: string[];
    remaining: number;
}>;
export declare function formatInbox(inbox: readonly InboxEntry[], remaining: number): string;

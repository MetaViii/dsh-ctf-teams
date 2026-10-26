import type { MemberFault, TeamMember, TeamMessage } from './types.ts';
export interface FailureInput {
    code: string;
    message: string;
    status?: number;
    providerRetryAfterMs?: number;
}
/** Provider-neutral failure policy; only final turn failures enter this ledger. */
export declare function classifyFailure(failure: FailureInput): MemberFault['kind'];
export declare function recordMemberFault(member: TeamMember, failure: FailureInput, now?: number, retryDelayMs?: number): {
    fault: MemberFault;
    notify: boolean;
};
/** Fold old failure storms for display; acknowledge every underlying id only when shown. */
export declare function foldFailureInbox(messages: TeamMessage[]): Array<{
    message: TeamMessage;
    ids: string[];
}>;
/** Configuration failures require a route update; rate limits with unknown reset stay paused. */
export declare function memberAvailable(member: TeamMember, now?: number): boolean;
export declare function availabilityLabel(member: TeamMember): string;
/** Advice is a diagnosis of a report, not a provider quota or inferred reset time. */
export declare function recoveryAdvice(member: TeamMember): {
    reason: string;
    next_action: string;
    retry_at: number | null;
};

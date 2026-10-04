/**
 * CTFTeams session event types — pure types only, zero imports.
 *
 * This file intentionally imports nothing: both the host program (the
 * emitter in `events.ts`) and the browser program (the Conversation Node
 * definition) must be able to load these types and the `SessionEventMap`
 * declaration merge without pulling in host-side `Context` augmentations
 * (dsh-session's index declares `Context.sessions: SessionStore`, which
 * collides with the browser runtime's `ISessions` under the same name).
 * @module dsh-ctf-teams/event-types
 */
/** Opens one team record: the captain created the team. */
export interface CTFTeamsTeamCreatedData {
    readonly teamId: string;
    /** The captain session that owns this team (UI follows it). */
    readonly captainSessionId: string;
    readonly name: string;
    readonly description?: string;
    readonly profile?: string;
}
/** Records one member after its continuable subagent is spawned. */
export interface CTFTeamsMemberAddedData {
    readonly teamId: string;
    readonly memberId: string;
    readonly name: string;
    readonly role?: string;
}
/** Marks one member removed. */
export interface CTFTeamsMemberRemovedData {
    readonly teamId: string;
    readonly memberId: string;
}
/** Records one task in the team's task list. */
export interface CTFTeamsTaskCreatedData {
    readonly teamId: string;
    readonly taskId: string;
    readonly subject: string;
    readonly dependencies: readonly string[];
    readonly assignee?: string;
    readonly kind?: string;
    readonly round?: number;
}
/** Records one task status/assignee/output transition. */
export interface CTFTeamsTaskUpdatedData {
    readonly teamId: string;
    readonly taskId: string;
    readonly status: string;
    readonly assignee?: string;
    readonly output?: string;
    readonly attempt?: number;
    readonly attemptId?: string;
    readonly verdict?: string;
    readonly round?: number;
}
/** Records one captain-only contract amendment on a task. */
export interface CTFTeamsTaskAmendedData {
    readonly teamId: string;
    readonly taskId: string;
    /** Amended contract field names (`objective`, `inScope`, …). */
    readonly fields: readonly string[];
    /** Why the previous contract was wrong. */
    readonly reason: string;
}
/** Records a human halt from the captain chat. */
export interface CTFTeamsTeamHaltedData {
    readonly teamId: string;
    readonly cancelledTasks: number;
}
/** Records an explicit captain resume of a halted team. */
export interface CTFTeamsTeamResumedData {
    readonly teamId: string;
    readonly reason: string;
}
/** Closes one team record: the team was deleted. */
export interface CTFTeamsTeamDeletedData {
    readonly teamId: string;
}
/** Records a staged plan that the user rejected before any member was spawned. */
export interface CTFTeamsPlanDiscardedData {
    readonly teamId: string;
}
/** Records one mailbox message sent between team agents. */
export interface CTFTeamsMessageSentData {
    readonly teamId: string;
    readonly messageId: string;
    /** `captain` or a member name. */
    readonly from: string;
    /** `captain` or a member name. */
    readonly to: string;
    readonly content: string;
    readonly ts: number;
}
/** Records one captain-owned challenge metadata update. */
export interface CTFTeamsChallengeUpdatedData {
    readonly teamId: string;
    /** Challenge title/category after the update. */
    readonly title?: string;
    readonly category?: string;
    readonly flagFormat?: string;
}
/** Records one finding appended to the round-sync board. */
export interface CTFTeamsFindingReportedData {
    readonly teamId: string;
    readonly findingId: string;
    readonly from: string;
    readonly category?: string;
    readonly content: string;
    readonly round: number;
    readonly ts: number;
}
/** Records one candidate flag on the flag board. */
export interface CTFTeamsFlagSubmittedData {
    readonly teamId: string;
    readonly flagId: string;
    readonly flag: string;
    readonly submittedBy: string;
    readonly duplicate: boolean;
    readonly ts: number;
}
/** Records a captain's verdict on one candidate flag. */
export interface CTFTeamsFlagReviewedData {
    readonly teamId: string;
    readonly flagId: string;
    readonly flag: string;
    readonly verdict: 'verified' | 'rejected';
    readonly solved: boolean;
    readonly ts: number;
}
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /**
         * Opens one team record.
         * @param data - stable team identity and display name.
         */
        'ctf-teams/team-created': CTFTeamsTeamCreatedData;
        /**
         * Records one team member.
         * @param data - team identity, member child session, and display identity.
         */
        'ctf-teams/member-added': CTFTeamsMemberAddedData;
        /**
         * Records one member removal.
         * @param data - team identity and the member's child session id.
         */
        'ctf-teams/member-removed': CTFTeamsMemberRemovedData;
        /**
         * Records one task creation.
         * @param data - team identity, task id, subject, dependencies, assignee.
         */
        'ctf-teams/task-created': CTFTeamsTaskCreatedData;
        /**
         * Records one task transition.
         * @param data - team identity, task id, and the new status/assignee/output.
         */
        'ctf-teams/task-updated': CTFTeamsTaskUpdatedData;
        /**
         * Records one captain-only contract amendment.
         * @param data - team identity, task id, amended field names, and reason.
         */
        'ctf-teams/task-amended': CTFTeamsTaskAmendedData;
        /**
         * Records one mailbox message.
         * @param data - team identity, sender, recipient, and content.
         */
        'ctf-teams/message-sent': CTFTeamsMessageSentData;
        /**
         * Records a human halt from the captain chat.
         * @param data - team identity and how many unfinished tasks were cancelled.
         */
        'ctf-teams/team-halted': CTFTeamsTeamHaltedData;
        /**
         * Records an explicit captain resume.
         * @param data - team identity and the resume reason.
         */
        'ctf-teams/team-resumed': CTFTeamsTeamResumedData;
        /**
         * Closes one team record after deletion.
         * @param data - stable team identity.
         */
        'ctf-teams/team-deleted': CTFTeamsTeamDeletedData;
        /**
         * Closes a staged plan rejected during pre-run review.
         * @param data - stable team identity.
         */
        'ctf-teams/plan-discarded': CTFTeamsPlanDiscardedData;
        /**
         * Records one challenge metadata update.
         * @param data - team identity and the changed challenge fields.
         */
        'ctf-teams/challenge-updated': CTFTeamsChallengeUpdatedData;
        /**
         * Records one finding on the round-sync board.
         * @param data - team identity, finding id, author, and content.
         */
        'ctf-teams/finding-reported': CTFTeamsFindingReportedData;
        /**
         * Records one candidate flag submission.
         * @param data - team identity, flag id, flag, and submitter.
         */
        'ctf-teams/flag-submitted': CTFTeamsFlagSubmittedData;
        /**
         * Records one flag verdict.
         * @param data - team identity, flag id, verdict, and whether it solved the challenge.
         */
        'ctf-teams/flag-reviewed': CTFTeamsFlagReviewedData;
    }
}
/** The full set of `ctf-teams/*` event names. */
export type CTFTeamsEventType = 'ctf-teams/team-created' | 'ctf-teams/member-added' | 'ctf-teams/member-removed' | 'ctf-teams/task-created' | 'ctf-teams/task-updated' | 'ctf-teams/task-amended' | 'ctf-teams/message-sent' | 'ctf-teams/team-halted' | 'ctf-teams/team-resumed' | 'ctf-teams/team-deleted' | 'ctf-teams/plan-discarded' | 'ctf-teams/challenge-updated' | 'ctf-teams/finding-reported' | 'ctf-teams/flag-submitted' | 'ctf-teams/flag-reviewed';

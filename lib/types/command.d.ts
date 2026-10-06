import type { Context } from '@deepseek-ai/cordis';
import { type UserMessage } from '@deepseek-ai/dsh-llm';
import { type TeamProfileConfig, type CTFTeamsInvocation } from './profiles.ts';
export declare const CTF_TEAMS_COMMAND = "ctf-teams";
/**
 * Command names this plugin owns outright. A generated profile alias may never
 * take one of these: `/ctf-teams` is the generic activation and
 * `/ctf-teams-board` is the dashboard, so a team profile literally named
 * `board` must not turn into a second dashboard row in the command menu.
 */
export declare const RESERVED_COMMAND_NAMES: readonly string[];
/** Registration options for {@link registerCTFTeamsCommand}. */
export interface CTFTeamsCommandOptions {
    /**
     * Profile the generic `/ctf-teams` command runs when it omits `--profile`.
     * Its generated alias (`/ctf-teams-<name>`) would be the very same activation
     * under a longer name, so it is left unregistered; profile aliases stay for
     * the other profiles, which the generic command cannot select on its own.
     */
    defaultProfile?: string;
}
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'ctf-teams-command': {
            readonly kind: 'ctf-teams-command';
            readonly goal?: string;
            readonly profile?: string;
        };
    }
}
/**
 * Convert a configured profile key into a stable, closed-namespace command
 * suffix. Only lowercase ASCII letters, digits and dashes are representable;
 * this deliberately prevents accidental command aliases for ambiguous profile
 * names such as `foo bar`, `foo_bar`, or non-ASCII keys.
 */
export declare function profileCommandName(profileName: string): string | undefined;
export declare function invokedCTFTeamsInvocation(messages: readonly UserMessage[], getProfiles?: () => Record<string, TeamProfileConfig>): CTFTeamsInvocation | undefined;
export declare function invokedCTFTeamsGoal(messages: readonly UserMessage[]): string | undefined;
/**
 * The directive injected when the user triggers `/ctf-teams`.
 * @param goal - the challenge text the user supplied.
 * @param profile - a team profile the user named, when any.
 * @param taskPlanning - the profile's planning mode.
 * @param autoApprove - true when teams run without a review step (the default):
 *   the directive then asks for `approval="automatic"` and tells the captain not
 *   to stop for approval.
 */
export declare function buildActivationDirective(goal: string, profile?: string, taskPlanning?: 'captain' | 'seed', autoApprove?: boolean): string;
export declare function registerCTFTeamsCommand(ctx: Context, getProfiles?: () => Record<string, TeamProfileConfig>, options?: CTFTeamsCommandOptions): void;
export declare function installCTFTeamsGestureBoundary(ctx: Context, getProfiles?: () => Record<string, TeamProfileConfig>, options?: {
    autoApprove?: boolean;
}): void;
export declare function registerCTFTeamsBoardCommand(ctx: Context, stateDir: string): void;

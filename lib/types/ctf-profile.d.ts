/**
 * The built-in `ctf-teams` team profile.
 *
 * Shipped so the plugin is useful on install: `/ctf-teams <challenge>` (or
 * `ctf_teams_create({profile:'ctf-teams'})`) assembles a squad of interchangeable
 * full-stack CTF experts without any configuration. There are no specialist
 * lanes on purpose: every member covers web, pwn, reverse, crypto, forensics
 * and misc, and the squad attacks the SAME challenge from parallel angles,
 * coordinating through the round-sync board. The captain plans the task graph
 * at runtime (`taskPlanning: 'captain'`) because every challenge splits
 * differently. User-configured profiles with the same name override this one
 * key-for-key (e.g. to field more agents).
 *
 * @module dsh-ctf-teams/ctf-profile
 */
import type { TeamProfileConfig } from './profiles.ts';
/** The profile id every session gets by default. */
export declare const CTF_PROFILE_NAME = "ctf-teams";
/** Default squad size; override the whole profile in config to change it. */
export declare const CTF_SQUAD_SIZE = 4;
/** The shared execution prompt for one full-stack CTF expert. */
export declare function generalistPrompt(agent: string): string;
/** The built-in profile configuration (a plain TeamProfileConfig). */
export declare function builtinCtfProfile(): TeamProfileConfig;
/**
 * Merge the built-in profile under user configuration. User profiles win on
 * exact name collisions, so a workspace can field a bigger squad by
 * overriding the `ctf-teams` name while every other profile keeps working.
 */
export declare function withBuiltinCtfProfile(userProfiles: Record<string, TeamProfileConfig> | undefined): Record<string, TeamProfileConfig>;

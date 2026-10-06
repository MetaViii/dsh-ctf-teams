/**
 * The writeup contract every lane shares.
 *
 * A CTF writeup is a solving record a teammate — or a reader months later —
 * can replay: what the box showed, what the bug was, what was sent, what came
 * back. It is written the way a player writes one, so it carries no trace of
 * how the solve was organized: nothing about the agent, the model, the harness,
 * the team internals, and no remediation advice (a CTF writeup documents an
 * exploit, it does not file a bug report).
 *
 * The text here is the single source for the protocol section, the panel's
 * 写 WRITEUP action and the per-lane guidance, so all three agree.
 * @module dsh-ctf-teams/writeup
 */
/** Where the deliverable lands, relative to the workspace. */
export declare const WRITEUP_PATH = "WRITEUP.md";
/**
 * The deliverable spec, as instruction text for the agent writing it.
 *
 * Deliberately free of tooling and product names: this text becomes part of a
 * public-facing artifact.
 */
export declare const WRITEUP_SPEC: string;
/**
 * The completion contract, shared by the captain protocol and the panel.
 */
export declare const WRITEUP_COMPLETION = "A solved challenge is not finished until WRITEUP.md lets someone replay the whole chain from the challenge files to the flag.";

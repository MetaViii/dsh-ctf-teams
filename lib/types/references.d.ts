/**
 * The CTFTeams references library: curated PoC / CVE / skill repositories,
 * provisioned into the workspace and searched offline.
 *
 * Shipping multi-gigabyte vulnerability archives inside an npm package is
 * neither practical nor license-clean, so this module does what a working
 * box actually needs: it keeps a curated manifest (trickest/cve, cvelistV5,
 * exphub, Awesome-POC, 0xMarcio pocindex/cve, nomi-sec PoC-in-GitHub,
 * ljagiello/ctf-skills, …), clones or updates each repository into
 * `<workspace>/<stateDir>/references/<id>` via shallow git, and reports the
 * absolute paths plus search hints so lanes can `rg` them instantly. All git
 * execution goes through an injectable runner (no shell), keeping the pure
 * parts offline-testable.
 *
 * @module dsh-ctf-teams/references
 */
/** Clone/update granularity and size expectations shown before syncing. */
export type RepoSize = 'small' | 'medium' | 'large' | 'huge';
/** One curated reference repository. */
export interface ReferenceRepoSpec {
    /** Stable id used by the tool API (`awesome-poc`, `cvelistv5`, …). */
    id: string;
    /** `owner/name` on GitHub. */
    repo: string;
    url: string;
    summary: string;
    size: RepoSize;
    /** Layout notes: where the useful files live and what they contain. */
    content: string;
    /** Concrete search examples shown to members. */
    searchHints: readonly string[];
}
/** The curated reference manifest. Ids are the stable tool API. */
export declare const REFERENCE_REPOS: readonly ReferenceRepoSpec[];
export declare const REFERENCE_SIZE_NOTES: Record<RepoSize, string>;
/** Ids considered cheap enough to recommend syncing by default at team start. */
export declare const SMALL_REFERENCE_IDS: readonly string[];
/** What `references.autoSync` should clone when a team is created. */
export type ReferenceAutoSyncMode = 'off' | 'small' | 'all';
/** Resolve the auto-sync target list for a mode ('all' includes GB-scale repos). */
export declare function autoSyncTargets(mode: Exclude<ReferenceAutoSyncMode, 'off'>, specs?: readonly ReferenceRepoSpec[]): ReferenceRepoSpec[];
/** Validate a repo id against the manifest (rejects path-unsafe input). */
export declare function resolveReferenceRepo(id: string, specs?: readonly ReferenceRepoSpec[]): ReferenceRepoSpec;
/** The absolute on-disk location one provisioned repo lives at. */
export declare function referenceRepoPath(repo: ReferenceRepoSpec, referencesDir: string): string;
/** Pure status read of one repo directory (git metadata is checked by callers). */
export declare function referenceStatus(repo: ReferenceRepoSpec, referencesDir: string): {
    spec: ReferenceRepoSpec;
    provisioned: boolean;
    path: string;
};
/** Build the exact git argv for cloning or updating one repo. */
export declare function referenceSyncCommand(repo: ReferenceRepoSpec, referencesDir: string, options?: {
    depth?: number;
    alreadyProvisioned?: boolean;
}): {
    argv: string[];
    cwd?: string;
};
/** Render the listing shown by the references tool. */
export declare function renderReferenceList(statuses: readonly {
    spec: ReferenceRepoSpec;
    provisioned: boolean;
    path: string;
}[], sizeNotes?: Record<RepoSize, string>): string;

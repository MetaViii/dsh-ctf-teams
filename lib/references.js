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
import { existsSync } from 'node:fs';
import { join } from 'node:path';
/** The curated reference manifest. Ids are the stable tool API. */
export const REFERENCE_REPOS = [
    {
        id: 'ctf-skills',
        repo: 'ljagiello/ctf-skills',
        url: 'https://github.com/ljagiello/ctf-skills',
        summary: 'agent skills for CTF domains: web, pwn, crypto, reverse, forensics, solve strategy, writeups (MIT)',
        size: 'small',
        content: 'SKILL.md-style playbooks per domain; read the matching skill before choosing an attack path',
        searchHints: ['ls <path>', 'rg -i "deserialization" <path>'],
    },
    {
        id: 'awesome-poc',
        repo: 'WyAtu/Awesome-POC',
        url: 'https://github.com/WyAtu/Awesome-POC',
        summary: 'curated vulnerability PoC index (~500 entries, middleware/CMS/frameworks, CN)',
        size: 'small',
        content: 'one large categorized README linking PoC repos per product; grep by product or CVE id',
        searchHints: ['rg -i "weblogic|confluence|thinkphp" <path>', 'rg -i "CVE-2023-" <path>'],
    },
    {
        id: 'exphub',
        repo: 'zhzyker/exphub',
        url: 'https://github.com/zhzyker/exphub',
        summary: 'ready-to-run exploit scripts for classic CVEs (weblogic, struts, shiro, …)',
        size: 'medium',
        content: 'exploits/<product>/ directories with python exploit scripts + usage headers',
        searchHints: ['ls <path>/2020', 'rg -il "cve-2021-21974" <path>'],
    },
    {
        id: 'pocindex',
        repo: '0xMarcio/pocindex',
        url: 'https://github.com/0xMarcio/pocindex',
        summary: 'searchable index of 82,000+ public CVE PoCs (GitHub/Nuclei/ExploitDB/Metasploit/Vulhub)',
        size: 'medium',
        content: 'flat index files keyed by CVE id; look up the CVE, follow the source links',
        searchHints: ['rg -l "CVE-2024-3400" <path>', 'rg "CVE-2025-" <path> | head'],
    },
    {
        id: 'marcio-cve',
        repo: '0xMarcio/cve',
        url: 'https://github.com/0xMarcio/cve',
        summary: 'latest CVEs with their PoC references, auto-aggregated per year',
        size: 'large',
        content: 'per-year markdown files (cve/2025/…), one entry per CVE with PoC links and metadata',
        searchHints: ['rg -l "CVE-2026-1234" <path>/2026', 'ls <path>'],
    },
    {
        id: 'trickest-cve',
        repo: 'trickest/cve',
        url: 'https://github.com/trickest/cve',
        summary: 'auto-aggregated CVE database with PoC references, organized by year',
        size: 'huge',
        content: 'cve/<year>/CVE-<year>-<id>/ directories with description + references + PoC links',
        searchHints: ['ls <path>/cve/2025 | head', 'rg -l "CVE-2025-24813" <path>'],
    },
    {
        id: 'poc-in-github',
        repo: 'nomi-sec/PoC-in-GitHub',
        url: 'https://github.com/nomi-sec/PoC-in-GitHub',
        summary: 'daily-updated JSON index of CVE PoCs found on GitHub',
        size: 'large',
        content: 'per-year JSON files with per-CVE PoC repo links and stars',
        searchHints: ['rg -l "CVE-2025-31324" <path>/2025', 'rg -c "Exploit" <path>/2024/01*'],
    },
    {
        id: 'cvelistv5',
        repo: 'CVEProject/cvelistV5',
        url: 'https://github.com/CVEProject/cvelistV5',
        summary: 'the official CVE List in CVE JSON v5 format (authoritative descriptions, CNA data)',
        size: 'huge',
        content: 'cves/<year>/<id-start>/CVE-<year>-<id>.json — the canonical record: affected products, versions, CWE, references',
        searchHints: ['ls <path>/cves/2025 | head', 'cat <path>/cves/2025/24xxx/CVE-2025-24813.json'],
    },
];
export const REFERENCE_SIZE_NOTES = {
    small: 'a few MB — safe to sync immediately',
    medium: 'tens of MB — quick shallow clone',
    large: 'hundreds of MB — shallow clone, prefer targeted rg',
    huge: 'multiple GB — shallow clone only; consider one-off rg against the GitHub API for single CVEs',
};
/** Ids considered cheap enough to recommend syncing by default at team start. */
export const SMALL_REFERENCE_IDS = REFERENCE_REPOS
    .filter((repo) => repo.size === 'small')
    .map((repo) => repo.id);
/** Resolve the auto-sync target list for a mode ('all' includes GB-scale repos). */
export function autoSyncTargets(mode, specs = REFERENCE_REPOS) {
    return mode === 'all' ? [...specs] : specs.filter((repo) => repo.size === 'small');
}
/** Validate a repo id against the manifest (rejects path-unsafe input). */
export function resolveReferenceRepo(id, specs = REFERENCE_REPOS) {
    const trimmed = id.trim().toLowerCase();
    const spec = specs.find((entry) => entry.id === trimmed);
    if (spec === undefined) {
        const known = specs.map((entry) => entry.id).join(', ');
        throw new Error(`unknown reference repo "${id}" — available: ${known}`);
    }
    return spec;
}
/** The absolute on-disk location one provisioned repo lives at. */
export function referenceRepoPath(repo, referencesDir) {
    return join(referencesDir, repo.id);
}
/** Pure status read of one repo directory (git metadata is checked by callers). */
export function referenceStatus(repo, referencesDir) {
    const path = referenceRepoPath(repo, referencesDir);
    return { spec: repo, provisioned: existsSync(join(path, '.git')), path };
}
/** Build the exact git argv for cloning or updating one repo. */
export function referenceSyncCommand(repo, referencesDir, options = {}) {
    const path = referenceRepoPath(repo, referencesDir);
    if (options.alreadyProvisioned === true) {
        return { argv: ['git', '-C', path, 'pull', '--ff-only', '--depth', String(options.depth ?? 1)], cwd: path };
    }
    return {
        argv: ['git', 'clone', '--depth', String(options.depth ?? 1), '--single-branch', repo.url, path],
    };
}
/** Render the listing shown by the references tool. */
export function renderReferenceList(statuses, sizeNotes = REFERENCE_SIZE_NOTES) {
    return statuses.map(({ spec, provisioned, path }) => {
        const head = `${provisioned ? '✓' : '○'} ${spec.id.padEnd(14)} [${spec.size}] ${spec.summary}`;
        const where = provisioned ? `  provisioned at: ${path}` : `  sync target:    ${path}`;
        const search = spec.searchHints.map((hint) => `  search: ${hint}`).join('\n');
        return `${head}\n${where}\n  content: ${spec.content}\n  size: ${sizeNotes[spec.size]}\n${search}`;
    }).join('\n');
}

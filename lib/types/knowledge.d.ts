/**
 * The CTFTeams knowledge base reader.
 *
 * Ships curated CTF references (kali, pwntools, volatility3, sage, per-domain
 * playbooks, and the fresh-PoC/CVE lookup workflow) as markdown under
 * `assets/ctf/knowledge/`, and exposes them to captains and members through
 * the `ctf_teams_knowledge` tool. Pure filesystem access with a strict topic
 * allowlist (no path traversal); every failure degrades to an actionable
 * error instead of breaking a team turn.
 *
 * @module dsh-ctf-teams/knowledge
 */
/** Resolved plugin asset directory that holds the knowledge markdown. */
export declare function knowledgeDir(): string;
/** A topic is one markdown file id; the extension is implied. */
export declare function sanitizeTopic(topic: string): string;
/** One listed knowledge topic with its one-line summary. */
export interface KnowledgeTopic {
    topic: string;
    title: string;
    summary: string;
}
/** List every shipped topic; unknown files are ignored rather than fatal. */
export declare function listKnowledgeTopics(dir?: string): KnowledgeTopic[];
/** Read one full knowledge document. Throws a listing hint when unknown. */
export declare function readKnowledgeDoc(topic: string, dir?: string): string;
/** Render the index block embedded into captain/member prompts. */
export declare function knowledgeIndexText(dir?: string): string;

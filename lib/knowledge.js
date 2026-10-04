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
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
/** Resolved plugin asset directory that holds the knowledge markdown. */
export function knowledgeDir() {
    return fileURLToPath(new URL('../assets/ctf/knowledge/', import.meta.url));
}
/** A topic is one markdown file id; the extension is implied. */
export function sanitizeTopic(topic) {
    const trimmed = topic.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(trimmed)) {
        throw new Error(`invalid knowledge topic "${topic}" — topics are lowercase letters, digits and dashes`);
    }
    return trimmed;
}
function parseDoc(file) {
    const raw = readFileSync(file, 'utf8');
    const lines = raw.split(/\r?\n/);
    let title = '';
    let summary = '';
    for (const line of lines) {
        if (title === '' && line.startsWith('# ')) {
            title = line.slice(2).trim();
            continue;
        }
        if (title !== '' && line.trim() !== '' && !line.startsWith('#')) {
            summary = line.trim();
            break;
        }
    }
    return { title: title || 'Untitled', summary };
}
/** List every shipped topic; unknown files are ignored rather than fatal. */
export function listKnowledgeTopics(dir = knowledgeDir()) {
    let entries;
    try {
        entries = readdirSync(dir);
    }
    catch {
        return [];
    }
    const topics = [];
    for (const entry of entries.sort()) {
        if (!entry.endsWith('.md') || entry.startsWith('_'))
            continue;
        const topic = entry.slice(0, -3);
        try {
            const { title, summary } = parseDoc(join(dir, entry));
            topics.push({ topic, title, summary });
        }
        catch {
            // A damaged doc must not hide the rest of the index.
        }
    }
    return topics;
}
/** Read one full knowledge document. Throws a listing hint when unknown. */
export function readKnowledgeDoc(topic, dir = knowledgeDir()) {
    const safe = sanitizeTopic(topic);
    const file = join(dir, `${safe}.md`);
    try {
        return readFileSync(file, 'utf8').trimEnd();
    }
    catch {
        const known = listKnowledgeTopics(dir).map((entry) => entry.topic).join(', ') || '(none)';
        throw new Error(`no knowledge topic "${safe}" — available topics: ${known}`);
    }
}
/** Render the index block embedded into captain/member prompts. */
export function knowledgeIndexText(dir = knowledgeDir()) {
    const topics = listKnowledgeTopics(dir);
    if (topics.length === 0)
        return '';
    return topics.map((topic) => `- ${topic.topic}: ${topic.title} — ${topic.summary}`).join('\n');
}

/** Workspace file integrity snapshots. A matching hash is not proof of a solve. */
import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
export const EVIDENCE_FILE_LIMIT = 8;
export const EVIDENCE_FILE_MAX_BYTES = 32 * 1024 * 1024;
function inside(root, target) {
    const rel = relative(root, target);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
async function captureOne(workspace, path) {
    // Treat both separator forms as separators, also on Linux. Never execute a path.
    if (!path || path.length > 512 || /[\x00-\x1f]/u.test(path) || isAbsolute(path)
        || /^[A-Za-z]:/u.test(path) || /^[\\/]/u.test(path) || path.split(/[\\/]/u).includes('..')) {
        throw new Error('evidence_files must be workspace-relative file paths without traversal');
    }
    const root = await realpath(workspace);
    const target = await realpath(resolve(root, ...path.split(/[\\/]/u)));
    if (!inside(root, target))
        throw new Error('evidence file resolves outside workspace');
    const handle = await open(target, 'r');
    try {
        const before = await handle.stat();
        if (!before.isFile() || before.size > EVIDENCE_FILE_MAX_BYTES)
            throw new Error('evidence must be a regular file at most 32 MiB');
        const hash = createHash('sha256');
        const buffer = Buffer.alloc(64 * 1024);
        let bytes = 0;
        for (;;) {
            const read = await handle.read(buffer, 0, buffer.length, null);
            if (!read.bytesRead)
                break;
            bytes += read.bytesRead;
            if (bytes > EVIDENCE_FILE_MAX_BYTES)
                throw new Error('evidence file exceeds 32 MiB');
            hash.update(buffer.subarray(0, read.bytesRead));
        }
        const after = await handle.stat();
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || bytes !== before.size) {
            throw new Error('evidence file changed while hashing; retry when stable');
        }
        return { path: relative(root, resolve(root, ...path.split(/[\\/]/u))).split(sep).join('/'), sha256: hash.digest('hex'), bytes, capturedAt: Date.now() };
    }
    finally {
        await handle.close();
    }
}
export async function captureEvidenceFiles(workspace, paths = []) {
    if (paths.length > EVIDENCE_FILE_LIMIT)
        throw new Error('at most 8 evidence_files per test');
    const snapshots = [];
    for (const path of paths) {
        const snapshot = await captureOne(workspace, path);
        if (!snapshots.some(file => file.path === snapshot.path))
            snapshots.push(snapshot);
    }
    return snapshots;
}
export async function inspectEvidenceFiles(workspace, files) {
    const results = [];
    for (const file of files) {
        try {
            const current = await captureOne(workspace, file.path);
            results.push({ path: file.path, status: current.sha256 === file.sha256 && current.bytes === file.bytes ? 'matched' : 'changed', expected_sha256: file.sha256, current_sha256: current.sha256 });
        }
        catch (error) {
            const missing = error.code === 'ENOENT';
            results.push({ path: file.path, status: missing ? 'missing' : 'unreadable' });
        }
    }
    return results;
}

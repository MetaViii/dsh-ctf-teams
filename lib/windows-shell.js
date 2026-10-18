import { win32 } from 'node:path';
/** WinPS bootstrap scripts must find their own modules before inherited PS7 modules. */
export function windowsPowerShellModulePath(env) {
    const value = (name) => Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
    const roots = [
        win32.join(value('SystemRoot') ?? value('WINDIR') ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules'),
        win32.join(value('ProgramFiles') ?? 'C:\\Program Files', 'WindowsPowerShell', 'Modules'),
        ...(value('USERPROFILE') ? [win32.join(value('USERPROFILE'), 'Documents', 'WindowsPowerShell', 'Modules')] : []),
        ...(value('PSModulePath') ?? '').split(';'),
    ];
    const seen = new Set();
    return roots.map(root => root.trim().replace(/^"(.*)"$/, '$1')).filter(root => {
        if (!root)
            return false;
        const key = win32.normalize(root).replace(/[\\/]+$/, '').toLowerCase();
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    }).join(';');
}
/** Process-local and reversible: no profile, registry, ACL or third-party files are edited. */
export function installWindowsShellCompatibility(ctx, options = {}) {
    if ((options.platform ?? process.platform) !== 'win32')
        return;
    const env = options.env ?? process.env;
    ctx.effect(() => {
        const key = Object.keys(env).find(key => key.toLowerCase() === 'psmodulepath') ?? 'PSModulePath';
        const before = env[key];
        const next = windowsPowerShellModulePath(env);
        env[key] = next;
        return () => {
            // A later owner's environment change wins over disposal of this plugin.
            if (env[key] !== next)
                return;
            if (before === undefined)
                delete env[key];
            else
                env[key] = before;
        };
    }, 'ctf-teams: Windows PowerShell module compatibility');
}

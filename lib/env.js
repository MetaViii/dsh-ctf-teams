/**
 * The CTFTeams toolchain service: detect what a working box already has
 * (pwntools, volatility3, sage, kali tooling, …) and install what is missing.
 *
 * Two phases, both exposed through the `ctf_teams_env` tool:
 * 1. `check` — probe every managed tool in parallel (binary lookup + version
 *    probe, or a Python import probe) with an injectable command runner.
 * 2. `install` — build a per-platform install plan from curated package maps
 *    (apt / pip / brew / gem) and execute it argv-by-argv with no shell, or
 *    return the plan with `dry_run`. Heavy tools (sage, ghidra, gdb plugins)
 *    report a manual command instead of executing.
 *
 * Pure logic (`planInstall`, probe matching) is separated from the default
 * runner so the offline verify can drive both without spawning processes.
 *
 * @module dsh-ctf-teams/env
 */
import { spawn } from 'node:child_process';
/** Default runner: argv-spawn (never a shell), bounded by the timeout. */
export const defaultCommandRunner = (argv, timeoutMs) => new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
        if (settled)
            return;
        settled = true;
        resolve(result);
    };
    let child;
    try {
        child = spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    }
    catch (error) {
        finish({ code: -1, stdout: '', stderr: '', error: String(error) });
        return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
        child.kill();
        finish({ code: -1, stdout, stderr, error: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
        clearTimeout(timer);
        finish({ code: -1, stdout, stderr, error: String(error) });
    });
    child.on('close', (code) => {
        clearTimeout(timer);
        finish({ code: code ?? -1, stdout, stderr });
    });
});
const PWNTOOLS_HELP = 'swiss-army kit for pwning: process I/O, shellcraft, ELF/ROP helpers (import as `pwn`)';
/** The curated managed-tool registry. Names are the stable tool API. */
export const TOOL_SPECS = [
    // ── Python library stack ────────────────────────────────────────────────
    { name: 'python3', category: 'misc', summary: 'the Python interpreter every script lane builds on', platforms: ['linux', 'darwin', 'win32'], probe: { kind: 'binary', command: process.platform === 'win32' ? 'python' : 'python3', args: ['--version'], versionRe: '[Pp]ython (\\S+)' }, manual: 'install Python 3 from python.org or your package manager — everything pip-based depends on it' },
    { name: 'pwntools', category: 'binary', summary: PWNTOOLS_HELP, platforms: ['linux', 'darwin', 'win32'], probe: { kind: 'python', module: 'pwn' }, install: { pip: ['pwntools'], apt: ['python3-pwntools'] } },
    { name: 'pycryptodome', category: 'crypto', summary: 'AES/DES/RSA primitives (`from Crypto.Cipher import AES`)', platforms: ['linux', 'darwin', 'win32'], probe: { kind: 'python', module: 'Crypto' }, install: { pip: ['pycryptodome'] } },
    { name: 'z3-solver', category: 'crypto', summary: 'SMT constraint solving for reversing and crypto', platforms: ['linux', 'darwin', 'win32'], probe: { kind: 'python', module: 'z3' }, install: { pip: ['z3-solver'] } },
    { name: 'sympy', category: 'crypto', summary: 'symbolic math for number-theory scripting', platforms: ['linux', 'darwin', 'win32'], probe: { kind: 'python', module: 'sympy' }, install: { pip: ['sympy'] } },
    { name: 'capstone', category: 'binary', summary: 'disassembler framework for scripted analysis', platforms: ['linux', 'darwin', 'win32'], probe: { kind: 'python', module: 'capstone' }, install: { pip: ['capstone'] } },
    { name: 'unicorn', category: 'binary', summary: 'CPU emulator for in-script execution of code chunks', platforms: ['linux', 'darwin', 'win32'], probe: { kind: 'python', module: 'unicorn' }, install: { pip: ['unicorn'] } },
    { name: 'yara-python', category: 'forensics', summary: 'pattern matching for memory/dump triage', platforms: ['linux', 'darwin', 'win32'], probe: { kind: 'python', module: 'yara' }, install: { pip: ['yara-python'] } },
    { name: 'volatility3', category: 'forensics', summary: 'memory forensics framework (`import volatility3`; see knowledge topic volatility3)', platforms: ['linux', 'darwin', 'win32'], probe: { kind: 'python', module: 'volatility3' }, install: { pip: ['volatility3'] } },
    // ── Binary / pwn / reverse ───────────────────────────────────────────────
    { name: 'gdb', category: 'binary', summary: 'dynamic debugging; pair with pwndbg or gef (see manual tools)', probe: { kind: 'binary', command: 'gdb', args: ['--version'], versionRe: 'GNU gdb \\(\\S+\\) (\\S+)' }, install: { apt: ['gdb'], brew: ['gdb'] } },
    { name: 'ropper', category: 'binary', summary: 'ROP gadget finder (alternative: ROPgadget)', probe: { kind: 'binary', command: 'ropper', args: ['--version'], versionRe: 'Ropper.*(\\d+\\.\\S+)' }, install: { pip: ['ropper'] } },
    { name: 'ROPgadget', category: 'binary', summary: 'ROP gadget finder (alternative: ropper)', probe: { kind: 'binary', command: 'ROPgadget', args: ['--version'], versionRe: 'Version: (\\S+)' }, install: { pip: ['ROPGadget'] } },
    { name: 'one_gadget', category: 'binary', summary: 'one-shot execve gadgets inside a provided libc', probe: { kind: 'binary', command: 'one_gadget', args: ['--help'] }, install: { gem: ['one_gadget'] } },
    { name: 'seccomp-tools', category: 'binary', summary: 'dump and decompile seccomp filters', probe: { kind: 'binary', command: 'seccomp-tools', args: ['--help'] }, install: { gem: ['seccomp-tools'] } },
    { name: 'strace', category: 'binary', summary: 'syscall tracing; protocol and anti-debug discovery', platforms: ['linux'], probe: { kind: 'binary', command: 'strace', args: ['-V'], versionRe: 'strace -- version (\\S+)' }, install: { apt: ['strace'] } },
    { name: 'ltrace', category: 'binary', summary: 'library-call tracing; algorithm shape discovery', platforms: ['linux'], probe: { kind: 'binary', command: 'ltrace', args: ['--version'], versionRe: 'ltrace version (\\S+)' }, install: { apt: ['ltrace'] } },
    { name: 'qemu-aarch64', category: 'binary', summary: 'user-mode emulation for foreign-arch binaries', platforms: ['linux', 'darwin'], probe: { kind: 'binary', command: 'qemu-aarch64', args: ['--version'], versionRe: 'qemu-aarch64 version (\\S+)' }, install: { apt: ['qemu-user-static'] }, manual: 'macOS: brew install qemu' },
    { name: 'jadx', category: 'binary', summary: 'Java/Android decompiler (jadx-gui headless: jadx-cli)', probe: { kind: 'binary', command: 'jadx', args: ['--version'], versionRe: '(\\S+)' }, install: { apt: ['jadx'], brew: ['jadx'] } },
    { name: 'binwalk', category: 'forensics', summary: 'firmware/file signature scan and carve', probe: { kind: 'binary', command: 'binwalk', args: ['--help'] }, install: { apt: ['binwalk'], pip: ['binwalk'] } },
    // ── Web / recon ──────────────────────────────────────────────────────────
    { name: 'nmap', category: 'recon', summary: 'port/service/version scanning', probe: { kind: 'binary', command: 'nmap', args: ['--version'], versionRe: 'Nmap version (\\S+)' }, install: { apt: ['nmap'], brew: ['nmap'] } },
    { name: 'masscan', category: 'recon', summary: 'line-rate port sweeps (bounded scopes only)', platforms: ['linux'], probe: { kind: 'binary', command: 'masscan', args: ['--version'], versionRe: 'Masscan version (\\S+)' }, install: { apt: ['masscan'], brew: ['masscan'] } },
    { name: 'sqlmap', category: 'web', summary: 'SQL injection automation for confirmed injection points', probe: { kind: 'binary', command: 'sqlmap', args: ['--version'], versionRe: '(\\S+)' }, install: { apt: ['sqlmap'], pip: ['sqlmap'] } },
    { name: 'gobuster', category: 'web', summary: 'directory/vhost brute force', platforms: ['linux', 'darwin'], probe: { kind: 'binary', command: 'gobuster', args: ['version'], versionRe: 'Gobuster v(\\S+)' }, install: { apt: ['gobuster'], brew: ['gobuster'] } },
    { name: 'ffuf', category: 'web', summary: 'fast web fuzzer for parameter/content discovery', platforms: ['linux', 'darwin'], probe: { kind: 'binary', command: 'ffuf', args: ['-V'], versionRe: 'ffuf version (\\S+)' }, install: { apt: ['ffuf'], brew: ['ffuf'] } },
    { name: 'nikto', category: 'web', summary: 'classic web server scanner (recon, not a solve)', probe: { kind: 'binary', command: 'nikto', args: ['-Version'] }, install: { apt: ['nikto'] } },
    // ── Crypto / forensics / misc ────────────────────────────────────────────
    { name: 'hashcat', category: 'crypto', summary: 'GPU-accelerated hash cracking', platforms: ['linux', 'darwin'], probe: { kind: 'binary', command: 'hashcat', args: ['--version'], versionRe: 'v(\\S+)' }, install: { apt: ['hashcat'], brew: ['hashcat'] } },
    { name: 'john', category: 'crypto', summary: 'John the Ripper hash cracking (with jumbo formats on kali)', probe: { kind: 'binary', command: 'john', args: ['--version'], versionRe: 'John the Ripper (\\S+)' }, install: { apt: ['john'], brew: ['john-jumbo'] } },
    { name: 'tshark', category: 'forensics', summary: 'pcap analysis engine (also used headless in scripts)', probe: { kind: 'binary', command: 'tshark', args: ['--version'], versionRe: 'TShark \\(Wireshark\\) (\\S+)' }, install: { apt: ['tshark'], brew: ['wireshark'] } },
    { name: 'exiftool', category: 'forensics', summary: 'metadata extraction from anything', probe: { kind: 'binary', command: 'exiftool', args: ['-ver'], versionRe: '(\\S+)' }, install: { apt: ['libimage-exiftool-perl'], brew: ['exiftool'] } },
    { name: 'steghide', category: 'forensics', summary: 'steganography embed/extract with passphrases', platforms: ['linux'], probe: { kind: 'binary', command: 'steghide', args: ['--version'], versionRe: 'steghide version (\\S+)' }, install: { apt: ['steghide'] } },
    { name: 'zsteg', category: 'forensics', summary: 'PNG/BMP LSB stego detector', platforms: ['linux', 'darwin'], probe: { kind: 'binary', command: 'zsteg', args: ['--help'] }, install: { gem: ['zsteg'] } },
    { name: 'pngcheck', category: 'forensics', summary: 'PNG chunk structure validator', probe: { kind: 'binary', command: 'pngcheck', args: ['-v'] }, install: { apt: ['pngcheck'] } },
    { name: 'foremost', category: 'forensics', summary: 'file carving from dumps and images', platforms: ['linux'], probe: { kind: 'binary', command: 'foremost', args: ['-V'], versionRe: 'Foremost version (\\S+)' }, install: { apt: ['foremost'] } },
    { name: 'ffmpeg', category: 'misc', summary: 'audio/video transforms (spectrograms, formats)', probe: { kind: 'binary', command: 'ffmpeg', args: ['-version'], versionRe: 'ffmpeg version (\\S+)' }, install: { apt: ['ffmpeg'], brew: ['ffmpeg'] } },
    { name: '7z', category: 'forensics', summary: 'archive handling for odd/encrypted containers', probe: { kind: 'binary', command: process.platform === 'win32' ? '7z' : '7z', args: [] }, install: { apt: ['p7zip-full'], brew: ['p7zip'] } },
    { name: 'jq', category: 'misc', summary: 'JSON wrangling for API-driven challenges', probe: { kind: 'binary', command: 'jq', args: ['--version'], versionRe: 'jq-(\\S+)' }, install: { apt: ['jq'], brew: ['jq'] } },
    { name: 'socat', category: 'misc', summary: 'relay/binding for network challenge plumbing', platforms: ['linux', 'darwin'], probe: { kind: 'binary', command: 'socat', args: ['-V'], versionRe: 'socat by Gerhard' }, install: { apt: ['socat'], brew: ['socat'] } },
    { name: 'rg', category: 'misc', summary: 'ripgrep — the references library search engine', probe: { kind: 'binary', command: 'rg', args: ['--version'], versionRe: 'ripgrep (\\S+)' }, install: { apt: ['ripgrep'], brew: ['ripgrep'] } },
    // ── Heavy / manual only ──────────────────────────────────────────────────
    { name: 'sage', category: 'crypto', summary: 'SageMath: elliptic curves, lattices, Coppersmith', probe: { kind: 'binary', command: 'sage', args: ['--version'], versionRe: 'SageMath version (\\S+)' }, manual: 'apt install sagemath (large) — or `pip install sagemath-standard` / conda-forge sagemath; see knowledge topic sage-math' },
    { name: 'volatility3-cli', category: 'forensics', summary: 'the `vol` binary shell (the library above is usually enough)', platforms: ['linux', 'darwin'], probe: { kind: 'binary', command: 'vol', args: ['--help'] }, manual: 'after `pip install volatility3` the module works; the `vol` wrapper ships with it on most distros' },
    { name: 'pwndbg', category: 'binary', summary: 'gdb plugin: heap views, context, cyclic helpers', manual: 'git clone https://github.com/pwndbg/pwndbg && run its setup.sh (or install gef the same way)' },
    { name: 'ghidra', category: 'binary', summary: 'headless decompilation (analyzeHeadless)', manual: 'kali: apt install ghidra — or download from ghidra-sre.org (needs a JDK)' },
];
function platformOf() {
    return process.platform;
}
function binaryLookupCommand(platform) {
    return platform === 'win32' ? 'where' : 'which';
}
/** The Python launcher used for import probes and pip installs. */
export function pythonBin(configured, platform = platformOf()) {
    if (configured !== undefined && configured !== '')
        return configured;
    return platform === 'win32' ? 'python' : 'python3';
}
function firstMatch(text, pattern) {
    if (pattern === undefined)
        return undefined;
    const match = new RegExp(pattern).exec(text);
    return match?.[1];
}
async function probeSpec(spec, runner, timeoutMs, python, platform) {
    const base = {
        name: spec.name,
        category: spec.category,
        summary: spec.summary,
    };
    const unavailable = spec.platforms !== undefined && !spec.platforms.includes(platform);
    if (spec.probe === undefined) {
        // No safe probe exists (gdb plugins, GUI suites): report the manual path.
        return { ...base, status: 'manual', installHint: spec.manual ?? 'no probe available — follow the manual path' };
    }
    if (spec.probe.kind === 'binary') {
        if (unavailable) {
            return { ...base, status: 'unavailable', installHint: spec.manual ?? 'not available on this platform' };
        }
        const lookup = await runner([binaryLookupCommand(platform), spec.probe.command], timeoutMs);
        const found = lookup.code === 0 && lookup.stdout.trim() !== '';
        if (!found)
            return { ...base, status: 'missing', installHint: installHintOf(spec, platform) };
        const path = lookup.stdout.split(/\r?\n/).find((line) => line.trim() !== '');
        let version;
        if (spec.probe.args !== undefined) {
            const probe = await runner([spec.probe.command, ...spec.probe.args], timeoutMs);
            version = firstMatch(`${probe.stdout}\n${probe.stderr}`, spec.probe.versionRe);
        }
        return { ...base, status: 'ok', version, path, installHint: 'installed' };
    }
    // Python import probe — works on every platform with a Python.
    const result = await runner([python, '-c', `import ${spec.probe.module}`], timeoutMs);
    if (result.code === 0) {
        const versionProbe = await runner([python, '-c', `import ${spec.probe.module}; print(getattr(${spec.probe.module}, '__version__', ''))`], timeoutMs);
        const version = versionProbe.stdout.trim() || undefined;
        return { ...base, status: 'ok', version, installHint: 'installed' };
    }
    if (unavailable)
        return { ...base, status: 'unavailable', installHint: spec.manual ?? 'not available on this platform' };
    return { ...base, status: 'missing', installHint: installHintOf(spec, platform) };
}
function installHintOf(spec, platform) {
    if (spec.manual !== undefined)
        return `manual: ${spec.manual}`;
    const preferred = preferredManager(spec, platform);
    if (preferred !== undefined)
        return `${preferred}: ${(spec.install?.[preferred] ?? []).join(' ')}`;
    // This platform has no curated manager for the tool — surface what the
    // other platforms use so the operator can decide (WSL/kali, manual, …).
    const available = ['apt', 'pip', 'brew', 'gem']
        .filter((manager) => (spec.install?.[manager] ?? []).length > 0);
    if (available.length > 0) {
        return `no curated ${platform} installer — on other platforms: ${available.map((manager) => `${manager}: ${(spec.install?.[manager] ?? []).join(' ')}`).join(' | ')}`;
    }
    return 'no automatic install for this platform — see the knowledge topics';
}
function preferredManager(spec, platform) {
    const install = spec.install;
    if (install === undefined)
        return undefined;
    // Python libraries always prefer pip: distro packages lag behind and the
    // import probe targets the pip-installed module.
    if (spec.probe?.kind === 'python' && install.pip !== undefined)
        return 'pip';
    if (platform === 'linux') {
        if (install.apt !== undefined)
            return 'apt';
        if (install.pip !== undefined)
            return 'pip';
        if (install.gem !== undefined)
            return 'gem';
    }
    if (platform === 'darwin') {
        if (install.brew !== undefined)
            return 'brew';
        if (install.pip !== undefined)
            return 'pip';
        if (install.gem !== undefined)
            return 'gem';
        if (install.apt !== undefined)
            return 'apt';
    }
    if (platform === 'win32') {
        if (install.pip !== undefined)
            return 'pip';
    }
    return undefined;
}
/**
 * Build the ordered install plan for the requested tools. Callers decide
 * which tools need work (usually the `missing` ones from `detectTools`); the
 * plan maps each tool to its platform's preferred manager and exact argv.
 */
export function planInstall(requested, specs, platform = platformOf(), options = {}) {
    const byName = new Map(specs.map((spec) => [spec.name, spec]));
    const unknown = requested.filter((name) => !byName.has(name));
    const steps = [];
    for (const name of requested) {
        const spec = byName.get(name);
        if (spec === undefined)
            continue;
        if (spec.platforms !== undefined && !spec.platforms.includes(platform)) {
            steps.push({ tool: spec.name, manager: 'manual', note: `not available on ${platform}` });
            continue;
        }
        if (spec.install === undefined) {
            steps.push({ tool: spec.name, manager: 'manual', note: spec.manual ?? 'no automatic install is curated for this tool' });
            continue;
        }
        const manager = preferredManager(spec, platform);
        if (manager === undefined) {
            steps.push({ tool: spec.name, manager: 'manual', note: spec.manual ?? installHintOf(spec, platform) });
            continue;
        }
        const packages = spec.install[manager] ?? [];
        let argv;
        if (manager === 'apt') {
            const base = ['apt-get', 'install', '-y', ...packages];
            argv = options.sudo ? ['sudo', '-n', ...base] : base;
        }
        else if (manager === 'pip') {
            argv = [pythonBin(options.python, platform), '-m', 'pip', 'install', ...packages];
        }
        else if (manager === 'brew') {
            argv = ['brew', 'install', ...packages];
        }
        else {
            argv = ['gem', 'install', ...packages];
        }
        steps.push({ tool: spec.name, manager, argv, packages });
    }
    return { steps, unknown };
}
/** Detect a set of tools (default: everything managed). */
export async function detectTools(options = {}) {
    const specs = options.specs ?? TOOL_SPECS;
    const runner = options.runner ?? defaultCommandRunner;
    const timeoutMs = options.timeoutMs ?? 10_000;
    const platform = platformOf();
    const selected = options.tools === undefined
        ? specs
        : specs.filter((spec) => options.tools?.includes(spec.name));
    const statuses = await Promise.all(selected.map((spec) => probeSpec(spec, runner, timeoutMs, pythonBin(options.python, platform), platform)));
    const byName = new Map(statuses.map((status) => [status.name, status]));
    return specs
        .map((spec) => byName.get(spec.name))
        .filter((status) => status !== undefined);
}
/** Execute an install plan sequentially; re-probe installed tools afterwards. */
export async function runInstallPlan(steps, options = {}) {
    const runner = options.runner ?? defaultCommandRunner;
    const timeoutMs = options.timeoutMs ?? 300_000;
    const outcomes = [];
    for (const step of steps) {
        if (step.manager === 'manual' || step.argv === undefined) {
            outcomes.push({ tool: step.tool, ok: false, manager: step.manager, detail: step.note ?? 'manual step' });
            continue;
        }
        const result = await runner(step.argv, timeoutMs);
        const tail = (input) => {
            const trimmed = input.trim();
            return trimmed.length > 600 ? `…${trimmed.slice(-600)}` : trimmed;
        };
        if (result.code === 0) {
            const spec = (options.specs ?? TOOL_SPECS).find((entry) => entry.name === step.tool);
            let version;
            if (spec !== undefined) {
                const [status] = await detectTools({ tools: [spec.name], runner, timeoutMs: 10_000, python: options.python, specs: options.specs });
                version = status?.version;
            }
            outcomes.push({ tool: step.tool, ok: true, manager: step.manager, detail: `${step.manager} install finished`, version });
        }
        else {
            const detail = result.error === undefined
                ? `exit ${result.code}: ${tail(result.stderr !== '' ? result.stderr : result.stdout)}`
                : `${result.error} ${tail(result.stderr)}`.trim();
            outcomes.push({ tool: step.tool, ok: false, manager: step.manager, detail });
        }
    }
    return outcomes;
}
/** Compact human/model-facing render of a detection report. */
export function renderStatuses(statuses) {
    const lines = statuses.map((status) => {
        const mark = status.status === 'ok' ? '✓' : status.status === 'missing' ? '✗' : '○';
        const version = status.version === undefined || status.version === '' ? '' : ` ${status.version}`;
        const detail = status.status === 'ok'
            ? `${status.path ?? 'python module'}${version}`
            : status.installHint;
        return `${mark} ${status.name.padEnd(16)} ${detail}`;
    });
    return lines.join('\n');
}

/** Explicit local/WSL inspection; never infer Linux tools from Windows PATH. */
import { defaultCommandRunner, detectTools, TOOL_SPECS, type CommandRunner, type ToolSpec, type ToolStatus } from './env.ts'

// WSL launcher concurrency timed out on the actual Windows host. Keep one
// probe in flight across checks/lanes, without killing or terminating a distro.
let wslTail: Promise<unknown> = Promise.resolve()
function serialWsl(runner: CommandRunner): CommandRunner {
  return (argv, timeoutMs) => {
    const pending = wslTail.then(() => runner(argv, timeoutMs))
    wslTail = pending.catch(() => {})
    return pending
  }
}

export interface RuntimeToolReport {
  runtime: 'local' | 'wsl'
  host_platform: NodeJS.Platform
  probe_platform: NodeJS.Platform
  runtime_ready: boolean
  distribution?: string
  available_distributions?: string[]
  python: string
  search_path?: string
  unknown: string[]
  statuses: ToolStatus[]
  error?: string
}

export async function detectRuntimeTools(options: {
  runtime?: 'local' | 'wsl'; distribution?: string; tools?: readonly string[]
  python?: string; timeoutMs?: number; runner?: CommandRunner
  hostPlatform?: NodeJS.Platform; specs?: readonly ToolSpec[]
} = {}): Promise<RuntimeToolReport> {
  const runtime = options.runtime ?? 'local', host = options.hostPlatform ?? process.platform
  const platform = runtime === 'wsl' ? 'linux' : host
  // Owner-configured Windows paths never leak into the Linux interpreter choice.
  const python = runtime === 'wsl' ? 'python3' : options.python || (host === 'win32' ? 'python' : 'python3')
  const specs = options.specs ?? TOOL_SPECS
  const report: RuntimeToolReport = { runtime, host_platform: host, probe_platform: platform, runtime_ready: false, python, statuses: [], unknown: [...new Set((options.tools ?? []).filter(name => !specs.some(spec => spec.name === name)))] }
  let runner = options.runner ?? defaultCommandRunner
  if (runtime === 'local' && options.distribution !== undefined) throw new Error('distribution requires runtime=wsl')
  if (runtime === 'wsl') {
    if (host !== 'win32') return { ...report, error: 'WSL inspection requires a Windows host; use runtime=local inside Linux.' }
    runner = serialWsl(runner)
    const inventory = await runner(['wsl.exe', '--list', '--quiet'], options.timeoutMs ?? 10_000)
    if (inventory.code !== 0) return { ...report, error: `WSL discovery failed (${inventory.code}): ${(inventory.error || inventory.stderr || inventory.stdout).trim().slice(-600)}` }
    report.available_distributions = [...new Set(inventory.stdout.replace(/^\uFEFF/, '').split(/\r?\n/).map(name => name.trim()).filter(Boolean))]
    const distribution = options.distribution
    if (!distribution) return { ...report, error: 'Select an explicit distribution from available_distributions; no Linux tools have been checked.' }
    if (/^[\s-]|[\x00-\x1f\x7f\\/]/.test(distribution) || distribution.length > 128 || !report.available_distributions.includes(distribution)) return { ...report, error: 'The requested distribution is not an exact installed WSL name.' }
    report.distribution = distribution
    const hostRunner = runner
    let linuxPath = '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
    // Only curated probe argv cross the boundary. No shell or user command text.
    // WSL appends Windows PATH by default; searching mounted Windows directories
    // made missing-tool lookups time out. Use a documented Linux-only scope.
    runner = (argv, timeout) => hostRunner(['wsl.exe', '--distribution', distribution, '--exec', '/usr/bin/env', 'LC_ALL=C', 'TERM=dumb', `PATH=${linuxPath}`, ...argv], timeout)
    const boot = await runner(['uname', '-s'], options.timeoutMs ?? 20_000)
    if (boot.code !== 0 || boot.stdout.trim() !== 'Linux') return { ...report, error: `WSL runtime did not pass the Linux startup probe (${boot.code}): ${(boot.error || boot.stderr || boot.stdout).trim().slice(-600)}` }
    const home = await runner(['/usr/bin/printenv', 'HOME'], options.timeoutMs ?? 10_000)
    const directory = home.stdout.trim()
    if (home.code !== 0 || !directory.startsWith('/') || /[\x00-\x1f\x7f:]/.test(directory)) return { ...report, error: 'WSL user HOME could not be resolved; no tool inventory was inferred.' }
    linuxPath = `${directory}/.local/bin:${directory}/bin:${linuxPath}`
    report.search_path = linuxPath
  }
  report.runtime_ready = true
  report.statuses = await detectTools({ tools: options.tools, python, platform, runner, specs, timeoutMs: options.timeoutMs, concurrency: runtime === 'wsl' ? 1 : 8 })
  return report
}

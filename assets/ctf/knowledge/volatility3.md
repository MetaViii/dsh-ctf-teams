# Volatility 3 (memory forensics)

Command is `vol` (or `vol.py`, `python3 -m volatility3`). No profiles needed —
it auto-detects from the dump. `ctf_teams_env` detects the library (python
module `volatility3`) and installs it with pip when missing. Always run
`windows.info`/`linux.info` first to confirm the symbol table resolved
(`Unable to validate` symbols → wrong OS guess or partial dump).

## Windows dumps

```bash
vol -f mem.dmp windows.info
vol -f mem.dmp windows.pslist          # live processes (linked list)
vol -f mem.dmp windows.pstree          # parent/child view, find hidden spawns
vol -f mem.dmp windows.cmdline         # full command lines of every process
vol -f mem.dmp windows.netscan         # sockets, connections, remnant artifacts
vol -f mem.dmp windows.filescan | grep -i flag          # file objects in memory
vol -f mem.dmp windows.dumpfiles --virtaddr 0x...      # carve out a file
vol -f mem.dmp windows.handles --pid <PID>
vol -f mem.dmp windows.registry.printkey --key "Software\\Microsoft\\Windows\\CurrentVersion\\Run"
vol -f mem.dmp windows.malfind         # injected code — common CTF pivot
vol -f mem.dmp windows.memmap --dump --pid <PID>       # full process memory
```

`windows.pslist` vs `windows.psscan`: the scan finds terminated/hidden
processes — a classic "the malware exited before acquisition" puzzle.

## Linux dumps

```bash
vol -f mem.dmp linux.info
vol -f mem.dmp linux.pslist
vol -f mem.dmp linux.bash              # shell history per pid
vol -f mem.dmp linux.environ           # env vars (flags hide here)
vol -f mem.dmp linux.check_syscall     # hooked syscalls (rootkit challenges)
vol -f mem.dmp linux.pagecache.Files   # files resident in page cache; --find/--dump
```

## Workflow that finds flags fast

1. `strings -n 6 mem.dmp | grep -iE 'flag\{|ctf\{'` — cheap first pass.
2. Identify the OS, then `pstree`/`pslist` + `cmdline` — look for odd
   parents (e.g. notepad spawning powershell).
3. `netscan` for exfil endpoints; `filescan` + `dumpfiles` for artifacts.
4. Grep dumped process memory for the flag format instead of eyeballing.

## Practical rules

- Symbol resolution failures are usually a wrong OS guess — check the dump
  header strings (`Linux version`, `Windows Build`) before fighting plugins.
- Keep every dumpfile output path noted; the writeup needs exact artifacts.
- For partial/corrupt dumps, `windows.pslist` may die while
  `windows.psscan` still works — try both.

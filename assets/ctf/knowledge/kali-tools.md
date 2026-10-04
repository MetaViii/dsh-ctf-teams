# Kali Toolbox

What is typically available on a CTF working box (kali rolling or the team's
container). Check capability first, install second — and let the plugin do
both: `ctf_teams_env` with `action=check` probes every tool below (with
versions) in one call, and `action=install` installs the missing ones from a
curated apt/pip/brew/gem map (heavy tools like sage/ghidra report their manual
command). Use `dry_run=true` to review the plan before executing. For
anything outside the managed catalog, verify manually:

```bash
which <tool>
python3 -c 'import pwn, Crypto, z3, sympy' 2>&1
pip3 list 2>/dev/null | grep -Ei 'pwn|crypto|volatility|sage|z3|pillow|numpy'
```

The managed catalog covers PyCryptodome (`Crypto`), `z3-solver` (`z3`), SymPy,
pwntools (`pwn`), ropper, ROPgadget, capstone, unicorn, volatility3, gdb,
nmap, sqlmap, hashcat, john, tshark, exiftool, binwalk, steghide, ffmpeg and
more — `ctf_teams_env` with no `action` lists it.

## Web

`curl`, `chromium`/`firefox`, `ffuf`, `feroxbuster`, `gobuster`, `dirsearch`,
`nuclei`, `sqlmap`, `nikto`, `whatweb`, `wpscan`, `jwt-tool`/`jwtcrack`,
`arjun`, `httpx`. For one-off requests prefer `curl -i` or a small python
`requests` script you can iterate on.

## Pwn / Reverse

`gdb` + `pwndbg`/`gef`, `checksec`, `ropper`, `ROPgadget`, `one_gadget`,
`seccomp-tools`, `patchelf`, `strace`, `ltrace`, `qemu-user` (qemu-aarch64 &
friends for foreign-arch binaries), `objdump`, `readelf`, `strings`, `nm`,
`binwalk`, `r2`/`radare2`, `ghidra` (headless: `analyzeHeadless`), `jadx`,
`apktool`, `upx -d`.

## Crypto

`hashcat`, `john` (+ `john2hashcat` format helpers), `openssl`, `sage`
(Mathlib/SageMath — see the `sage-math` topic), `z3`, `yafu`/`factordb`
lookups, `rsatool`, `RsaCtfTool`, `xortool`, `freq.py`-style analysis is
trivial to inline.

## Forensics / Misc

`vol` (volatility3 — see its topic), `tshark`, `tcpdump`, `foremost`,
`binwalk -e`, `exiftool`, `steghide`, `stegseek`, `zsteg`, `stegsolve`
(needs a GUI — use python PIL scripting on headless boxes), `pngcheck`,
`zbarimg`, `tesseract`, `ffmpeg`, `minimodem`, `7z`, `unzip`, `zipdetails`,
`pdfid`/`pdftotext`, `图像 tools`: ImageMagick `convert`.

## Network / Recon

`nmap`, `masscan`, `fscan`, `netexec` (nxc), `enum4linux-ng`, `impacket-*`
(`smbexec.py`, `secretsdump.py`, `GetNPUsers.py`, `psexec.py`), `responder`,
`socat`, `chisel`, `proxychains4`, `tcpdump`.

## Conventions that save rounds

- Save scan/brute output to files in the workspace (`nmap -oN recon.nmap`) —
  teammates can then grep them instead of re-running.
- Bounded scans only: target host + explicit ports, not `/8` sweeps.
- Anything that would be a dead end is worth one `dead-end` finding, not an hour.

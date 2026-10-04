# CTFTeams Knowledge Base

Curated references shipped with the plugin. Read the topic that matches your
assigned task **before** choosing an attack path, and prefer listed tools over
installing replacements. Call `ctf_teams_knowledge` with a topic id to read
one; call it without arguments to list everything.

Two companion services back this knowledge up with the actual machine:

- `ctf_teams_env` — probes the local box for every managed tool (pwntools,
  volatility3, sage, kali tooling, …) and installs the missing ones from a
  curated apt/pip/brew/gem map. Heavy tools report their manual command.
- `ctf_teams_references` — provisions the offline PoC/CVE/skill libraries
  (ctf-skills, Awesome-POC, exphub, 0xMarcio pocindex/cve, trickest/cve,
  PoC-in-GitHub, cvelistV5) under `<workspace>/.ctf-teams/references/`;
  search them with `rg` before hunting online.

Topics:

- kali-tools — the working toolbox: what is installed, when to reach for it
- pwntools — process/network I/O, shellcraft, ELF/gdb helpers, cyclic offsets
- sage-math — SageMath one-liners for RSA/ECC/lattices when Python crypto libs stall
- volatility3 — memory forensics profile-free workflow, plugins, Windows/Linux
- web — recon→fuzz→exploit playbook: SQLi, SSTI, deserialization, JWT, SSRF, upload
- pwn — binary exploitation ladder: recon, protections, ROP, heap, kernel-adjacent
- reverse — static/dynamic RE ladder: identify, decompile, unpack, script the boring parts
- crypto — RSA/AES/classical recipes, attack selection by shape, z3 for constraints
- forensics — pcap, disk, memory, stego, file-carving workflow and one-liners
- misc — encodings, OSINT, QR/audio/midi tricks, pointless-but-scored oddities
- cve-poc — how to hunt, verify and adapt fresh PoCs/CVEs at solve time

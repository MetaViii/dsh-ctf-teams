#!/usr/bin/env python3
# Lane B evidence capture - NSSCTF node4.anna.nssctf.cn:24112
# Prints, for each payload: offline filter pre-check verdict + raw live response.
import re
import sys
import urllib.parse
import urllib.request

BASE = "http://node4.anna.nssctf.cn:24112/"
RX = re.compile(
    r"sys|pas|read|file|ls|cat|tac|head|tail|more|less|php|base|echo|cp|"
    r"\$|\*|\+|\^|scan|\.|local|current|chr|crypt|show_source|high|"
    r"readgzfile|dirname|time|next|all|hex2bin|im|shell", re.I)


def probe(payload, timeout=20):
    hits = sorted({m.group(0).lower() for m in RX.finditer(payload)})
    url = BASE + "?code=" + urllib.parse.quote(payload, safe="")
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            body = r.read().decode("utf-8", "replace")
    except Exception as exc:  # noqa: BLE001
        body = "<TRANSPORT ERROR: %s>" % exc
    i = body.rfind("<br>")
    sink = body[i + 4:].strip() if i != -1 else body.strip()
    if "你想干什么" in body:
        sink = "<<FILTER REJECTED BY SERVER>>"
    print("PAYLOAD  : %s" % payload)
    print("URL      : %s" % url)
    print("OFFLINE  : %s%s" % ("ACCEPT" if not hits else "REJECT",
                               "" if not hits else " hits=%s" % hits))
    print("RAW SINK : %s" % sink.replace("\n", "\\n")[:600])
    print("-" * 76)
    sys.stdout.flush()
    return sink


if __name__ == "__main__":
    for pl in sys.argv[1:]:
        probe(pl)

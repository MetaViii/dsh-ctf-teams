#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Regenerate node4-24112/listing.txt (raw dir/find output) from recon-raw.json.

Run:  python dump_listing.py
No network access needed - pure post-processing of the already captured bodies.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(os.path.join(HERE, "recon-raw.json"), encoding="utf-8"))

order = ["id", "pwd", "dirroot", "findroot", "uname"]
out = []
out.append("# Raw listings captured from http://node4.anna.nssctf.cn:24112/")
out.append("# target died (ECONNREFUSED 10061) right after the solve, so the "
           "payloads below cannot be re-run until the instance is redeployed.")
out.append("")
for k in order:
    if k not in d:
        continue
    r = d[k]
    out.append("=" * 78)
    out.append("probe   : %s" % k)
    out.append("payload : %s" % r["code"])
    out.append("url     : %s" % r["url"])
    out.append("marker  : %s" % r["marker"])
    out.append("=" * 78)
    out.append(r["out"])
    out.append("")

with open(os.path.join(HERE, "listing.txt"), "w", encoding="utf-8") as f:
    f.write("\n".join(out))
print("[+] listing.txt rewritten, %d bytes" % os.path.getsize(os.path.join(HERE, "listing.txt")))

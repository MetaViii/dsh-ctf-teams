#!/usr/bin/env python3
r"""
Offline selftest harness for node4-27309/exploit.py -- NOT the real target.

Byte-for-byte same blacklist / same two echo strings / same "exec into the php cwd"
behaviour as the challenge, plus a tiny /bin/sh emulator that knows only the payload
shapes this lane uses (`id`, `dir /`, `nl <glob>`, `od|strings|grep|tail <glob>`,
`find /`) and a fake root directory.  It exists so the whole client chain
(URL-encode -> ?url= -> blacklist -> tee -> GET /<name> -> flag regex) can be exercised
end to end while http://node4.anna.nssctf.cn:27309/ is down.

Deliberately serves a PLACEHOLDER flag, so nobody mistakes mock output for the real one.
"""
import glob as _glob
import os
import re
import shutil
import tempfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

# --- exact blacklist from the challenge source --------------------------------
BLACKLIST = re.compile(r'bash|nc|wget|ping|ls|cat|more|less|phpinfo|base64|echo|php|python|mv|cp|la|\-|\*|"|>|<|%|\$', re.I)
OK_STR = "Can you see anything?"
BAD_STR = "Sorry,you can't use this."
PLACEHOLDER_FLAG = "NSSCTF{selftest-placeholder-not-the-real-flag}"

ROOT = os.path.join(tempfile.gettempdir(), "node4_mock_webroot")
FAKE_ROOT = os.path.join(ROOT, "_fake_fs")

FAKE_ROOT_ENTRIES = [
    "a_here_is_a_f1ag", "bin", "boot", "dev", "etc", "flllllaaaaaaggggggg", "home",
    "lib", "lib64", "media", "mnt", "opt", "proc", "root", "run", "sbin", "srv",
    "sys", "tmp", "usr", "var",
]


def build_root():
    """(Re)create the mock webroot == the mock filesystem root."""
    if os.path.isdir(ROOT):
        shutil.rmtree(ROOT, ignore_errors=True)
    os.makedirs(FAKE_ROOT, exist_ok=True)
    for e in FAKE_ROOT_ENTRIES:
        p = os.path.join(FAKE_ROOT, e)
        if e in ("bin", "boot", "dev", "etc", "home", "lib", "lib64", "media", "mnt",
                 "opt", "proc", "root", "run", "sbin", "srv", "sys", "tmp", "usr", "var"):
            os.makedirs(p, exist_ok=True)
    with open(os.path.join(FAKE_ROOT, "a_here_is_a_f1ag"), "w") as fh:
        fh.write("true_flag_1s_1n_flllllaaaaaaggggggg\n")
    with open(os.path.join(FAKE_ROOT, "flllllaaaaaaggggggg"), "w") as fh:
        fh.write(PLACEHOLDER_FLAG + "\n")
    return ROOT


def _resolve(path):
    """Map an absolute payload path onto the mock fs, honouring ? globs."""
    if path in ("/", ""):
        return FAKE_ROOT
    cand = os.path.join(FAKE_ROOT, path.lstrip("/"))
    if os.path.exists(cand):
        return cand
    hits = _glob.glob(cand)
    return hits[0] if hits else cand


def sh(cmd, cwd):
    """Tiny stand-in for `/bin/sh -c cmd` covering this lane's payload shapes."""
    m = re.match(r"^(.*?)\|tee\s+(\S+)$", cmd.strip())
    outfile = None
    if m:
        cmd, outfile = m.group(1).strip(), m.group(2)

    def read(path):
        try:
            with open(_resolve(path), "r", errors="replace") as fh:
                return fh.read()
        except OSError as e:
            return "<%s>" % e

    if cmd == "id":
        out = "uid=33(www-data) gid=33(www-data) groups=33(www-data)\n"
    elif cmd in ("dir /", "dir", "ls /"):
        out = "  ".join(sorted(FAKE_ROOT_ENTRIES)) + "\n"
    elif cmd.startswith("nl "):
        p = cmd[3:].strip()
        body = read(p)
        out = "".join("%6d\t%s\n" % (i + 1, l) for i, l in enumerate(body.splitlines()))
    elif cmd.startswith("od ") or cmd.startswith("strings ") or cmd.startswith("tail "):
        out = read(cmd.split(None, 1)[1].strip())
    elif cmd.startswith("grep "):
        parts = cmd.split()
        pat, p = parts[1], parts[-1]
        out = "".join(l + "\n" for l in read(p).splitlines() if pat in l)
    elif cmd.startswith("find"):
        out = "".join(os.path.join(dp, n).replace(FAKE_ROOT, "") + "\n"
                      for dp, _, ns in os.walk(FAKE_ROOT) for n in ns)
    else:
        out = "<mock sh: unhandled payload %r>\n" % cmd

    if outfile:
        with open(os.path.join(cwd, outfile), "w") as fh:
            fh.write(out)
    return out


BODY = """<code><span style="color: #000000">
&lt;?php<br />highlight_file(__FILE__);<br />if(isset($_GET['url'])) { ... exec($url); ... }
</span>
</code>"""


def make_handler():
    class Mock(SimpleHTTPRequestHandler):
        def do_GET(self):                                   # noqa: N802
            if self.path.startswith("/?url="):
                from urllib.parse import unquote, parse_qs
                cmd = parse_qs(self.path[2:]).get("url", [""])[0]
                if BLACKLIST.search(cmd):
                    msg = BAD_STR
                else:
                    msg = OK_STR
                    sh(cmd, ROOT)                           # php cwd == webroot
                data = (BODY + msg).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            elif self.path.startswith("/?"):
                data = BODY.encode()
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            else:
                super().do_GET()

        def translate_path(self, path):
            return os.path.join(ROOT, path.lstrip("/").split("?")[0])

        def log_message(self, *a):                          # keep the transcript clean
            pass

    return Mock


if __name__ == "__main__":
    build_root()
    srv = ThreadingHTTPServer(("127.0.0.1", 8899), make_handler())
    print("mock vulnerable target: http://127.0.0.1:8899/  root=%s" % ROOT)
    srv.serve_forever()

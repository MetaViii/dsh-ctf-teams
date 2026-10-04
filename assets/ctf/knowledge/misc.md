# Misc Playbook

The grab-bag lane: encoding towers, OSINT, esoteric formats, puzzle logic.

## Encoding towers

```python
import base64, codecs, re
data = open('blob.bin','rb').read()
while True:
    try: data = base64.b64decode(data)          # also try b32/b85/a85
    except Exception: break
# ROT13/all-Caesar: codecs.decode(s, 'rot13'); braces in text hint at shift
```

- Repeated `=` padding, hex-look, and ` -----BEGIN ` PEM wrappers are the
  usual suspects. Nested base64 up to 20 deep happens — script the loop.
- Text that decodes to printable-but-gibberish: try ROT13 first, then Vigenere.

## OSINT

- Reverse image search is blocked offline → try EXIF first (`exiftool -a`):
  GPS, camera, embedded thumbnails, software tags.
- Usernames: check consistency across platforms manually with curl HEAD
  requests to the obvious profile URLs; the flag is usually in a profile
  field, a commit, or a cached page.
- GitHub recon: `curl -s https://api.github.com/users/<u>/events/public`,
  gists, deleted-but-cached commits, issues. Search code for the flag format
  via the API, not the web UI.

## File-format oddities

- QR codes: `zbarimg -q image.png`; partial QR → decode error-correction
  blocks manually, or rebuild from data modules with `quirc`/python `qrcode`.
- MIDI/audio beeps: `minimodem`, or map note events to ASCII
  (`midocs`-style, note deltas as bits).
- Excel/ZIP confusion: `unzip -l` an .xlsx and read `xl/sharedStrings.xml`.
- PDFs: `pdfid`, `pdftotext`, object streams (`qpdf --qdf --object-streams=disable`).
- Font files, .pcapng custom blocks, game save formats: find the structure by
  hex-diffing two "known" files from the challenge.

## Esolangs / puzzles

- Brainfuck/JSF*ck/Whitespace: an online-interpreter's semantics in 20 lines
  of python — write it, don't hand-run.
- Programming "do X in N seconds" servers: pwntools loop + sympy/z3 for the
  arithmetic; cache the connection (don't reconnect per question).

## Practical rules

- Misc rewards "look at the actual bytes" — hexdump before theorizing.
- If a puzzle is deterministic, script it; if it is a tower of encodings,
  loop-decode until stable and record every layer for the writeup.

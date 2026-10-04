# Forensics Playbook

Order: identify the container → carve/extract → inspect metadata → only then
go manual.

## First 60 seconds

```bash
file *; binwalk -e suspicious.pcapng 2>/dev/null
exiftool image.jpg
strings -n 6 dump.bin | grep -iE 'flag\{|ctf'
xxd file | head    # magic bytes never lie; file(1) can
```

## PCAP

```bash
tshark -r traffic.pcapng -q -z conv,tcp         # conversations overview
tshark -r traffic.pcapng -Y http -T fields -e http.request.full_uri | sort -u
tshark -r traffic.pcapng --export-objects http,http_out
tshark -r traffic.pcapng -Y "usb.capdata" -T fields -e usb.capdata  # USB HID
tshark -r traffic.pcapng -z follow,tcp,ascii,<stream#>
```

- USB keystrokes: extract `usb.capdata`/`hiddata`, map HID scancodes in
  python (keymap table, 30 lines).
- USB mouse: plot coordinate deltas into an image (matplotlib) — flags get drawn.
- Exfil in DNS: `dns.qry.name` length/base32 chunks; reassemble.
- WiFi: `aircrack-ng cap.pcap -w wordlist` first if WPA-protected.

## Disk / archive

- `mount -o ro,loop disk.img /mnt` or `7z x disk.img` for FAT/NTFS extracts.
- Deleted files: `foremost`/`photorec`; ext: `extundelete`; NTFS: `ntfs-3g`
  + `$MFT` parsing (`MFTECmd`-style tools).
- Steganography-in-archive trick: check for appended data after EOZIPNG IEND:
  `binwalk`, or split at the trailer and inspect the tail.
- Encrypted zip: `fcrackzip -u -D -p rockyou.txt`, or use the known-plaintext
  (`bkcrack`) attack when one plaintext is known.

## Stego

- LSB: python PIL loop over channels/bits; `zsteg png` does this in one shot.
- `steghide extract -sf img.jpg -p <pass>` (`stegseek --crack` for brute);
  passwords are often the challenge name, filename, or description word.
- Spectrogram (`ffmpeg -i audio.mp3 -lavfi showspectrumpic out.png`) for
  hidden-in-frequency flags; `minimodem -f audio.wav -r 300` for modem data.
- Metadata: `exiftool -a -u -g1 file` (all groups), PNG chunks
  (`pngcheck -v`), trailing bytes after IEND.

## Memory

Use the `volatility3` topic — do not grep a 2GB dump by hand before trying
the plugins.

## Practical rules

- Carve first, read later: most "huge file" challenges hide a small embedded
  artifact (image/zip/pdf) that answers the whole challenge.
- Note the file hashes (`sha256sum`) and which tool extracted what — the
  writeup needs a reproducible chain.

# Forensics Playbook

Order: identify the container → carve/extract → inspect metadata → only then
go manual.

## OLE2 旧版 Word `.doc`

先确认容器：ZIP/XML 的 `.docx` 与 OLE2 `.doc` 不能共用解析路径。
优先使用可用的 `antiword`、`catdoc` 或隔离的 LibreOffice 转换；失败后再用
`olefile` 列流，检查 `WordDocument`、FIB 标志、`0Table` / `1Table`、加密与版本。

现代二进制 DOC 的正文可能由 CLX / PlcPcd piece table 分段引用，不能把
`WordDocument[fcMin:fcMac]` 一律当 UTF-16LE 连续正文。按 FIB 的
`fWhichTblStm` 选择表流，从对应版本的 `fcClx/lcbClx` 定位 CLX，校验 CP 单调性、
PCD 数量及流边界后，按每段压缩标志解码。压缩段需从编码的 `FcCompressed`
去掉标志并按规范处理偏移（压缩时除以 2）；单字节文本的字符映射不能一律假定 UTF-8。
未压缩段按 UTF-16LE 和该段字符数读取，注意正文与其他子文档的 CP 范围。

这是定位与诊断路线，不是适配所有年代、损坏或加密 DOC 的通用解析器。
参见微软 [MS-DOC 文本提取规范](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/01d5d8c4-cf9c-4ef9-80fd-439e763cfe01)。

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

"""Synthetic functional probes; no real challenge, network target or credentials."""
import importlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import traceback

report = dict(checks={}, commands={}, python_modules={}, failures=[])


def check(name, function):
    try:
        function()
        report['checks'][name] = True
    except Exception as exc:
        report['checks'][name] = False
        report['failures'].append(dict(check=name, error=str(exc), trace=traceback.format_exc()[-2000:]))


def run(argv, timeout=30):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise ValueError(str(argv)+': '+result.stderr[-2000:]+result.stdout[-1000:])
    return result.stdout+result.stderr


def module(name):
    mod = importlib.import_module(name)
    report['python_modules'][name] = str(getattr(mod, '__version__', 'imported'))


for name in ['pwn', 'Crypto', 'Cryptodome', 'cryptography', 'z3', 'sympy', 'gmpy2', 'capstone', 'unicorn', 'elftools', 'pefile', 'lief', 'angr', 'requests', 'httpx', 'aiohttp', 'PIL', 'numpy', 'scipy', 'cv2', 'scapy.all', 'dpkt', 'yara', 'volatility3', 'py7zr', 'fpylll', 'pytesseract']:
    check('import:'+name, lambda name=name: module(name))

commands = dict(bash=['--version'], python3=['--version'], sage=['--version'], node=['--version'], npm=['--version'], php=['--version'], java=['-version'], gcc=['--version'], gdb=['--version'], nmap=['--version'], sqlmap=['--version'], ffuf=['-V'], gobuster=['version'], nuclei=['-version'], nikto=['-Version'], jadx=['--version'], apktool=['--version'], upx=['--version'], tshark=['--version'], ffmpeg=['-version'], tesseract=['--version'], exiftool=['-ver'], pngcheck=['-h'], sqlite3=['--version'], ROPgadget=['--version'], ropper=['--version'], one_gadget=['--version'], **{'7z':['i']})
for name, flags in commands.items():
    def version(name=name, flags=flags):
        if not shutil.which(name):
            raise ValueError('command missing: '+name)
        result = subprocess.run([name]+flags, capture_output=True, text=True, timeout=15)
        output = (result.stdout+result.stderr).strip()
        if not output:
            raise ValueError('command did not produce a version/help result')
        report['commands'][name] = dict(path=shutil.which(name), exit_code=result.returncode, version=output[:240])
        if result.returncode != 0:
            raise ValueError('command could not start: '+output[-1600:])
    check('command:'+name, version)


def crypto():
    from Crypto.Cipher import AES
    from Cryptodome.Cipher import AES as AESX
    data, key = bytes(range(16)), bytes(range(16))
    assert AES.new(key, AES.MODE_ECB).decrypt(AES.new(key, AES.MODE_ECB).encrypt(data)) == data
    assert AESX.new(key, AESX.MODE_ECB).encrypt(data) == AES.new(key, AES.MODE_ECB).encrypt(data)
    import z3
    x = z3.Int('x'); solver = z3.Solver(); solver.add(x*3 == 21); assert solver.check() == z3.sat and solver.model()[x].as_long() == 7
    import gmpy2
    assert gmpy2.invert(3, 7) == 5
    from sympy import factorint
    assert factorint(77) == {7:1, 11:1}
    from fpylll import IntegerMatrix, LLL
    assert LLL.reduction(IntegerMatrix.from_matrix([[1,1],[1,0]])).nrows == 2


def binary():
    from capstone import Cs, CS_ARCH_X86, CS_MODE_64
    assert list(Cs(CS_ARCH_X86, CS_MODE_64).disasm(b'\x90', 0))[0].mnemonic == 'nop'
    from unicorn import Uc, UC_ARCH_X86, UC_MODE_64
    from unicorn.x86_const import UC_X86_REG_EAX
    emulator=Uc(UC_ARCH_X86, UC_MODE_64); emulator.mem_map(0x1000,4096); emulator.mem_write(0x1000,b'\xb8\x2a\x00\x00\x00');emulator.emu_start(0x1000,0x1005);assert emulator.reg_read(UC_X86_REG_EAX)==42
    Path('probe.c').write_text('#include <stdio.h>\nint main(){puts("CTF_BINARY_OK");return 0;}\n')
    run(['gcc','-g','-no-pie','probe.c','-o','probe-elf'])
    assert 'CTF_BINARY_OK' in run(['./probe-elf'])
    assert 'CTF_BINARY_OK' in run(['gdb','--batch','-ex','run','./probe-elf'])
    import angr
    project=angr.Project('probe-elf',auto_load_libs=False); assert project.arch.bits==64


def forensics():
    from scapy.all import IP, TCP, wrpcap
    wrpcap('probe.pcap', IP(dst='127.0.0.1')/TCP(dport=31337))
    assert '31337' in run(['tshark','-r','probe.pcap','-T','fields','-e','tcp.dstport'])
    import yara
    assert yara.compile(source='rule ctf { strings: $a="CTF_TEST" condition: $a }').match(data=b'CTF_TEST')
    from volatility3.framework import contexts
    assert contexts.Context() is not None


def image():
    import qrcode
    from PIL import Image, ImageDraw, ImageFont
    from pyzbar.pyzbar import decode
    qrcode.make('CTF_RUNTIME_QR').save('probe-qr.png')
    assert decode(Image.open('probe-qr.png'))[0].data==b'CTF_RUNTIME_QR'
    im=Image.new('RGB',(500,100),'white'); draw=ImageDraw.Draw(im);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',48);draw.text((10,10),'CTF123',fill='black',font=font);im.save('probe-ocr.png')
    ocr=json.loads(run(['python3','/opt/ctf-teams/image_to_text.py','--workspace','/work','--image','probe-ocr.png','--action','ocr']))
    assert any('CTF123' in item['text'] for item in ocr['candidates'])
    qr=json.loads(run(['python3','/opt/ctf-teams/image_to_text.py','--workspace','/work','--image','probe-qr.png','--action','decode']))
    assert any(item['text']=='CTF_RUNTIME_QR' for item in qr['candidates'])


check('functional:crypto_and_lattices',crypto)
check('functional:binary_compile_emulate_debug',binary)
check('functional:pcap_yara_volatility',forensics)
check('functional:qr_and_ocr',image)
def identity():
    import pwd
    assert os.getuid()!=0 and pwd.getpwuid(os.getuid()).pw_name
    try:
        Path('/var/lib/ctf-teams/jobs').iterdir().__next__()
    except PermissionError:
        return
    raise ValueError('worker can read protected control records')
check('functional:unprivileged_worker_control_isolation',identity)
check('functional:sage',lambda: run(['sage','-c','assert GF(17)(3)^3 == GF(17)(10); assert matrix(ZZ,[[1,2],[3,4]]).det() == -2; print("SAGE_OK")'],60))
check('functional:node',lambda: run(['node','-e','const assert=require("node:assert/strict");assert.equal(Buffer.from("Y3Rm","base64").toString(),"ctf");console.log("NODE_OK")']))
check('functional:php',lambda: run(['php','-r','if(base64_decode("Y3Rm")!=="ctf"){exit(1);} echo "PHP_OK";']))
report['passed']=not report['failures']
Path('toolchain-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report))
raise SystemExit(0 if report['passed'] else 1)

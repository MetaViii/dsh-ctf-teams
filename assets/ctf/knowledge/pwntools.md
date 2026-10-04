# pwntools

Python framework for exploit development and process/network I/O. Import as
`from pwn import *`.

## Process and network I/O

```python
from pwn import *
context.arch = 'amd64'            # or 'i386', 'arm', 'aarch64', 'mips'
context.log_level = 'debug'       # see every byte on the wire

io = process('./chall')                     # local
io = remote('chal.example.com', 9000)       # remote
io = process(['qemu-aarch64', '-L', '/usr/aarch64-linux-gnu', './chall'])  # foreign arch

io.send(b'x'); io.sendline(b'x')
io.recvuntil(b'Name: '); io.recvline(); io.recv(0x40)
io.sendafter(b'?', payload)       # sync point
io.interactive()                  # hand over to your terminal (shells)
```

## Offsets and format strings

```python
cyclic(200), cyclic_find(0x6161616c)        # crash offset in two lines
fmtstr_payload(6, {elf.got['printf']: elf.symbols['system']})  # x86/i386 fmt writes
```

## ELF and gadget work

```python
elf = ELF('./chall'); libc = ELF('./libc.so.6', checksec=False)
elf.got['puts'], libc.symbols['system'], next(libc.search(b'/bin/sh\x00'))
ROP(elf).call('system', [next(elf.search(b'/bin/sh\x00'))])
rop = ROP(libc); rop.raw(r.ret); rop.call(rdi_ret, [binsh]); rop.call('system', [0])
```

`one_gadget ./libc.so.6` on the command line often beats a full chain.

## shellcraft

```python
asm(shellcraft.sh())                # execve("/bin/sh")
asm(shellcraft.cat('flag.txt'))     # no shell needed
asm(shellcraft.amd64.linux.sh(), os='linux')
```

## GDB under pwntools

```python
gdb.debug('./chall', gdbscript='b *main+0x64\nc')
io.pid  # attach your own gdb -p if the terminal is already set up
```

`context.terminal = ['tmux', 'splitw', '-h']` makes gdb.debug open in a pane.

## Practical rules

- Set `context.arch`/`context.log_level` first; a silent wrong-arch costs rounds.
- For libc leaks, leak once, compute `libc.address = leak - libc.symbols['puts']`,
  then rebuild the payload — `elf/libc` symbol lookups adjust automatically.
- `p64()/u64()` pack integers; `p64(x, endianness='little')` is the default.
- Keep the exploit in `solve.py` in the workspace with the exact remote target
  at the top so the writeup can replay it.

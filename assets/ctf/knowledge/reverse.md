# Reverse Playbook

## 1. Identify before you open a decompiler

```bash
file ./bin; strings -n 8 ./bin | head -50
checksec ./bin 2>/dev/null; readelf -h ./bin | grep -i type
```

- .NET → `ilspycmd`/dnSpy; Go → go-decompiler care, string blobs are packed
  (`strings -n 6` + `gopclntab`); Rust → demangle (`rustfilt`); PyInstaller →
  `pyinstxtractor` then decompile the `.pyc` (`decompyle3`/`pycdc`);
  packed UPX → `upx -d`; Java/Android → `jadx-gui` / `apktool d`.

## 2. Static ladder

1. `main` → look for the input check: `cmp`, constant arrays, XOR loops.
2. Ghidra headless for speed:
   `analyzeHeadless ./proj -import bin -postScript DecompileAll.java`.
3. Flags hide in: `strings`, `.rodata`, resource sections, xor-with-input
   loops (patch the compare and run), or derived from the input itself.
4. Anti-debug (`ptrace`, `IsDebuggerPresent`, timing): patch the branch or
   `set follow-fork-mode`/LD_PRELOAD fake.

## 3. Dynamic ladder

```bash
gdb ./bin
  b *0x401234        # breakpoint at the compare
  r < input.txt
  x/s $rdi           # inspect buffers
ltrace ./bin          # library calls tell you the algorithm shape
strace ./bin          # syscalls: file access, ptrace checks
```

- Symmetric checks: run with a crafted input, dump the transformed buffer,
  invert the transform (many "encrypt the flag" challenges leak the routine
  output for a known plaintext).
- Constraint-style checks (byte-by-byte compare with timing or error
  messages): brute per-byte — 256 tries max per position, not 256^len.

## 4. VM / custom bytecode

- Find the dispatch loop (`switch` on opcode), dump the program bytes,
  write a disassembler in python (20 lines), then either emulate with unicorn
  (`uc.emu_start`) or solve symbolically with z3 by translating opcodes to
  constraints. Do NOT hand-trace more than ~20 instructions before
  automating.

## 5. Practical rules

- Patch-and-run (`check password` → `bypass check`) is a legitimate solve
  when the flag is printed locally; note the patched bytes for the writeup.
- Foreign arch: `qemu-user -g 1234 ./bin` + `gdb-multiarch -ex 'target remote :1234'`.
- If the binary talks to a server (remote RE), capture the protocol with
  strace/pwntools first — the check may run server-side and the binary is
  just a client stub.

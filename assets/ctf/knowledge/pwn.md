# Pwn Playbook

## 0. Triage (do this before anything else)

```bash
checksec --file=./chall        # or pwn checksec ./chall
file ./chall; ./chall          # run it once, watch the menu
strings ./chall | grep -iE 'flag|/bin|sh'
```

Protections decide the attack class:

| Protection | Implication |
|---|---|
| NX enabled | no shellcode on stack → ROP/ret2libc |
| Canary | leak it or overwrite less (fmt string, partial write) |
| PIE | leak a code pointer; partial overwrite still works (12 bits fixed) |
| RELRO partial | GOT overwrite lives |
| Full RELRO | target .data/exit handlers/stack instead |

## 1. Stack

- Offset: `cyclic(200)` crash → `cyclic_find($rsp)` in gdb, or decompile and count.
- ret2win: find the win function, account for `movaps` alignment — pad one
  extra `ret` if you segfault on a `xmm` move.
- ret2libc: leak GOT via puts@plt → `libc.address = leak - offset` →
  second stage with `/bin/sh`. pwntools `ROP` handles the gadget assembly.
- SROP: when `sigreturn` is available and you control `rax` (e.g. `read`
  returns), `SigreturnFrame()` gives a full register set in one shot.
- `ret2csu`/`__libc_csu_init` for gadget-starved i386/amd64 binaries.

## 2. Format string

```python
# leak stack:  %6$p %7$p ... ; find the canary/libc pointer first
# arbitrary write:
fmtstr_payload(offset, {target: value}, write_size='byte')
```

On 64-bit, addresses land in args 6+; put the address after the format spec
or use `%hn` two-byte writes to stay short.

## 3. Heap

- Identify allocator behavior: tcache poisoning (glibc 2.26+): free two
  chunks, overwrite `fd` → malloc returns target. glibc 2.32+ mangles
  pointers: `fd ^ (addr >> 12)`.
- Double free: tcache `key` field check (2.29+), fastbin dup for older.
- House of Force is dead on modern glibc; prefer tcache/fastbin tricks,
  unsorted-bin leak, or off-by-one `prev_size` (unsafe unlink variants).
- `heap_buf = malloc(...)` menu challenges: script the menu with pwntools and
  keep a `heapview` habit — `vis_heap_chunks` in pwndbg.

## 4. Kernel / seccomp sandboxes

- `seccomp-tools dump ./chall` — read the filter; if `open/read/write` are
  allowed but `execve` is not: use `SROP`+`open`+`read`+`write` ROP or
  `shellcraft.openat` chains to read the flag file directly.
- orw shellcraft: `shellcraft.cat('flag.txt')` already does open+send.

## 5. Practical rules

- Work against the *local* binary first; only flip to `remote()` when the
  local path is proven — then keep both targets in `solve.py` with a flag.
- Environment differences (libc version!) break remote exploits: check
  `LibcSearcher`/libc-database by leak tail, or the challenge-provided libc.
- The exploit that prints the flag beats the exploit that pops a shell —
  when unsure, aim the chain at `open/read/write` of `flag*` paths.

# SageMath for CTF crypto

Sage (`sage`, or `sage-python`) is the tool when plain Python crypto libs hit
a wall: elliptic curves, lattices, polynomial rings, number theory.
`ctf_teams_env` reports whether sage is installed; it is a heavy, manual
install (`apt install sagemath`, conda-forge, or `pip install
sagemath-standard`) — the tool prints the exact path instead of running it.

## RSA essentials

```python
# sage
n = ZZ(n); e = 65537; c = ZZ(c)
phi = (p-1)*(q-1)                      # when p,q are known
d = inverse_mod(e, phi)
m = power_mod(c, d, n)
print(int(m).to_bytes((int(m).bit_length()+7)//8, 'big'))
```

- Small `e` and short `m`: `iroot(ZZ(c), e)` (cube root attack with no padding).
- Hastad broadcast: CRT the ciphertexts, then `iroot(crt, e)`.
- Common modulus: `xgcd(e1, e2)` → combine `c1^a * c2^b mod n`.
- Wiener (small `d`): continued fraction of `e/n`; or use `sage`'s
  `continued_fraction(e/n).convergents()`.
- Close primes: `isqrt(n)` + Fermat two-square iteration.

## Lattices (LLL)

```python
M = Matrix(ZZ, rows)
M.LLL()                                # knapsack, stereotyped messages, ECDSA nonce bias
```

Stereotyped message `m = known + unknown` with small `e`:

```python
P.<x> = PolynomialRing(Zmod(n))
f = (known + x)^e
f = f.monic()
roots = f.small_roots(X=2^128)         # Coppersmith
```

## Elliptic curves

```python
E = EllipticCurve(GF(p), [a, b])
G = E(x, y); Q = k*G                   # scalar mult
P.order(), E.order()                   # group orders
E.gens(), discrete_log(Q, G, order)    # small-order DLP
```

Smart's attack (anomalous curves, `E.order() == p`) and singular-curve
transfers are both short sage scripts — search "smart attack sage ctf" shape:
`P = (Qp(p), E.lift_x(...))` style; write it fresh rather than trusting memory.

## z3 for constraint sets

```python
from z3 import *
s = Solver()
x = BitVec('x', 32); s.add(x * 0x41 == 0xdeadbeef)
s.check(); s.model()
```

z3 lives in plain python3 too; use sage only when number-theory types help.

## Practical rules

- Convert everything with `ZZ()`, `GF(p)`, `Zmod(n)` — silent int/Integer
  confusion is the #1 sage time sink.
- `int(m).to_bytes(...)` to turn integers back into the flag.
- `factor(n)` tries hard but check factordb first for known n.
- Keep the `.sage` script (or `sage-python` script) in the workspace for the writeup.

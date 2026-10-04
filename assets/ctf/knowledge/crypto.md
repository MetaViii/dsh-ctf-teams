# Crypto Playbook

Identify the shape first — the numbers tell you the attack.

## RSA (n, e, c[, p, q, dp, ...])

- `n` small (< 2^300) → factor: `factordb`, `yafu`, `sage: factor(n)`.
- `e=3` and short `m` → cube root: `iroot(c, 3)`; with padding → Coppersmith
  (`small_roots`).
- Many ciphertexts, same `e` → Hastad broadcast (CRT + e-th root).
- Two keys sharing a prime → `gcd(n1, n2)`.
- Wiener: `d` small (`e` huge) → continued fractions; Boneh-Durfee if Wiener fails.
- `dp`/`dq` leaked → partial-key recovery formulas (solve `e*dp ≡ 1 mod (p-1)`).
- Known high bits of `p` → Coppersmith on the missing low bits.
- Textbook RSA malleability: `c' = c * r^e mod n` oracle games.

## Symmetric (AES/DES/RC4/ChaCha)

- ECB on images/structured data → pattern leak, cut-and-paste blocks.
- CBC bit-flipping: flip plaintext bytes by XORing the previous block; keep
  the padding oracle math separate from the payload math.
- Padding oracle (server tells you pad-valid vs invalid): byte-by-byte
  recovery — script it, ~256 requests per byte.
- Reused nonce/keystream → XOR ciphertexts (`key = c1 ^ m1 ^ c2` guessing);
  many-time-pad with crib dragging.
- Weak PRNG (`random.seed(time)`, `rand()` LCG): recover the seed/state first
  (z3 or symbolic LCG inversion), then predict.

## Classical / encoding

- XOR: `xortool`, repeated-key length via Hamming distance (like cryptopals).
- Substitution/Vigenère: frequency analysis; `quipqiup`-style solvers offline.
- Base64/hex/nested: loop-decode until entropy looks right (`chardet`,
  printable-ratio check).
- RSA-in-disguise (modulus hidden in PKCS#1 files): `openssl rsa -pubin -text -noout`.

## ECC / DLP

- Small-order curve / smooth order → Pohlig-Hellman (`discrete_log` with
  order factorization).
- Anomalous curve (`#E == p`) → Smart's attack.
- Singular curve → transfer to additive/multiplicative group.
- Invalid-curve points accepted → send small-order point to leak `d` mod r.

## Hashes

- Length extension (MD4/5, SHA1/2 with `hashpumpy`): forge
  `append(data)` without the secret.
- Collision challenges: fast MD5/SHA1 collisions from shattered/fastcoll.
- `john`/`hashcat` for leaked hashes; `--show` first, maybe it's already cracked.

## Practical rules

- Write the numbers down in the finding (n bits, e, hint presence) — the
  category lane can pick the attack without re-reading the challenge.
- `z3` for anything described as equations; `sage` for anything with
  curves/lattices/modpoly (see `sage-math` topic).
- Confirm the recovered plaintext is the flag *format* before claiming victory.

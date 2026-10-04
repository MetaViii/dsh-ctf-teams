# Web Playbook

Recon → fuzz → exploit. Record every endpoint in a finding so lanes don't
repeat scans.

## 1. Recon

```bash
curl -i http://host:port/                       # headers, cookies, server banner
whatweb http://host:port
ffuf -u http://host:port/FUZZ -w /usr/share/seclists/Discovery/Web-Content/raft-medium-words.txt -mc 200,301,302,403 -t 40 -o ffuf.json
ffuf -u http://host:port/FUZZ -H 'X-Forwarded-For: 127.0.0.1' -mc 200   # header bypass sweeps
```

- Read the JS: `grep -oE '"/[a-z0-9_/.-]+"' app.js | sort -u` finds hidden routes/APIs.
- Check `/robots.txt`, `/.git/HEAD`, `/.env`, `/backup.zip`, source maps.
- Multiple vhosts? try `--header 'Host: admin.host'` or a wordlist sweep.

## 2. Injection classics

- SQLi: parameter-level first (`'`, `' OR 1=1-- -`), then `sqlmap -u URL -p param --batch --threads 4`;
  `--os-shell`/`--file-read` when stacked queries allow.
- SSTI: `{{7*7}}`, `${7*7}`, `<%= 7*7 %>` across every echoed value; Jinja2
  RCE chain: `{{ ''.__class__.__mro__[1].__subclasses__() }}` then pick os.
- PHP: `php://filter/convert.base64-encode/resource=index` (LFI to source),
  `data://`, session upload progress, phar deserialization.
- Deserialization (Java/Python/PHP): identify the magic bytes + gadget chain
  (`ysoserial`, `phpggc`); match the server's library version first.

## 3. Auth and sessions

- JWT: `jwt-tool <token> -C -d wordlist` (weak HMAC), alg confusion
  (`-X a` with the public key), `kid` injection.
- Cookies that look like base64 → decode, re-serialize (flask: `flask-unsign --sign --secret`).
- IDs: sequential/hash-looking → test horizontal access on other ids.

## 4. SSRF / request smuggling / XXE

- SSRF: point URL params at `http://127.0.0.1:PORT`, `file:///`, cloud
  metadata (`169.254.169.254`); gopher:// for arbitrary TCP.
- XXE: `<!ENTITY xxe SYSTEM "file:///flag">` with a DOCTYPE; blind → OOB via
  your own HTTP listener or DNS.
- Upload: extension double-bypass (`shell.phtml`, trailing dot, `%00`),
  content-type/`GIF89a` magic, `.htaccess`/`.user.ini` drops.

## 5. Practical rules

- Proxy through one place and keep the request that worked in a file.
- Automated scanners (`nuclei -u URL`) are recon, not a solve — read their hits.
- When a filter blocks you, enumerate *what* is blocked with a finding
  (e.g. "spaces blocked; ${IFS} works") before brute-forcing blindly.
- Bot challenges (admin visits your URL): host your payload, log the request
  (`python3 -m http.server 8000` or webhooks), test cookie exfil first.

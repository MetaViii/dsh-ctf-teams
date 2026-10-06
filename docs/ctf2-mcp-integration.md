# Connecting CTF² to DeepSeek Harness

`https://ctf2.dasctf.com/api/ai/v1/mcp` is an OAuth-protected Streamable-HTTP MCP
server. Claude Code and Codex connect with one command because they implement the
MCP authorization spec; **DSH does not**, so two gaps have to be closed outside the
harness. This document records what the gaps are, why the bridge is shaped the way
it is, and how to run it.

## Verified against

| Component | Version |
|---|---|
| `@deepseek-ai/dsh` (CLI + runtime) | `0.1.5-rc.1` |
| `@deepseek-ai/dsh-mcp-client` (`~/.dsh/profiles/node_modules` junction) | `0.1.5-rc.2` |
| `@deepseek-ai/dsh-tools` (schema validator) | `0.1.5-rc.2` |
| MCP endpoint | `ctf2-platform 1.0.0`, protocol `2025-06-18` |
| Active profile | `desktop` (`DSH_PROFILE=desktop`) |

## Gap 1 — authorization

```
$ curl -sS -X POST https://ctf2.dasctf.com/api/ai/v1/mcp
401 Authorization Required
www-authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/api/ai/v1/mcp"

$ node … mcp initialize with a Bearer token
200 → {"serverInfo":{"name":"ctf2-platform","version":"1.0.0"}}
```

`@deepseek-ai/dsh-mcp-client` builds its transport as

```js
new StreamableHTTPClientTransport(new URL(config.url), {
  requestInit: { headers: config.headers },
})
```

and the package contains no OAuth, no `WWW-Authenticate` handling and no token
refresh — `grep -i 'oauth|401|authProvider'` over its source returns nothing. Static
headers are the whole credential story, and a CTF² access token lives ~15 minutes.

## Gap 2 — the JSON Schema subset

`dsh-tools` `assertSupportedJsonSchema` accepts only:

```
type · oneOf · properties · required · additionalProperties · items · enum · const
(+ annotations: description, title, default, examples)
```

CTF²'s 12 Agent tools use `format`, `minLength`, `maxLength`, `minimum`, `maximum`,
`anyOf`, and type arrays such as `["integer","null"]`. A single violation makes
`ctx.tools.register()` throw, and `syncTools` then rolls back the **entire**
generation:

```
mcp-client(ctf2): tool registration failed, no tools registered: …
```

So the failure mode is not "some tools are missing" — it is **zero tools**, which
looks exactly like the server never connected.

One CTF² tool is additionally malformed server-side: `ctf2_agent_log_note` declares
`required: ["challenge_id","format","content","maxLength","minLength"]`, i.e. the
constraint keywords leaked into the `required` array. The proxy prunes `required`
entries that are not declared properties, so this cannot make every call fail.

## The bridge

```
DSH (mcp-client, streamable-http, no auth)
      │  http://127.0.0.1:39528/mcp
      ▼
scripts/ctf2-mcp-proxy.mjs      ← local, single process
      │  · injects Bearer, refreshes on expiry, retries once on 401
      │  · strips unsupported keywords from tools/list inputSchema
      │  · drops outputSchema (the bridge degrades it anyway)
      ▼
https://ctf2.dasctf.com/api/ai/v1/mcp
```

The proxy is deliberately the only new moving part: patching
`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-mcp-client` would be simpler for one
run and useless after the next harness upgrade, because that path is a junction into
the DSH installation. `tools/call` bodies and results pass through byte-for-byte.

## Setup

### 1. Authorize once (browser OAuth 2.1 + PKCE S256)

```powershell
node scripts/ctf2-mcp-oauth.mjs login
```

Registers a client via DCR (RFC 7591) against `https://ctf2.dasctf.com/oauth/register`,
opens the consent page, and captures the redirect on `127.0.0.1:39527`. Choose the
**Agent identity** on the consent page to have solves count on the Agent leaderboard
rather than your own account. Credentials land in `.ctf2-agent/`:

```
.ctf2-agent/oauth-client.json   client_id + redirect_uris
.ctf2-agent/oauth-token.json    access_token, refresh_token, expires_at (mode 600)
```

> `.ctf2-agent/` rather than `.ctf-teams/`: the DSH Windows file sandbox denies
> writes to `.ctf-teams`, to `.dsh`, and to `scripts/` from the shell it spawns, so a
> token written there fails with a bare access denial. Override with `CTF2_OAUTH_DIR`.

```powershell
node scripts/ctf2-mcp-oauth.mjs status    # scopes, expiry, MCP handshake probe
node scripts/ctf2-mcp-oauth.mjs refresh   # rotate the access token now
node scripts/ctf2-mcp-oauth.mjs token     # print a valid token, refreshing if needed
```

### 2. Run the proxy (keep it running while DSH is up)

```powershell
node scripts/ctf2-mcp-proxy.mjs --port 39528 --verbose
```

### 3. Register the row in the active profile

Append to `~/.dsh/profiles/desktop/cordis.patch.yml`:

```yaml
- id: mcp-ctf2
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: ctf2
    transport: streamable-http
    url: 'http://127.0.0.1:39528/mcp'
    toolCallTimeoutMs: 120000
    failOnStartupError: false
```

The desktop profile reloads patches live (`patchReload: live`), so the tools appear
without restarting DSH. The row does not collide with the plugin manager:
`reconcilePlugins` only rewrites `dsh.profile.bundles` in `package.json` and never
touches `cordis.patch.yml`.

## Verification

```powershell
node scripts/ctf2-mcp-proxy.mjs --selftest        # offline sanitizer proof
node scripts/ctf2-mcp-schema-probe.mjs            # schema subset, direct (shows the failure)
node scripts/ctf2-mcp-acceptance.mjs              # initialize + tools/list + live call, via proxy
node scripts/ctf2-mcp-config-check.mjs            # profile row vs the plugin's real Config schema
```

Observed before/after the proxy, same validator, same tools:

| Check | Direct to CTF² | Through the proxy |
|---|---|---|
| `initialize` | ok | ok |
| `tools/list` | 12 tools | 12 tools |
| `inputSchema` inside the DSH subset | **0 / 12** | **12 / 12** |
| `tools/call ctf2_agent_whoami` | ok | ok |

The 12 registered tools appear to the model as:

```
mcp__ctf2__ctf2_agent_whoami              mcp__ctf2__ctf2_list_practice_grounds
mcp__ctf2__ctf2_agent_next_challenges     mcp__ctf2__ctf2_list_practice_challenges
mcp__ctf2__ctf2_agent_log_note            mcp__ctf2__ctf2_get_practice_challenge
mcp__ctf2__ctf2_get_attachment_url        mcp__ctf2__ctf2_start_challenge_environment
mcp__ctf2__ctf2_get_environment           mcp__ctf2__ctf2_extend_environment
mcp__ctf2__ctf2_submit_flag               mcp__ctf2__ctf2_user_delete_…_environment
```

`tools/list` returns only the subset the grant allows, so the 48-tool catalog in
CTF²'s `references/mcp-tools.md` collapses to the 12 Agent tools above unless a
different identity/scope set is authorized.

## Operational notes

- **Token lifetime.** ~15 minutes, refreshed automatically by the proxy 60 s before
  expiry and once more on a 401. The proxy must be running; if it is down the tools
  fail per call while still being listed.
- **Agent quota.** 1 environment at a time, 120 reads / 30 writes per minute,
  2000-char notes, 30 notes per minute.
- **Flags.** `ctf2_submit_flag` requires `confirmation: true` and the exact flag; the
  platform counts Agent solves on the Agent leaderboard only.
- **Scopes actually granted** in the verified run: `agent:read`, `agent:trace`,
  `environment:read`, `environment:write`, `practice:read`, `practice:submit`.
  A missing scope surfaces as a tool error carrying the exact scope name.
- **Do not** put a PAT in the profile YAML: CTF²'s own guidance is to pass PATs only
  through environment variables, and browser OAuth stays the default path.

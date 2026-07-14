# pesu — the XS chat bridge (B0: the round trip)

`pesu` (Tamil பேசு, "to speak") is a small daemon that binds one XS chat thread
to the **coordinator** — an orchestrator agent running in an ordinary kolu
terminal. You @mention the app (or DM it); your message lands in the
coordinator's terminal prefixed with your name; the coordinator's answer appears
in the thread as one message that grows while it works, with a typing indicator
during the turn.

pesu is an **app-tier sibling of kolu-server**: it imports kolu's packages
(`kaval`, `@kolu/padi`, the transcript loaders), and **nothing imports it**. It
owns no transcript parser of its own — reply text is read through the shipped
loaders (`kolu-claude-code` / `kolu-codex` / `kolu-grok` / `kolu-opencode`),
dispatched on the agent kind padi publishes, so pesu is model-agnostic on day
one.

This is **B0**: single-operator, one coordinator, the round trip. The board (B1)
and the live mirror (B2) build on it. The design of record is the Atlas note
[*kolu under any chat app*](../../docs/atlas/src/content/atlas/chat-native-agents-and-kolu.mdx).

## The turn, end to end

1. XS POSTs a signed event (`APP_MENTIONED` / `DIRECT_MESSAGE`) to pesu's webhook.
2. pesu verifies `X-Xyne-Signature` (HMAC-SHA256, **constant-time**) on the raw
   body **before touching it**, then answers `200` immediately and works async
   (delivery is fire-and-forget — no retries).
3. The sender is resolved via `GET /api/apps/user/info` (cached — DM payloads
   omit even the display name) and checked against the **operator allowlist**. A
   non-operator gets a **one-line visible decline** — never silence, never a
   relayed turn.
4. An operator's message is queued on a **FIFO inbox** — the write floor: **one
   turn in flight, ever**.
5. The turn resolves the coordinator terminal **by title** (kaval re-keys ids
   across restarts; titles survive), writes the attributed prompt in
   (`from <name>: …`) as a bracketed paste — settle, snapshot-verify, then a
   **separate** Enter (a same-breath Enter races the paste debounce and is
   dropped) — and turns the typing indicator on.
6. As the coordinator's reply grows in its transcript, pesu reads the new
   assistant text through the loaders and posts one message, then `updateMessage`s
   it at a **civil cadence (≤1/s)** so the thread shows one growing reply. The
   turn ends when padi's agent-state bucket flips to `awaiting`/`waiting`.
7. Replies over XS's **40,000-character** cap are split across messages. **A
   fault posts as a visible reply — never silence.**

## Configuration (environment only)

Secrets reach pesu **only as environment variables** — never the repo, the PR,
logs, or an agent transcript. pesu **fails fast at boot** if any required var is
absent (no fallback, no degraded mode).

| Variable | Required | Default | Meaning |
| --- | --- | --- | --- |
| `PESU_SIGNING_SECRET` | ✅ | — | XS app signing secret — verifies inbound signatures **and** signs the bearer JWT (one secret, both directions). |
| `PESU_JWT_TOKEN` | ✅ | — | XS app bearer token (JWT, HS256, no expiry) for the outbound app API. |
| `XYNE_BASE_URL` | ✅ | — | Base URL of the XS instance (e.g. `https://xs.example.com`). |
| `PESU_OPERATOR_ALLOWLIST` | ✅ | — | Comma-separated operator **emails** (case-insensitive). B0 is single-operator; widening it is a config edit, not a code change (attribution is already per-sender). |
| `PESU_PORT` | — | `8442` | Local port pesu binds on `127.0.0.1` (8443-adjacent; `:8443` is the funnel's public port, `:7692`/`:9010` are taken by existing serves). |
| `PESU_COORDINATOR_TITLE` | — | `RT-fable-main` | The coordinator terminal, resolved by title. **See the caveat below.** |

## Public URL — Tailscale Funnel

pesu binds `127.0.0.1:$PESU_PORT`. The stable public webhook URL is **Tailscale
Funnel** on this host — a stable `https://<host>.<tailnet>.ts.net` hostname with
TLS terminated by `tailscaled`, no extra daemon, surviving restarts, so the URL
registered in XS never changes:

```sh
# Bring the funnel up (public :8443 → local pesu). Reversible.
tailscale funnel --bg --https 8443 http://127.0.0.1:$PESU_PORT
# Tear it down:
tailscale funnel --https 8443 off
```

For this host that is `https://pureintent.rooster-blues.ts.net:8443`. (A
cloudflared **named** tunnel is the fallback if Funnel is unavailable;
quick-tunnels rotate their hostname per run and silently orphan the
registration — don't use those.)

## Deployment — Incus container (documentation only; no container code in B0)

Production intent is to run pesu in an Incus container beside kolu. That implies
these mounts/bindings into the container:

- **The kaval socket dir** — so pesu can drive the coordinator terminal
  (write-in + snapshot). Mount **only the coordinator host's kaval socket dir**:
  pesu requires exactly one resolvable kaval daemon and fails loud if it finds
  several.
- **The padi socket dir** — so pesu can read agent-state buckets (turn-end) and
  the coordinator's live agent record (kind + session).
- **The agent transcript dir, read-only** — the coordinator's on-disk session
  the loaders read (e.g. `~/.claude/projects/…` for a Claude Code coordinator).
  Read-only: pesu never writes it.
- **The environment variables** above (secrets via the container's secret
  mechanism, never baked into an image).
- **The published port** — `127.0.0.1:$PESU_PORT`, fronted by the funnel on the
  host.

## Verification honesty

- **CI-class (shipped green in this PR):** unit + integration tests with
  **synthetic signed events** (real HMAC fixtures; forged-signature rejection
  pinned; allowlist decline pinned; inbox ordering pinned) and the
  postMessage/update flow against a **fake Xyne server** stood up in-test. No
  real XS, no secrets.
- **Live-class (the morning acceptance with srid):** the real round trip — a
  message in the dedicated kolu channel → the coordinator answers — requires srid
  to update the XS app registration to the funnel URL and place the secrets. The
  exact `/api/apps/*` request/response shapes in `xyneApi.ts` are modelled from
  the XS source of record and confirmed against the live server that morning
  (each method names the wire body it assumes, so a mismatch is a one-line fix).

## The coordinator-title flip + the shared-coordinator caveat

`PESU_COORDINATOR_TITLE` selects the terminal pesu binds threads to. For the
morning demo, point it at a **dedicated scratch coordinator** so the round trip
is clean of any concurrent campaign. Pointing it at the **real** running
coordinator afterward is a **one-variable config flip** — no code change — since
the mechanism (title-resolve, real agent, real loaders, real turn-end) is
identical.

**Caveat when pesu shares a busy coordinator:** padi's agent-state buckets are
per-terminal, and a real coordinator serving several implementing agents moves
through `working`/`waiting` for *their* turns too. pesu's own FIFO serializes
*its* write-ins, and turn-end is gated on "this terminal's assistant text grew
since the write-in", but a turn boundary can still blur while siblings are busy.
B0 is correct on a dedicated coordinator; sharing a live multi-agent coordinator
is a known B0 limitation, revisited if it comes to matter.

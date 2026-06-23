# `@kolu/pulam-web`

**A browser view of a fleet of pulam terminals. One Node parent server dials many remote pulam boxes over ssh, re-serves each box's `terminalWorkspaceSurface` to the browser over a per-host WebSocket, and renders a dark monospace list of every terminal across the fleet.**

This is the web companion to `pulam-tui`: where the TUI draws one host's terminals in an alt-screen board, pulam-web draws *all* configured hosts' terminals in a browser, grouped by host. R4.8a (this package's first cut) is read-only — a live terminal list per host, no git status and no drill-in (those are R4.8b).

## The three-tier bridge

```
browser  ─WS oRPC─▶  pulam-web parent  ─stdio oRPC over ssh─▶  remote pulam daemon
```

- The browser opens **one WebSocket per host** at `/rpc/ws?host=<id>`; the upgrade handler dispatches to that host's oRPC handler. Host identity lives ONLY at the transport layer — every host re-serves the *same* `terminalWorkspaceSurface`.
- The parent doesn't define its own surface: it **implements `terminalWorkspaceSurface` locally and bridges every primitive to the remote** (`src/server/reserve.ts`). PUSH primitives (`version`, `awareness`, `activity`) are folded inward by the mirror's sink; PULL / input-parameterized ones (`subscribeRepoChange`/`subscribeFileChange`, `fs.*`, `git.*`) are forwarded to the live remote on demand.
- Per-host reconnect, backoff, and respawn are owned by `@kolu/surface-nix-host` (`HostSession` + `pumpRemoteSurface`), not here.

## What it owns

- **The parent entry** (`src/server/main.ts`): the Hono app, the `/api/hosts` list endpoint, the static client bundle, and the `?host=` WebSocket upgrade dispatch (origin gate → stale-tab gate → heartbeat → handler upgrade).
- **The re-serve** (`src/server/reserve.ts`): the local `implementSurface` fragment that mirrors one remote host's awareness surface to the browser, its `makeSink` (PUSH fold) and live-client/procedure holders (PULL forward).
- **Boot config** (`src/server/config.ts`): the static host set (`PULAM_WEB_HOSTS`), the per-host `.drv` resolver over pulam's baked `{ system → drv }` map (`PULAM_AGENT_DRVS_JSON`), and strict port parsing. Fail-fast at boot, no fallback.
- **The browser client** (`src/client/`): a SolidJS fleet list — one `surfaceClient` per host over a reconnecting `PartySocket`, rendering each host's `awareness` collection.

## What it deliberately does NOT know

- **How a host becomes a session, reconnects, or respawns.** That hard volatility (ssh subprocess lifecycle, Nix provisioning, backoff, the keyed host registry, the reconnect-mirror pump) is `@kolu/surface-nix-host`'s — pulam-web only supplies the surface-specific `makeSink` / `buildEntry` and reads the result. The dependency arrow points *out*.
- **What the awareness surface contains.** The `terminalWorkspaceSurface` contract, its schemas, and `DEFAULT_VERSION` live in `@kolu/terminal-workspace` and are shared verbatim with `pulam`, `pulam-tui`, and the daemon. pulam-web re-serves it; it does not define it.
- **The freshness / PWA / origin-gate mechanics.** Static-bundle freshness (`installFreshStatic`), the ws origin gate, the stale-tab gate, and the heartbeat are `@kolu/surface-app` / `@kolu/surface`; pulam-web wires them, it does not reimplement them.
- **Git status and drill-in** — those primitives are forwarded but unused by the R4.8a UI; the rendered drill-in is R4.8b.

## Coupling

pulam-web sits downstream of three workspace packages and breaks if any of their contracts shift:

| Package | What pulam-web depends on |
| --- | --- |
| `@kolu/terminal-workspace` | the `terminalWorkspaceSurface` contract + schemas re-served to the browser |
| `@kolu/surface-nix-host` | `getHostSession`, `pumpRemoteSurface`, `buildHostRegistry`, `observableHolder`, `ResolveDrvError` |
| `@kolu/surface` / `@kolu/surface-app` | the mirror (`mirrorRemoteSurface`), the Solid client (`surfaceClient`), the server shell (static serving, gates, heartbeat) |

## Run it locally

```sh
PULAM_WEB_HOSTS=nix@box-a,nix@box-b \
PULAM_AGENT_DRVS_JSON="$(nix eval --raw .#pulamAgentDrvsJson)" \
  pnpm dev:server        # the Node parent (default port 4800)

pnpm dev:client          # Vite, proxying /api + /rpc to the backend (default 5800)
```

Both ports honour `PULAM_WEB_PORT` / `PULAM_WEB_CLIENT_PORT`; a malformed value fails fast rather than silently falling back. In production the backend serves the built `dist/` itself.

# `@kolu/pulam-web`

**A browser view of a fleet of pulam terminals. One Node parent server dials many remote pulam boxes over ssh (and reads the *local* machine's kolu directly — no second pulam), re-serves each host's `terminalWorkspaceSurface` to the browser over a per-host WebSocket, and renders a dark monospace agent dashboard — every agent across the fleet, sorted by what needs you.**

This is the multi-host fleet dashboard for pulam: `pulam-tui` is the thin single-daemon `status`/`watch`/`wait` CLI over one pulam, while pulam-web draws the whole fleet across many hosts in a browser. Per host, agents are bucketed and sorted **needs-you-first** — a blocked agent (`awaiting_user`) floats to the top, working agents below, idle ones at the bottom. Every row renders the **same `StatePip` indicator as kolu's Dock** (`@kolu/solid-statepip`, on the shared `@kolu/theme` palette), so a given (state, live, alert) triple shows the identical glyph: the agent-state **core** — a hollow ring spins for working, a dim violet dot for awaiting, a muted dot for idle, a ☾ for a sleeping shell — wrapped by a thin green **live ring** that gently sweeps when the terminal is moving bytes right now, and a small amber **unread corner badge** when a notification has fired you haven't seen (the per-row alert pulam-web gains from the shared `alertClass` fold, beyond the fleet-wide **needs-you strip** that breathes when any agent is blocked). **Every agent shows by default** — active *and* idle — so the board reads as the full set of agents out of the box; only terminals **not** running an agent (a bare foreground process, or a sleeping shell) are hidden, with footer toggles to fold them in. The dashboard reads each host's `awareness` collection (state · repo · branch · recency) and `activity` stream (the live ring) — both already-proven consumers, no surface change. A **Legend** at the bottom of the board explains the indicators — the state shapes, the green live ring, the amber unread badge — drawn from the same `StatePip` the rows use, so it can't drift from them. Still read-only: the per-agent git **dirty/clean count** and the changed-file **drill-in** need `git.getStatus` and are R-pulamweb-4.

## The three-tier bridge

```
browser  ─WS oRPC─▶  pulam-web parent  ─stdio oRPC over ssh─▶  remote pulam daemon
```

- The browser opens **one WebSocket per host** at `/rpc/ws?host=<id>`; the upgrade handler dispatches to that host's oRPC handler. Host identity lives ONLY at the transport layer — every host re-serves the *same* `terminalWorkspaceSurface`.
- The parent doesn't define its own surface: it **implements `terminalWorkspaceSurface` locally and bridges every primitive to the source** (`src/server/reserve.ts`). PUSH primitives (`version`, `awareness`, `activity`) are folded inward by the mirror's sink; PULL / input-parameterized ones (`subscribeRepoChange`/`subscribeFileChange`, `fs.*`, `git.*`) are forwarded to the live source on demand.
- **`localhost` is special — it mirrors the local kolu, not a second pulam (R9a).** Where a remote host runs `pulam --stdio` over ssh, the local machine *already* runs kolu, which serves the same `terminalWorkspaceSurface` cross-process (since R8). So a `localhost` host opens a WebSocket to the running kolu's `/rpc/ws` and mirrors its served awareness into the re-serve (`src/server/localKolu.ts`) — **one sensor (kolu's in-process sink), two readers (kolu's own Dock + this dashboard).** Spawning a pulam on localhost would run a *second* sensor set over the same kaval and drift out of step with the Dock; that desync is exactly what R9a removes.
- Per-host reconnect, backoff, and respawn are owned by `@kolu/surface-nix-host` (`HostSession` + `pumpRemoteSurface`) for ssh hosts. The `localhost` mirror runs its own small reconnect loop (`localKolu.ts`'s `runLocalMirror`, the local-link dual of `pumpRemoteSurface`); the transport it loops over — the reconnecting socket + `system.live` watchdog scoped to kolu's `terminalWorkspace` sibling — comes from `@kolu/terminal-workspace`'s `connectTerminalWorkspace` (the client twin of `serveTerminalWorkspace`), so `localKolu.ts` names no sibling and no `/rpc/ws`. No ssh, no Nix.

## What it owns

- **The parent entry** (`src/server/main.ts`): the Hono app, the `/api/hosts` list endpoint, the dynamic `/manifest.webmanifest` (`installPwaManifest`), the static client bundle, and the `?host=` WebSocket upgrade dispatch (origin gate → stale-tab gate → heartbeat → handler upgrade).
- **The re-serve** (`src/server/reserve.ts`): the local `implementSurface` fragment that mirrors one remote host's awareness surface to the browser, its `makeSink` (PUSH fold) and live-client/procedure holders (PULL forward).
- **Boot config** (`src/server/config.ts`): the static host set (`PULAM_WEB_HOSTS`), the per-host `.drv` resolver over pulam's baked `{ system → drv }` map (`PULAM_AGENT_DRVS_JSON`, needed only when an ssh host is configured), the local kolu URL the `localhost` mirror dials (`PULAM_WEB_KOLU_URL`, default loopback `/rpc/ws`), and strict port parsing. Fail-fast at boot, no fallback.
- **The localhost mirror** (`src/server/localKolu.ts`): for a `localhost`/`127.0.0.1`/`::1` host, the reconnecting WebSocket to the running kolu's `/rpc/ws`, the mirror pump that folds kolu's served `terminalWorkspaceSurface` into the same re-serve the ssh path uses, and the connection-health the dashboard reads — so no second pulam is spawned for the local box.
- **The browser client** (`src/client/`): the SolidJS agent dashboard — one `surfaceClient` per host over a reconnecting `PartySocket`. `fleet.ts` is the pure projection (bucket · needs-you-first sort · recency · the shared `@kolu/theme` colour tokens · the `pipVariantFor` → `StatePip` mapping, pinned by `fleet.test.ts`); `HostGroup.tsx` consumes each host's `awareness` collection + `activity` stream (the green dot) and renders the sorted/filtered rows fine-grained, each agent's status drawn by the shared `StatePip` (`@kolu/solid-statepip`, the same component kolu's Dock renders); `App.tsx` owns the view filters, the shared 1s clock, and the fleet-wide "needs you" strip.

## What it deliberately does NOT know

- **How an ssh host becomes a session, reconnects, or respawns.** That hard volatility (ssh subprocess lifecycle, Nix provisioning, backoff, the keyed host registry, the reconnect-mirror pump) is `@kolu/surface-nix-host`'s — pulam-web only supplies the surface-specific `makeSink` / `buildEntry` and reads the result. The dependency arrow points *out*. (The `localhost` mirror's *loop* is pulam-web's — `localKolu.ts` — but how to reach a kolu-served `terminalWorkspaceSurface` is `@kolu/terminal-workspace`'s `connectTerminalWorkspace`, so the sibling key, the `/rpc/ws` path, and the no-Origin/no-pid posture live at the surface's home, not here.)
- **What the awareness surface contains.** The `terminalWorkspaceSurface` contract, its schemas, and `DEFAULT_VERSION` live in `@kolu/terminal-workspace` and are shared verbatim with `pulam`, `pulam-tui`, and the daemon. pulam-web re-serves it; it does not define it.
- **The freshness / PWA / origin-gate mechanics.** Static-bundle freshness (`installFreshStatic`), the dynamic manifest (`installPwaManifest`), the fetch-less notification worker (`registerServiceWorker`), the ws origin gate, the stale-tab gate, and the heartbeat are `@kolu/surface-app` / `@kolu/surface`; pulam-web *wires* them into an installable PWA (manifest + icons + worker, the kolu twin) — it does not reimplement them. It deliberately does NOT add the `surfaceApp()` Vite commit-stamp plugin: that feeds kolu's client-staleness update prompt, which pulam-web doesn't render.
- **Git status and the drill-in** — the `git.*` procedures are forwarded but the dashboard doesn't consume them yet. The awareness `git` info carries only `repoName`/`branch` (no file counts), so the per-agent dirty/clean count and the changed-file drill-in — both needing `git.getStatus` — are R-pulamweb-4.

## Coupling

pulam-web sits downstream of these workspace packages and breaks if any of their contracts shift — the transport/contract core, plus the shared UI/theme it renders the fleet in:

| Package | What pulam-web depends on |
| --- | --- |
| `@kolu/terminal-workspace` | the `terminalWorkspaceSurface` contract + schemas re-served to the browser, **and** `connectTerminalWorkspace` (the client twin) the `localhost` mirror dials kolu with — so the sibling key + `/rpc/ws` + posture live there, not here |
| `@kolu/surface-nix-host` | `getHostSession`, `pumpRemoteSurface`, `mirrorOnce`, `buildHostRegistry`, `isLocalHost`, `LiveSpawnHolder`, `ResolveDrvError` |
| `@kolu/surface` / `@kolu/surface-app` | the mirror (`mirrorRemoteSurface`), the Solid client (`surfaceClient`), the server shell (static serving, gates, heartbeat) |
| `@kolu/solid-statepip` | the shared `StatePip` component + `pipVariantFor`/`pipForPaintClass` the rows render, so a given agent state draws the identical pip as kolu's Dock |
| `@kolu/theme` | the shared colour palette (`--color-alert`, `--color-accent`, …) the pips + labels resolve, so the fleet reads the same tokens as the Dock |

## Run it

```sh
PULAM_WEB_HOSTS=localhost,nix@box nix run .#pulam-web
# → open http://localhost:4800
```

`nix run .#pulam-web` launches the parent server with the per-system pulam drv map and the client bundle baked into the wrapper — nothing to install or build by hand.

### A REMOTE host that runs kolu? Name its kaval with `PULAM_WEB_KAVAL_SOCKETS`.

The **local** machine needs no socket pin: `localhost` reads kolu's *served* awareness directly (R9a) — no pulam, no kaval to disambiguate. But a **remote** host running **kolu** has **more than one kaval daemon** (kolu-server's, plus any standalone `kaval`), so the pulam pulam-web spawns there can't guess which to read — that host renders **`no terminals`** until you name its socket with **`PULAM_WEB_KAVAL_SOCKETS`** (only the remote, ssh entry is meaningful; a `localhost=…` entry is **rejected at boot** — the local mirror has no kaval, so a socket override for it is a dead knob, and the no-ignored-knobs rule fails it loud rather than silently dropping it):

```sh
PULAM_WEB_HOSTS=localhost,srid@zest \
PULAM_WEB_KAVAL_SOCKETS="srid@zest=/tmp/kaval-7692-501/pty-host.sock" \
  nix run .#pulam-web
```

**Finding the socket.** kolu-server's kaval lives at `${XDG_RUNTIME_DIR}/kaval-<port>/pty-host.sock` (Linux) or `/tmp/kaval-<port>-<uid>/pty-host.sock` (macOS), where `<port>` is that kolu's listen port (`0` for the default instance). List a socket's terminals to pick the right one — `kaval-tui list --socket <path>` (local) or `kaval-tui list --host <ssh> --kaval <path>` (remote). When pulam can't pick, it logs every candidate verbatim — copy one from there. A host running a **single** kaval (a bare `nix run …#kaval` box) needs no entry; discovery is unambiguous.

### All the knobs

- **`PULAM_WEB_HOSTS`** (required) — comma-separated hosts. The local machine is **`localhost`** — *not* `local`: only `localhost` / `127.0.0.1` / `::1` are treated as local, so `local` is dialed as a remote host named "local" and fails to connect. A **`localhost`** host mirrors the running kolu's served awareness directly (R9a — no ssh, no pulam, no kaval socket). Every **other** host is provisioned + dialed over ssh; an unreachable one shows as a per-host `failed` row, never taking the server down.
- **`PULAM_WEB_KOLU_URL`** (default `ws://127.0.0.1:7681/rpc/ws`) — the local kolu's `/rpc/ws` the `localhost` mirror dials. Set it only when kolu isn't on the default loopback port (`7681`). Must be a `ws://`/`wss://` URL (fails fast otherwise). Unused when no local host is configured.
- **`PULAM_WEB_KAVAL_SOCKETS`** — `host=socket` pairs (see above). **Required** for any **remote** host with several kavals — i.e. **every remote host running kolu**; omit for single-kaval hosts and for `localhost` (which reads kolu's awareness directly, not its kaval). The web twin of `pulam-tui --kaval host=socket`. A socket named for any host pulam-web doesn't ssh-dial — an unknown host, or `localhost` — fails fast at boot.
- **`PULAM_WEB_PORT`** (default `4800`), **`PULAM_WEB_BIND`** (default `127.0.0.1` — the RPC surface is unauthenticated, so bind loopback unless firewalled or behind a trusted proxy). A malformed port fails fast rather than silently falling back.

For development with HMR, `PULAM_WEB_HOSTS=… PULAM_WEB_KAVAL_SOCKETS=… just pulam-web` runs the Vite client (`:5800`, proxying `/api`, `/rpc`, and the dynamic `/manifest.webmanifest`) and the tsx server (`:4800`) side-by-side, sourcing the drv map from the flake.

## App icon

The canonical pulam mark — the `> pulam` / புலம் logo — lives at [`packages/pulam/logo.svg`](../pulam/logo.svg), next to the namesake daemon and mirroring [`packages/kaval/logo.svg`](../kaval/logo.svg); it's also what `kolu.dev/kaval` renders for the pulam sibling. The PWA-only maskable variant (`logo-maskable.svg`, full-bleed with content inside the safe zone) stays here. The served PWA raster — `public/{icon-192,icon-512,icon-512-maskable}.png` plus `public/favicon.svg` — is rendered from those two with [`resvg`](https://github.com/linebender/resvg), which needs the wordmark + Tamil fonts on a fonts dir:

```sh
FONTS=$(mktemp -d)
cp "$(nix build --no-link --print-out-paths nixpkgs#jetbrains-mono)"/share/fonts/truetype/*.ttf "$FONTS/"
cp "$(nix build --no-link --print-out-paths nixpkgs#noto-fonts)"/share/fonts/noto/NotoSansTamil.ttf "$FONTS/"
cd public
nix shell nixpkgs#resvg -c resvg --use-fonts-dir "$FONTS" --skip-system-fonts -w 192 -h 192 ../../pulam/logo.svg icon-192.png
nix shell nixpkgs#resvg -c resvg --use-fonts-dir "$FONTS" --skip-system-fonts -w 512 -h 512 ../../pulam/logo.svg icon-512.png
nix shell nixpkgs#resvg -c resvg --use-fonts-dir "$FONTS" --skip-system-fonts -w 512 -h 512 ../logo-maskable.svg  icon-512-maskable.png
```

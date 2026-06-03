# @kolu/surface-app

The **app shell** for [`@kolu/surface`](../surface) apps — the ones that are really *desktop applications you run against your own server* (kolu, [drishti](https://github.com/srid/drishti), the next one). Where surface is the live reactive **wire**, surface-app is the static shell delivered *around* it: served fresh, installable like a desktop app, and always aware of its relationship to the server it's bound to.

It exists because the same property — *a returning client converges to the build you deployed* — was re-derived from scratch four times across kolu PRs (#696 / #1125 / #1135 / #1149), slightly differently each time, leaving a gap each time. The full saga is in [`docs/cache-bug.md`](../../docs/cache-bug.md); the design in [`docs/plans/surface-app.html`](../../docs/plans/surface-app.html).

## The class of app it serves

Not "any installable web app." A specific, recognizable shape:

- **You run the server** — your machine, homelab, tailnet; not a CDN, not multi-tenant SaaS. Identity is per named host.
- **Always-connected** — the live WebSocket *is* the app; there is no meaningful offline mode. This is why there's **no service worker** — by nature, not opinion.
- **Desktop-class** — installed, long-lived, native-feeling: an app window, not a tab you re-find.
- **You're usually also the deployer** — you redeploy your own server often, so a stale installed client after a deploy is the *defining* pain.

That's almost the opposite of a generic PWA (public, multi-tenant, CDN-served, offline-capable), which is why the package is `surface-app`, not `surface-pwa`.

## The freshness contract

Four properties the library guarantees. **#1 is load-bearing**; the rest are graceful degradation.

1. **One mutable entry point; everything else immutable.** The shell (`index.html`) is the *only* never-cached resource (`no-store`); content-hashed assets are `immutable`; a missing `/assets/*` hash **404**s rather than falling through to the HTML shell. The one document that names the bundle is always re-fetched, so staleness is *structurally impossible*.
2. **Build identity is first-class and single-sourced.** Client and server stamp the *same* commit, resolved once; the server exposes it on a `buildInfo` cell.
3. **Skew is visible and recoverable.** When client ≠ server, a durable indicator shows and a reload that lands fresh is one tap away.
4. **A service worker is an opt-in you own end-to-end — or, for this class, none.** surface-app ships none and actively *retires* any it finds (see "Why no service worker").
5. **The client always knows its relationship to the server** — host, build, and live status (`live` / `reconnecting` / `restarted` / stale-build) — surfaced as a headless model the app renders.

## Compose, don't hand-wire

The library ships **fragments**; an app is their **composition**, with no bespoke glue. Build identity is one concept with composable faces the app stitches together — never re-derives:

| Face | Library fragment | App composes… |
|---|---|---|
| definition | `buildInfo` (cell schema) | into `defineSurface` |
| server impl | `buildInfoServer()` | into `implementSurface` |
| client model | `useSurfaceApp()` | under `<SurfaceAppProvider>` |
| commit source | `surfaceApp()` Vite plugin / `resolveCommit()` | into vite.config & server boot |

The commit is **resolved once** — `SURFACE_APP_COMMIT` env → `git rev-parse --short HEAD` → `"dev"` (which `clientIsStale` treats as never-stale) — and fed to both the client define and the server cell. **No app writes a sha.**

## Install

Workspace-private. Wire it into the server and client packages:

```jsonc
// packages/{server,client}/package.json
{ "dependencies": { "@kolu/surface-app": "workspace:*" } }
```

## Entrypoints

| Entry | Exports | Side |
|---|---|---|
| `@kolu/surface-app` | `cacheControlFor`, `isImmutableAssetPath`, `clientIsStale`, `isCleanRef`, `SW_SOURCE` — the pure, framework-free kernels | core |
| `@kolu/surface-app/server` | `installSurfaceApp`, `installFreshStatic`, `installPwaManifest`, `buildInfoServer` (Hono) | server |
| `@kolu/surface-app/surface` | `buildInfo`, `defineBuildInfo` — the build-identity fragment | common |
| `@kolu/surface-app/solid` | `retireServiceWorker`, `reloadForUpdate`, `SurfaceAppProvider`, `useSurfaceApp` | client |
| `@kolu/surface-app/vite` | `surfaceApp()` plugin, `resolveCommit()` | build |
| `@kolu/surface-app/client` | the `__SURFACE_APP_COMMIT__` type, via `/// <reference>` | client types |

## Usage — composition at each layer

### common — surface-app's cell, alongside yours

```ts
// common/surface.ts
import { defineSurface } from "@kolu/surface/define";
import { buildInfo } from "@kolu/surface-app/surface";

export const surface = defineSurface({
  cells: {
    ...buildInfo.cells,   // surface-app: build identity
    // ...your own cells / collections / streams / events
  },
});
```

### server — compose the impl, serve the shell

```ts
// server/main.ts
import { implementSurface, publisherChannel } from "@kolu/surface/server";
import { buildInfoServer, installSurfaceApp } from "@kolu/surface-app/server";

const { router, ctx } = implementSurface(surface, {
  channel: <T>(name: string) => publisherChannel<T>(publisher, name),
  cells: { ...buildInfoServer() },   // commit auto-resolved — no hand-written store, no sha
});

// ...mount the oRPC router over HTTP + WS, registering /rpc BEFORE the static installers...

installSurfaceApp(app, {
  clientDist,
  manifest: { name: `myapp@${host}`, themeColor, icons },
});
// serves: no-store shell · immutable /assets/* · 404 on asset-miss · SPA fallback
//       · /sw.js (the self-destructing retirement worker, no-cache) · /manifest.webmanifest
```

`installFreshStatic` / `installPwaManifest` are exported for apps that compose by hand; `installSurfaceApp` is the greenfield convenience that wires both in the right order.

### build — the commit, resolved once

```ts
// vite.config.ts
import { surfaceApp } from "@kolu/surface-app/vite";
export default defineConfig({ plugins: [solid(), surfaceApp()] });
```

```ts
// env.d.ts — reference the shipped type instead of redeclaring the global
/// <reference types="@kolu/surface-app/client" />
```

A non-Vite build (e.g. `Bun.build`) calls `resolveCommit()` and feeds its own `define`; a nix-built client stamps the same value. One resolver, one source of truth.

### client — the headless model; you render the chrome

```ts
// client/App.tsx
import { retireServiceWorker, SurfaceAppProvider, useSurfaceApp } from "@kolu/surface-app/solid";

retireServiceWorker();   // unregister any worker an earlier build left + drop its caches

// at the root — pass your control-plane surface client:
<SurfaceAppProvider controlPlane={app} clientCommit={__SURFACE_APP_COMMIT__} status={connectionStatus}>
  …your app…
</SurfaceAppProvider>

// anywhere inside — render your OWN badge/rail/prompt from the model:
const pwa = useSurfaceApp();
//   pwa.status()      → "live" | "reconnecting" | "restarted" | "down"
//   pwa.stale()       → this bundle is provably behind the server's build
//   pwa.server()      → { commit, … } the build you're bound to
//   pwa.clientCommit  → this bundle's commit
//   pwa.reload()      → land the deployed build
//   pwa.setAttention(n) → OS app badge (installed Chromium) + document title
```

**No styled components ship** — a tailwind app and a different-CSS app render their own chrome from the same model. `controlPlane` takes one client; a many-client app (one per host) passes its *control-plane* client, since the model is global.

## Build identity is an interface

What "the build" means is the one thing apps vary. The default is the commit; extend it via `defineBuildInfo`:

```ts
// default — exposes { commit }
export const buildInfo = defineBuildInfo({
  schema: z.object({ commit: z.string() }),
  isStale: (srv, cli) => clientIsStale(srv.commit, cli.commit),
});

// an app that adds an axis (e.g. kolu's pty-host divergence):
const buildInfo = defineBuildInfo({
  schema: z.object({ commit: z.string(), ptyHost: PtyHostRefSchema }),
  isStale: (srv, cli) =>
    clientIsStale(srv.commit, cli.commit) || ptyHostDiverged(srv.ptyHost, cli.ptyHost),
});
```

`buildInfoServer({ commit? })` is the matching server impl; spread it into `implementSurface`. An app that extends the schema writes its own impl alongside.

## Why no service worker

For this class it's **definitional**, not an opinion — but the rationale ships so the next engineer doesn't "add a SW for offline" and re-open the wound:

- **No offline to gain** — a surface app needs its live WebSocket; no wire, no app.
- **No speed to gain** — content-hashed assets are already `immutable`-cached; a precache just adds a stale-prone layer.
- **Real downside** — a SW is a second interception layer in front of the network that `no-store` can't reach; owning its update+retire lifecycle is a standing liability (the whole saga).
- **Install survives without it** — Chrome dropped the SW requirement for installability (108 mobile / 112 desktop); a valid manifest over a secure context installs.

surface-app ships `SW_SOURCE` (a self-destructing worker `installSurfaceApp` serves at `/sw.js`) plus `retireServiceWorker()` (run on load) — together they retire a worker an earlier build registered, with no user action. Gate any SW logic on `window.isSecureContext`, **never** `location.protocol === "https:"` (that misses `localhost` and flag-secured origins — the bug that orphaned kolu's worker).

## The desktop layer needs a secure context (HTTPS)

The freshness **core** (delivery, skew over the wire, reload) works on plain HTTP and `ws://`. The **desktop-feel layer** (install, the Badging API) is gated on `window.isSecureContext`, which a self-hosted app reached by bare hostname or private/tailnet IP over plain HTTP does *not* have (`localhost` is exempt). surface-app feature-detects and degrades with an actionable hint — never a hard block. Trusted-cert paths for a self-hosted box:

| Path | Trusted, no warning? | Per-device setup | Best for |
|---|---|---|---|
| `tailscale serve` | ✓ — real LE cert on `*.ts.net` | none (every tailnet device) | **recommended (tailnet)** |
| mkcert / local CA | ✓ where the CA is installed | per device | single LAN device |
| Caddy `tls internal` | ✓ where the CA is installed | per device | multi-service LAN |
| self-signed | ✗ — warns | per device, every time | localhost dev only |

surface-app does **not** acquire TLS — that's a deployment-axis concern; it only requires a secure context for the desktop layer.

## Review checklist

When auditing an app's delivery (this is the judgment, in lieu of a separate skill):

- **Is the app on surface-app?** Don't re-derive cache headers, the SPA fallback, or SW handling by hand.
- **Did anyone register a service worker?** The stance is: ship none, retire legacy. A new SW re-opens the stale-client bug.
- **Triage a stale client:** *normal reload stale, hard reload fresh* → a cached shell **or** a service worker. Confirm **in the browser** (Network panel Size column reads `(ServiceWorker)`; `navigator.serviceWorker.getRegistrations()`), never by reasoning about the origin.
- **`immutable` presumes content-hashed filenames.** An unhashed shell asset must stay `no-cache` (it never matches the asset prefix, so it isn't pinned).
- **Desktop features (install, badging) need a trusted secure context.** On plain-HTTP LAN they're silently unavailable — surface the hint, don't assume.

## Example

`example/` is a runnable hello-world (Hono server + SolidJS client). It shows the composition end-to-end: surface-app's `buildInfo` and an app-specific live `serverStats` cell (uptime · clients · server clock, server-pushed) rendered side by side, plus the `≠ srv` skew rail and reload.

```sh
cd packages/surface-app/example
just dev      # server :7710 + Vite :5175 → http://localhost:5175
just start    # prod-like: built client served by the server → http://127.0.0.1:7710
```

To see the skew rail, give the server a different commit: `SURFACE_APP_COMMIT=deadbeef just start`. Open a second tab to watch the **clients** count rise.

## Design notes

- **A read-only server cell is read with `app.cells.X.use({ authority: "server" })`** — `{ initial }` is the *local-authority* shape and won't typecheck for it. (`buildInfo` is a server cell.)
- **`SurfaceAppProvider`'s `controlPlane` is typed `any` today.** Typing it against surface's exported `SurfaceClient` — and switching the internal `buildInfo` read to `{ authority: "server" }` — is the planned ship-time hardening.
- **Composition is by cell-spread** (`...buildInfo.cells`) for now. If `@kolu/surface` grows a `composeSurfaces` primitive, the seam becomes "compose whole surfaces" instead of merging cell maps.
- **No second-consumer speculation.** The boundary is shaped by kolu's and drishti's actual edges; it graduates to drishti as the app-agnosticism test.

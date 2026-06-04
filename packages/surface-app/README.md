# @kolu/surface-app

The **app shell** for [`@kolu/surface`](../surface) apps — the ones that are really *desktop applications you run against your own server* (kolu, [drishti](https://github.com/srid/drishti), the next one). Where surface is the live reactive **wire**, surface-app is the static shell delivered *around* it: served fresh, installable like a desktop app, and always aware of its relationship to the server it's bound to.

It exists because the same property — *a returning client converges to the build you deployed* — was re-derived from scratch four times across kolu PRs (#696 / #1125 / #1135 / #1149), slightly differently each time, leaving a gap each time. The full saga is in [`docs/cache-bug.md`](../../docs/cache-bug.md); the design in the Atlas note [`surface-app`](../../docs/atlas/src/content/atlas/surface-app.mdx) ([rendered](../../docs/atlas/dist/surface-app.html)).

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
| commit source | `surfaceApp()` Vite plugin · `buildSurfaceClient()` (Bun) · `resolveCommit()` | into the client build & server boot |
| restart axis | `serverIdentity` (procedure) + `serverIdentity()` (impl) | into `defineSurface` & `implementSurface` |

The **restart axis** is the counterpart to the skew axis: the `server.info`
probe that reads a per-process `processId`. It used to be re-derived per app
(kolu's `rpc.ts`, the example, drishti); now it's a fragment — `serverIdentity`
(the procedure shape, spread into `defineSurface`) plus `serverIdentity()` (the
impl, spread into `implementSurface`) — so the restart axis is as turnkey as the
commit axis. No app hand-writes the `processId` procedure.

The commit is **resolved once** — `SURFACE_APP_COMMIT` env → `git rev-parse --short HEAD` → `"dev"` (which `clientIsStale` treats as never-stale) — and fed to both the client define and the server cell. **No app writes a sha.** If your build system names the env var otherwise (kolu's `KOLU_COMMIT_HASH`), pass it: `resolveCommit("KOLU_COMMIT_HASH")` / `surfaceApp({ commitEnvVar: "KOLU_COMMIT_HASH" })` — or just export `SURFACE_APP_COMMIT` in your build (simpler).

## Install

Workspace-private. Wire it into the server and client packages:

```jsonc
// packages/{server,client}/package.json
{ "dependencies": { "@kolu/surface-app": "workspace:*" } }
```

The `/server` entry serves your shell through **Hono** — `hono` and
`@hono/node-server` are declared as **optional peer dependencies**. The server
package that imports `@kolu/surface-app/server` must have them installed (a Hono
app is the consumer's own, so you bring your own copy); the `/solid`, `/surface`,
and `/lifecycle` entries pull neither.

### Consumer tsconfig: no special flags

surface-app ships **raw TS with no build step** (`main: ./src/index.ts`), and —
like sibling `@kolu/surface` — its internal relative imports are **extensionless**
(`./commit`, not `./commit.ts`). A consumer drops it in and type-checks under
`moduleResolution: "bundler"` with **no extra compiler flags** (no
`allowImportingTsExtensions`).

This is a real constraint, not an accident. The `/vite` entry is the package's one
**Node-loaded** module: a Vite config (and kolu's own `vite.config.ts`) imports it
through Node's native ESM resolver, which — unlike a bundler or `tsx` — will **not**
probe for a `.ts` file behind an extensionless specifier. So `src/vite.ts` is kept
**self-contained** (it carries `resolveCommit` itself, with zero relative imports);
every other module is extensionless and only ever reached by a bundler/`tsx`. That
keeps the whole package extensionless without breaking Node-ESM config loading —
and frees consumers from the `TS5097` / `allowImportingTsExtensions` tax that an
extension-carrying package would impose.

## Entrypoints

| Entry | Exports | Side |
|---|---|---|
| `@kolu/surface-app` | `cacheControlFor`, `isImmutableAssetPath`, `clientIsStale`, `isCleanRef`, `SW_SOURCE` — the pure, framework-free kernels | core |
| `@kolu/surface-app/server` | `installSurfaceApp`, `installFreshStatic`, `installPwaManifest`, `buildInfoServer`, `serverIdentity` (Hono) | server |
| `@kolu/surface-app/surface` | `buildInfo`, `defineBuildInfo`, `serverIdentity`, `ServerProbeSchema` — the composable fragments | common |
| `@kolu/surface-app/solid` | `retireServiceWorker`, `reloadForUpdate`, `SurfaceAppProvider`, `useSurfaceApp`, `createServerLifecycle` | client |
| `@kolu/surface-app/lifecycle` | `retireServiceWorker`, `reloadForUpdate` — framework-free, for root setup before any component | client |
| `@kolu/surface-app/vite` | `surfaceApp()` plugin, `resolveCommit()` | build (Vite) |
| `@kolu/surface-app/bun` | `buildSurfaceClient()`, `ASSET_DIR` — the content-hashed Bun client build | build (Bun) |
| `@kolu/surface-app/client` | the `__SURFACE_APP_COMMIT__` type, via `/// <reference>` | client types |

## Usage — composition at each layer

### common — surface-app's cell, alongside yours

```ts
// common/surface.ts
import { defineSurface } from "@kolu/surface/define";
import { buildInfo, serverIdentity } from "@kolu/surface-app/surface";

export const surface = defineSurface({
  cells: {
    ...buildInfo.cells,            // surface-app: build identity (skew axis)
    // ...your own cells / collections / streams / events
  },
  procedures: {
    ...serverIdentity.procedures,  // surface-app: the `server.info` probe (restart axis)
    // ...your own procedures
  },
});
```

### server — compose the impl, serve the shell

```ts
// server/main.ts
import { implementSurface, publisherChannel } from "@kolu/surface/server";
import { buildInfoServer, installSurfaceApp, serverIdentity } from "@kolu/surface-app/server";

const { router, ctx } = implementSurface(surface, {
  channel: <T>(name: string) => publisherChannel<T>(publisher, name),
  cells: { ...buildInfoServer() },        // commit auto-resolved — no hand-written store, no sha
  procedures: { ...serverIdentity() },    // one processId per process — no hand-written probe
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
// surfaceApp({ commitEnvVar: "KOLU_COMMIT_HASH" }) to read a differently-named env var.
```

```ts
// env.d.ts — reference the shipped type instead of redeclaring the global
/// <reference types="@kolu/surface-app/client" />
```

A nix-built client stamps the same value into `SURFACE_APP_COMMIT`. The Vite plugin above is the Vite path; the Bun path is `@kolu/surface-app/bun` below. One resolver (`resolveCommit`), one source of truth.

#### Bun.build consumers — `buildSurfaceClient`

The freshness contract's load-bearing property is **content-hashed asset filenames** — `immutable` is only correct because a changed bundle gets a new URL. With Vite that's automatic (the plugin above). For a `Bun.build` client, **don't hand-roll it** — compose `buildSurfaceClient` from `@kolu/surface-app/bun`, which owns the hash-naming, the `__SURFACE_APP_COMMIT__` define (via `resolveCommit`), content-hashing of extra assets, and the no-store shell rewrite. You supply only what's genuinely yours — bundler plugins, your CSS toolchain, your public dir:

```ts
// build.ts
import { buildSurfaceClient } from "@kolu/surface-app/bun";

await buildSurfaceClient({
  entrypoint: "src/client/main.tsx",
  distDir: "dist",
  htmlTemplate: "src/client/index.html",
  entryHtmlPlaceholder: `src="./main.tsx"`,      // the dev ref the shell rewrite replaces
  plugins: [solidJsxPlugin],                      // your bundler plugins (e.g. Solid JSX)
  extraAssets: [                                  // your CSS toolchain → hashed /assets/styles-<hash>.css
    { name: "styles", ext: "css", build: buildTailwindCss, htmlPlaceholder: `href="./styles.css"` },
  ],
  publicDir: "src/client/public",                 // icons etc., copied verbatim outside /assets/
});
```

It emits the hashed JS + extra assets under `/assets/` (the `ASSET_DIR` the server pins `immutable`), stamps the commit, and rewrites `index.html` to the hashed URLs — the shell itself stays unhashed at the root and is served `no-store`. The drishti adoption (PR #47) is the reference consumer. `resolveCommit` and `ASSET_DIR` are exported if you need to compose more by hand.

### client — the headless model; you render the chrome

```ts
// client/App.tsx
import { SurfaceAppProvider, useSurfaceApp } from "@kolu/surface-app/solid";

// retireServiceWorker() runs at root setup, before any component — import it from
// the framework-free /lifecycle subpath (re-exported from /solid for convenience):
import { retireServiceWorker } from "@kolu/surface-app/lifecycle";
retireServiceWorker();   // unregister any worker an earlier build left + drop its caches

// at the root — surface-app derives the connection lifecycle from the transport:
<SurfaceAppProvider
  controlPlane={app}                               // typed: must carry the buildInfo cell
  clientCommit={__SURFACE_APP_COMMIT__}
  ws={ws}                                          // open/close → connecting/live/down
  probe={() => app.rpc.surface.server.info({})}    // { processId } → reconnected vs restarted
  // isStale={(srv, cli) => …}                      // optional: override the predicate per section
  // onError={(err) => toast.error(err.message)}    // optional: surface a dead buildInfo stream
>
  …your app…
</SurfaceAppProvider>

// The connection source is a union — pass EITHER { ws, probe } (turnkey: the
// provider derives the lifecycle itself) OR { status } (you already derived it
// once via createServerLifecycle and share it with the rest of the UI — the
// provider reads YOUR accessor instead of attaching a second listener/probe
// pair). Passing only half of ws/probe is not representable. kolu uses { status }
// because its rpc.ts already owns the single module-level lifecycle.

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

What "the build" means is the one thing apps vary. The default is the commit; extend it via `defineBuildInfo`. The `isStale` predicate takes the **server's** build identity and the **client's baked commit string** — `(server: T, clientCommit: string | undefined) => boolean` — and defaults to the clean-ref-guarded commit comparison:

```ts
// default — exposes { commit }; drishti uses exactly this.
export const buildInfo = defineBuildInfo({
  schema: z.object({ commit: z.string() }),
  default: { commit: "" },
  // isStale defaults to (server, clientCommit) => clientIsStale(server.commit, clientCommit)
});

// an app that adds an axis (e.g. kolu's pty-host divergence):
const koluBuildInfo = defineBuildInfo({
  schema: z.object({
    commit: z.string(),
    ptyHost: z.object({ staleKey: z.string(), navigableCommit: z.string() }).optional(),
  }),
  default: { commit: "", ptyHost: { staleKey: "", navigableCommit: "" } },
  isStale: (server, clientCommit) =>
    clientIsStale(server.commit, clientCommit) || server.ptyHost?.staleKey !== localStaleKey,
});
```

`buildInfoServer({ buildInfo? })` is the matching server impl and is **generic over `T`** — pass the full extended value and the cell store's type narrows to it, so even an extended schema needs no hand-written store:

```ts
// default: { commit } — commit auto-resolved
cells: { ...buildInfoServer() }

// extended (sync value): the store returns KoluBuildIdentity, type-checked end to end
cells: { ...buildInfoServer({ buildInfo: { commit, ptyHost: { staleKey, navigableCommit } } }) }
```

If you pass `buildInfo` without a `commit` (or an empty one), the resolved commit fills it in — the single-source-of-truth resolver still owns the sha. `SurfaceAppProvider` is likewise generic over `T` (pass your `buildInfo` fragment) and over the probe response `P` (a superset of `{ processId }`), so an extended schema flows through `useSurfaceApp<T>()` untyped-`any`-free.

#### A boot-time-async axis flows through the same fragment

When part of the build identity resolves **asynchronously at boot** — kolu's
pty-host axis settling over the in-process link *after* the cell is seeded —
`buildInfo` may be an **async thunk** (or a sync thunk, or a plain value). The
fragment seeds `{ commit }` synchronously, folds the resolved value in when the
promise settles, and `connect(ctx.cells.buildInfo)` republishes it over the
cell's channel. The app **never** seeds-then-`ctx.set`s by hand:

```ts
const build = buildInfoServer<KoluBuildIdentity>({
  // resolves over the link a moment after boot — return the FULL T or a Partial<T> patch
  buildInfo: async () => ({ ptyHost: await system.version() }),
  // optional: dedup re-publishes the way confStore cells do (default: JSON.stringify)
  equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
});

const { ctx } = implementSurface(surface, {
  cells: { ...build },          // seeds { commit, … } synchronously
  // …
});

// flow the late half through the SAME fragment — no hand-written second ctx.set:
await build.buildInfo.connect(ctx.cells.buildInfo);   // republishes once settled
```

- **`buildInfo` source** — `T | (() => T) | (() => Promise<T | Partial<T>>)`. An async source returning a `Partial<T>` patches the `{ commit }` seed; a full `T` replaces it. A failed boot-time axis leaves the seed in place (the skew axis keeps working).
- **`connect(cell)`** — drives the resolved value through the cell's ctx setter (which routes to the bus + the dedup gate), awaiting the async source first. A no-op for a sync source (re-asserting the seed is deduped). Returns a promise so a boot can `await` it.
- **`equals`** — emitted on the cell entry, so the surface runtime suppresses a no-op re-publish on **every** write path (`connect`, a later `ctx.set`, a wire `set`), the same way kolu's confStore-backed cells declare `equals: JSON.stringify`. Defaults to `JSON.stringify` identity.
- **`build.buildInfo.current()`** / **`build.buildInfo.ready`** — the fragment's own read of the resolved value and a promise that settles once the async source lands (handy for boot logging / tests).

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

`example/` is a runnable hello-world (Hono server + SolidJS client). It shows the composition end-to-end: an **extended** `buildInfo` (the default `commit` plus a `bootId` axis the server learns **asynchronously at boot** — standing in for kolu's pty-host `system.version`, flowed through the fragment's async source + `connect(...)`) and an app-specific live `serverStats` cell (uptime · clients · server clock, server-pushed) rendered side by side, plus the `≠ srv` skew rail and reload. The `BOOT` field in the rail starts at `…` and fills in once the async axis settles — the boot-time-async path, composed not hand-wired.

```sh
cd packages/surface-app/example
just dev      # server :7710 + Vite :5175 → http://localhost:5175
just start    # prod-like: built client served by the server → http://127.0.0.1:7710
```

To see the skew rail, give the server a different commit: `SURFACE_APP_COMMIT=deadbeef just start`. Open a second tab to watch the **clients** count rise.

## Design notes

- **A read-only server cell is read with `app.cells.X.use({ authority: "server" })`** — `{ initial }` is the *local-authority* shape and won't typecheck for it. (`buildInfo` is a server cell.)
- **The connection lifecycle is derived in-library.** `createServerLifecycle({ ws, probe })` (used by the provider) turns transport open/close + a `processId` probe into `connecting → connected → disconnected → reconnected / restarted` — kolu's `rpc.ts`, encapsulated, so the WS indicator drops into drishti unchanged. `useSurfaceApp().status()` maps it to `live / reconnecting / restarted / down`. Commit (skew) and processId (restart) stay distinct axes.
- **`SurfaceAppProvider`'s `controlPlane` is structurally typed.** It's constrained to `ControlPlane<T>` — a client whose `cells.buildInfo.use({ authority: "server" })` yields the build identity — so passing a client whose surface lacks `buildInfo` (drishti's admin client vs. its per-host clients) is a compile error, not a silent runtime read. A real `SurfaceClient<S>` whose surface composes `...buildInfo.cells` satisfies it. The internal read is `{ authority: "server" }` (buildInfo is a server cell).
- **Composition is by cell-spread** (`...buildInfo.cells`) for now. If `@kolu/surface` grows a `composeSurfaces` primitive, the seam becomes "compose whole surfaces" instead of merging cell maps.
- **No second-consumer speculation.** The boundary is shaped by kolu's and drishti's actual edges; it graduates to drishti as the app-agnosticism test.

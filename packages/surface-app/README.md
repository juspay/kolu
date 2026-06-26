# @kolu/surface-app

The **app shell** for [`@kolu/surface`](../surface) apps — the ones that are really *desktop applications you run against your own server* (kolu, [drishti](https://github.com/srid/drishti), the next one). Where surface is the live reactive **wire**, surface-app is the static shell delivered *around* it: served fresh, installable like a desktop app, and always aware of its relationship to the server it's bound to.

It exists because the same property — *a returning client converges to the build you deployed* — was re-derived from scratch four times across kolu PRs (#696 / #1125 / #1135 / #1149), slightly differently each time, leaving a gap each time. The full saga is in [`docs/cache-bug.md`](../../docs/cache-bug.md); the design in the Atlas note [`surface-app`](../../docs/atlas/src/content/atlas/surface-app.mdx) ([rendered](../../docs/atlas/dist/surface-app.html)).

## The class of app it serves

Not "any installable web app." A specific, recognizable shape:

- **You run the server** — your machine, homelab, tailnet; not a CDN, not multi-tenant SaaS. Identity is per named host.
- **Always-connected** — the live WebSocket *is* the app; there is no meaningful offline mode. This is why there's **no *caching* service worker** — by nature, not opinion. (A *fetch-less* worker — one that never intercepts the network — is a legitimate opt-in for OS notifications; see "Why no caching service worker".)
- **Desktop-class** — installed, long-lived, native-feeling: an app window, not a tab you re-find.
- **You're usually also the deployer** — you redeploy your own server often, so a stale installed client after a deploy is the *defining* pain.

That's almost the opposite of a generic PWA (public, multi-tenant, CDN-served, offline-capable), which is why the package is `surface-app`, not `surface-pwa`.

## The freshness contract

Four properties the library guarantees. **#1 is load-bearing**; the rest are graceful degradation.

1. **One mutable entry point; everything else immutable.** The shell (`index.html`) is the *only* never-cached resource (`no-store`); content-hashed assets are `immutable`; a missing `/assets/*` hash **404**s rather than falling through to the HTML shell. The one document that names the bundle is always re-fetched, so staleness is *structurally impossible*.
2. **Build identity is first-class and single-sourced.** Client and server stamp the *same* commit, resolved once; the server exposes it on a `buildInfo` cell.
3. **Skew is visible and recoverable.** When client ≠ server, a durable indicator shows and a reload that lands fresh is one tap away.
4. **A service worker is an opt-in you own end-to-end — caching never, fetch-less when you need it.** By default surface-app actively *retires* any worker it finds; an app that needs OS notifications opts into a *fetch-less* worker (no `fetch` handler → zero caching → freshness still structural). See "Why no caching service worker".
5. **The client always knows its relationship to the server** — host, build, and live status (`live` / `reconnecting` / `restarted` / stale-build) — surfaced as a headless model the app renders.

## Compose as siblings, don't merge

surface-app is a **complete surface**, not a fragment merged into the app
surface. An app serves a keyed **map of independent surfaces** multiplexed over
one transport, each namespaced by its key — surface-app rides under its own key
(e.g. `surfaceApp`) as a **sibling** of the app's own surface. The multiplexing
lives in `@kolu/surface` (`implementSurfaces` / `surfaceClients` /
`composeSurfaceContracts`); surface-app just contributes one of the siblings.
Build identity is one concept with composable faces the app stitches together —
never re-derives:

| Face | Library piece | App composes… |
|---|---|---|
| definition | `buildInfo` (cell schema) | into `surfaceAppSurfaceWith` |
| surface | `surfaceAppSurface` / `surfaceAppSurfaceWith` (a complete `Surface`) | as a sibling in `implementSurfaces` / `surfaceClients` / `composeSurfaceContracts` |
| server impl | `surfaceAppServer()` (the cell + probe deps bundle) · `buildInfoServer()` (the cell only) | as an `implementSurfaces` entry's `deps` |
| client model | `useSurfaceApp()` | under `<SurfaceAppProvider>` |
| commit source | `surfaceApp()` Vite plugin · `buildSurfaceClient()` (Bun) · `resolveCommit()` | into the client build & server boot |
| restart axis | `identity.info` probe (on the surface) + `serverIdentity()` (impl) | rides the same sibling surface |

The **restart axis** is the counterpart to the skew axis: the `identity.info`
probe that reads a per-process `processId`. It used to be re-derived per app
(kolu's `rpc.ts`, the example, drishti); now it lives in surface-app's own
surface under the `identity` namespace, so a consumer registering surface-app
under key `surfaceApp` gets the wire path `surface.surfaceApp.identity.info`. The
server impl is `serverIdentity()`, bundled with the buildInfo cell impl by
`surfaceAppServer()`. No app hand-writes the `processId` procedure.

The buildInfo cell's async boot axis (kolu's `system.version`, the example's
`bootId`) flows through the cell entry's `connect` — which the surface runtime
now fires **automatically** once the cell ctx is built. There is no app-visible
`connect` call and no hand-written seed→`ctx.set` dance.

The commit is **resolved once** — `SURFACE_APP_COMMIT` env → `git rev-parse --short HEAD` → `"dev"` (which `clientIsStale` treats as never-stale) — and fed to both the client shell and the server cell. The client value rides the **`no-store` shell** as `window.__SURFACE_APP_COMMIT__` (read via `shellCommit()`), **never a bundler define** baked into a content-hashed asset — a define puts the sha inside a file pinned `immutable` for a year, so a post-build stamp that rewrites it under an unchanged filename strands returning browsers on the old stamp (kolu#1319). **No app writes a sha.** If your build system names the env var otherwise (kolu's `KOLU_COMMIT_HASH`), pass it: `resolveCommit("KOLU_COMMIT_HASH")` / `surfaceApp({ commitEnvVar: "KOLU_COMMIT_HASH" })` — or just export `SURFACE_APP_COMMIT` in your build (simpler).

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
`/connect`, and `/lifecycle` entries pull neither. The `/connect` entry's one
extra dependency is **`partysocket`** (a hard dependency, installed
automatically) — that's where surface-app's commitment to the partysocket
transport becomes explicit (the package's one `new PartySocket(...)`).

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
| `@kolu/surface-app` | `cacheControlFor`, `isImmutableAssetPath`, `clientIsStale`, `isCleanRef`, `SHELL_COMMIT_GLOBAL`, `shellCommitScript`, `injectShellCommit`, `SW_SOURCE`, `NOTIFICATION_SW_SOURCE`, `SERVER_PROCESS_ID_PARAM`, `STALE_PROCESS_CLOSE_CODE`, `rejectStaleProcess` — the pure, framework-free kernels (incl. the shell-carried commit and the stale-tab handshake wire contract) | core |
| `@kolu/surface-app/server` | `installSurfaceApp`, `installFreshStatic`, `installPwaManifest`, `buildInfoServer`, `serverIdentity`, `surfaceAppServer` (Hono; `serverIdentity`/`surfaceAppServer` expose the minted `processId` for the gate), `gateStaleSocket` (the WS-upgrade handshake gate — error-handler-first, `rejectStaleProcess`, close `4001` — in the one correct order), `startWsHeartbeat` (the server-side liveness reaper), `acceptSurfaceSocket` (owns the reaper AND sequences stale-gate → enrol → dispatch in one `accept(...)`, so a socket can't be dispatched un-enrolled) | server |
| `@kolu/surface-app/surface` | `buildInfo`, `defineBuildInfo`, `surfaceAppSurface`, `surfaceAppSurfaceWith`, `ServerProbeSchema` — the standalone surface | common |
| `@kolu/surface-app/solid` | `retireServiceWorker`, `registerServiceWorker`, `registerOrRetireServiceWorker`, `reloadForUpdate`, `SurfaceAppProvider` (turnkey `{ ws, probe }` source handles the whole stale-tab handshake), `useSurfaceApp`, `createServerLifecycle` (derives the lifecycle AND, default-on, runs the half-open liveness heartbeat — `onProcessId` / `onStaleRestart` / `restartCloseCode` / `heartbeat`), `connectSurface` / `connectSurfaces` (the turnkey single- / multi-surface seams: socket + client(s) + default-on heartbeat in one call, for per-host fleet sockets), `createLiveSignal` (re-exported from `@kolu/surface/solid`, where it now lives beside the module-private brand so nothing can forge one — the single, unforgeable minter of a watchdog-backed `LiveSignal`: it wires the half-open heartbeat AND brands the live signal `surfaceClient` requires over a websocket; the seams wrap it, a hand-built client calls it directly), `createSocketStatus`, `retireSocket` | client |
| `@kolu/surface-app/connect` | `createProcessIdEcho`, `createSurfaceSocket`, `createHeartbeat`, `retireOnStaleClose` — framework-free client transport: the shared `pid`-echo, the `new PartySocket(...)` construction with that echo'd URL thunk, the half-open-socket watchdog, and the per-socket stale-close self-retire. The link + clients + lifecycle stay with the consumer (they differ per app) | client |
| `@kolu/surface-app/lifecycle` | `retireServiceWorker`, `registerServiceWorker`, `registerOrRetireServiceWorker`, `reloadForUpdate`, `shellCommit`, `retireSocket` — framework-free, for root setup before any component (`registerOrRetireServiceWorker()` is the boot-time register-or-retire policy both kolu and pulam-web call — register the notification worker, fall back to `retireServiceWorker()` if it fails; `shellCommit()` reads the shell-carried build commit; `retireSocket` is the stale-tab transport teardown the `/solid` lifecycle's `onStaleRestart` calls; it lives here because it's pure transport manipulation, no SolidJS) | client |
| `@kolu/surface-app/vite` | `surfaceApp()` plugin, `resolveCommit()` | build (Vite) |
| `@kolu/surface-app/bun` | `buildSurfaceClient()`, `ASSET_DIR` — the content-hashed Bun client build | build (Bun) |
| `@kolu/surface-app/client` | the `window.__SURFACE_APP_COMMIT__` shell-global type, via `/// <reference>` | client types |

## Usage — composition at each layer

### common — surface-app as a sibling surface

```ts
// common/surface.ts
import { composeSurfaceContracts, defineSurface } from "@kolu/surface/define";
import { surfaceAppSurface } from "@kolu/surface-app/surface";

// Your OWN surface — surface-app is NOT merged into it.
export const appSurface = defineSurface({
  cells: {
    // ...your own cells
  },
  // ...your own collections / streams / events / procedures
});

// The wire contract is the two surfaces composed as SIBLINGS, each under its
// key. Type your link off `typeof contract`. Extending build identity? Use
// `surfaceAppSurfaceWith(yourBuildInfoDef)` in place of `surfaceAppSurface`.
export const contract = composeSurfaceContracts({
  app: appSurface,
  surfaceApp: surfaceAppSurface,
});
// surface.app.* and surface.surfaceApp.* — including surface.surfaceApp.identity.info
```

### server — serve the siblings, serve the shell

```ts
// server/main.ts
import { implement } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { implementSurfaces, publisherChannel } from "@kolu/surface/server";
import { installSurfaceApp, surfaceAppServer } from "@kolu/surface-app/server";
import { contract } from "../common/surface";

// Serve a keyed map of independent surfaces over one transport. surface-app is
// a SIBLING under its key; `surfaceAppServer()` is the deps bundle for that
// entry (the buildInfo cell + the `identity.info` probe). The runtime supplies
// each sibling a key-namespaced channel and fires the buildInfo cell's `connect`
// (the async boot axis) automatically — no hand-written seed→ctx.set dance.
const { router: surfacesRouter, ctx } = implementSurfaces(
  { channel: <T>(name: string) => publisherChannel<T>(publisher, name) },
  {
    app: { surface: appSurface, deps: { /* ...your own cells/procedures */ } },
    surfaceApp: { surface: surfaceAppSurface, deps: surfaceAppServer() },
  },
);

// `implementSurfaces` returns a router FRAGMENT — wrap it with
// `implement(contract).router({ ...fragment })` before handing it to the
// RPC/WS handlers. The fragment carries its baked `surface.*` paths, so this
// is a plain spread (no extra prefix); mounting the raw fragment skips the
// contract bind and 404s. Register `/rpc` BEFORE the static installers.
const appRouter = implement(contract).router({ ...surfacesRouter } as any);
const httpHandler = new RPCHandler(appRouter);
// const wsHandler = new WsRPCHandler(appRouter);  // same router over WS
// ...mount httpHandler/wsHandler on /rpc...

installSurfaceApp(app, {
  clientDist,
  manifest: { name: `myapp@${host}`, themeColor, icons },
});
// serves: no-store shell · immutable /assets/* · 404 on asset-miss · SPA fallback
//       · /sw.js (the self-destructing retirement worker — or the fetch-less
//         notification worker with `serviceWorker: "notify"`, no-cache) · /manifest.webmanifest
```

`installFreshStatic` / `installPwaManifest` are exported for apps that compose by hand; `installSurfaceApp` is the greenfield convenience that wires both in the right order.

#### The HTML head + icon set the manifest assumes (the one un-injectable seam)

`installPwaManifest` serves `/manifest.webmanifest`, but the **shell still has to point at it** and ship the icon files it names — and that lives in the consumer's static `index.html`, which surface-app can't inject (only the build commit `<script>` rides the `surfaceApp()` Vite plugin). So every installable consumer hand-writes the **same three head links**, against the **same icon filenames** the manifest's `icons` default to. They're a fixed convention; copy them verbatim and swap only the favicon art:

```html
<!-- in <head> — the install triad every surface-app PWA repeats verbatim -->
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/icon-192.png" />
```

Ship these under the client's `public/` (served from `/`), matching the `icons` you pass `installPwaManifest`:

| File | Manifest entry |
| --- | --- |
| `public/icon-192.png` | `{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }` — also the `apple-touch-icon` |
| `public/icon-512.png` | `{ src: "/icon-512.png", sizes: "512x512", type: "image/png" }` |
| `public/icon-512-maskable.png` | `{ …, sizes: "512x512", purpose: "maskable" }` — content inside the central safe zone |
| `public/favicon.svg` | the `rel="icon"` tab glyph (not in the manifest) |

Live consumers of this exact convention: `packages/client` (kolu), `packages/pulam-web`, and `drishti`. The links and filenames are stable boilerplate; only the *art* (and the manifest `name`/`themeColor`) is app identity. *There is intentionally no helper for this — static-HTML head tags aren't injectable like the commit script, so the convention is documented rather than coded.*

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

The plugin injects the commit onto the **`no-store` shell** as `window.__SURFACE_APP_COMMIT__`; read it with `shellCommit()` from `@kolu/surface-app/lifecycle`. It is deliberately *not* a bundler define — see "the commit rides the shell" above (kolu#1319). A nix-built client stamps the same value into `SURFACE_APP_COMMIT`. The Vite plugin above is the Vite path; the Bun path is `@kolu/surface-app/bun` below. One resolver (`resolveCommit`), one source of truth.

**Nix consumers** — don't hardcode the env-var name or the rev logic. `nix/commit-stamp.nix` is the upstream single source (the name is kept equal to `resolveCommit`'s `DEFAULT_COMMIT_ENV_VAR`); import it from the pinned surface-app tree and compose:

```nix
let stamp = import "${kolu-surface-app}/nix/commit-stamp.nix" { }; in
# flake: rev = stamp.revFromSelf self;          (short self.rev, else "dev")
# client derivation buildPhase:  ${stamp.exportLine rev}      (so resolveCommit reads it — sandbox has no git)
# server wrapper (makeWrapper):  --set ${stamp.envVar} "${rev}"   (so server's buildInfo matches the client)
```

The client bundle and the server cell then read the same var from one place — drishti (PR #47) is the reference. `resolveCommit` and `ASSET_DIR` are exported on the TS side for the rest.

#### Bun.build consumers — `buildSurfaceClient`

The freshness contract's load-bearing property is **content-hashed asset filenames** — `immutable` is only correct because a changed bundle gets a new URL (and, conversely, an identical bundle keeps its URL: so the commit must stay *out* of it, or a stamp-only rebuild changes an `immutable` file's bytes under an unchanged name — kolu#1319). With Vite that's automatic (the plugin above). For a `Bun.build` client, **don't hand-roll it** — compose `buildSurfaceClient` from `@kolu/surface-app/bun`, which owns the hash-naming, injecting the commit onto the **shell** (`window.__SURFACE_APP_COMMIT__`, via `resolveCommit` — never a bundle define), content-hashing of extra assets, and the no-store shell rewrite. You supply only what's genuinely yours — bundler plugins, your CSS toolchain, your public dir:

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

It emits the hashed JS + extra assets under `/assets/` (the `ASSET_DIR` the server pins `immutable`), stamps the commit onto the shell, and rewrites `index.html` to the hashed URLs — the shell itself stays unhashed at the root, carries the commit global, and is served `no-store`. The drishti adoption (PR #47) is the reference consumer. `resolveCommit` and `ASSET_DIR` are exported if you need to compose more by hand.

### client — the headless model; you render the chrome

```ts
// client/App.tsx
import { surfaceClients } from "@kolu/surface/solid";
import { SurfaceAppProvider, useSurfaceApp } from "@kolu/surface-app/solid";
import { appSurface } from "../common/surface";
import { surfaceAppSurface } from "@kolu/surface-app/surface";

// registerOrRetireServiceWorker() runs at root setup, before any component —
// import it from the framework-free /lifecycle subpath (re-exported from /solid
// for convenience). It registers the notification worker and, if that fails (dev,
// where /sw.js isn't served), retires any worker instead — the boot policy both
// kolu and pulam-web call. An app that wants NO worker at all calls the bare
// retireServiceWorker() instead. shellCommit() reads the build commit the shell
// carries (window.__SURFACE_APP_COMMIT__):
import {
  registerOrRetireServiceWorker,
  shellCommit,
} from "@kolu/surface-app/lifecycle";
void registerOrRetireServiceWorker(); // register the notify worker; retire if it fails

// One client per sibling surface, scoped by key over the one link. Each client's
// `.rpc` is the scoped link `{ surface: link.surface[key] }`, so the key is
// consumed by the scope and does NOT reappear in the call path: the probe is
// `clients.surfaceApp.rpc.surface.identity.info` — NOT `…surface.surfaceApp.identity.info`.
// (Raw for the keying; a socket bundle passes a watchdog-backed `LiveSignalHandle`
// (minted by `createLiveSignal`) as the transport — or just uses `connectSurfaces`,
// which mints it. A bare or unbranded socket link throws — it can half-open.)
const clients = surfaceClients(transport, {
  app: appSurface,
  surfaceApp: surfaceAppSurface,
});

// `.rpc` is typed `unknown` — the combined link can't be expanded per-key
// (see `SurfaceClient.rpc`), so pin the call shape once at the boundary:
const probeIdentity = (): Promise<ServerProbe> =>
  (
    clients.surfaceApp.rpc as {
      surface: { identity: { info: (input: object) => Promise<ServerProbe> } };
    }
  ).surface.identity.info({});

// at the root — surface-app derives the connection lifecycle from the transport:
<SurfaceAppProvider
  controlPlane={clients.surfaceApp}                // typed: must carry the buildInfo cell
  clientCommit={shellCommit()}                     // the commit the no-store shell carries
  ws={ws}                                          // open/close → connecting/live/down
  probe={probeIdentity}                            // { processId } → reconnected vs restarted
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
//   pwa.isInstalled() → running as an installed app (standalone / iOS standalone)
//   pwa.canInstallPwa() → a secure context where the ONE-CLICK prompt (+ app
//                         badge / SW) works AND not already installed — false
//                         over plain http:// on a LAN/tailnet IP, where MANUAL
//                         install via the browser menu still works. Gate the
//                         one-click affordance on it, not all install.
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
promise settles, and the cell entry's `connect` republishes it over the cell's
channel — **the surface runtime fires `connect` automatically** once the cell
ctx is built, so the app never seeds-then-`ctx.set`s by hand:

```ts
surfaceApp: {
  surface: surfaceAppSurface,             // or surfaceAppSurfaceWith(koluBuildInfo)
  deps: surfaceAppServer<KoluBuildIdentity>({
    // resolves over the link a moment after boot — return the FULL T or a Partial<T> patch
    buildInfo: async () => ({ ptyHost: await system.version() }),
    // optional: dedup re-publishes the way confStore cells do (default: JSON.stringify)
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  }),
}
// implementSurfaces fires the cell's connect once after wiring — no hand-written ctx.set.
```

If you compose the buildInfo cell by hand into your own surface instead (the
lower-level `buildInfoServer` fragment, without surface-app's sibling surface),
the cell entry's `connect` is the same runtime cell-dep — declared on the cell
deps, fired by `implementSurface` / `implementSurfaces` for you.

- **`buildInfo` source** — `T | (() => T) | (() => Promise<T | Partial<T>>)`. An async source returning a `Partial<T>` patches the `{ commit }` seed; a full `T` replaces it. A failed boot-time axis leaves the seed in place (the skew axis keeps working).
- **`connect(cell)`** — drives the resolved value through the cell's ctx setter (which routes to the bus + the dedup gate), awaiting the async source first. A no-op for a sync source (re-asserting the seed is deduped). The runtime owns the call; apps don't invoke it.
- **`equals`** — emitted on the cell entry, so the surface runtime suppresses a no-op re-publish on **every** write path (`connect`, a later `ctx.set`, a wire `set`), the same way kolu's confStore-backed cells declare `equals: JSON.stringify`. Defaults to `JSON.stringify` identity.
- **`build.buildInfo.current()`** / **`build.buildInfo.ready`** — the fragment's own read of the resolved value and a promise that settles once the async source lands (handy for boot logging / tests).

## Why no caching service worker

The ban is on a *caching* worker — one with a `fetch` handler that intercepts the network. For this class that's **definitional**, not an opinion — the rationale ships so the next engineer doesn't "add a SW for offline" and re-open the wound:

- **No offline to gain** — a surface app needs its live WebSocket; no wire, no app.
- **No speed to gain** — content-hashed assets are already `immutable`-cached; a precache just adds a stale-prone layer.
- **Real downside** — a *fetch-handling* SW is a second interception layer in front of the network that `no-store` can't reach; owning its update+retire lifecycle is a standing liability (the whole saga).
- **Install survives without it** — Chrome dropped the SW requirement for installability (108 mobile / 112 desktop); a valid manifest over a secure context installs.

By default surface-app ships `SW_SOURCE` (a self-destructing worker `installSurfaceApp` serves at `/sw.js`) plus `retireServiceWorker()` (run on load) — together they retire a worker an earlier build registered, with no user action.

**The fetch-less notification opt-in.** An installed PWA can only raise an OS notification through `ServiceWorkerRegistration.showNotification()` — the page-level `new Notification()` constructor is an *illegal constructor* in `standalone` display mode on Chromium, so it silently throws and no banner appears. So an app that needs notifications opts in: serve `NOTIFICATION_SW_SOURCE` (`installFreshStatic({ serviceWorker: "notify" })`) and register it. Boot setup calls `registerOrRetireServiceWorker()`, which registers the worker and falls back to `retireServiceWorker()` if registration fails (dev, where `/sw.js` isn't served) — so the register-or-retire invariant lives in one primitive rather than re-authored per surface; the bare `registerServiceWorker()` / `retireServiceWorker()` leaves remain the escape hatch for an app that composes them differently. That worker has **no `fetch` handler**, so it never intercepts the network and the freshness contract holds structurally — the ban was always on caching, not on the existence of a worker. It also subsumes retirement: registering at the `/` scope replaces any legacy caching worker, which it purges on `activate`. An app does one or the other — register (notify) **or** retire (none) — never both. (Registering the worker is the *infrastructure* notifications need; the app still wires the actual permission-request + `showNotification()` trigger itself, e.g. kolu's `useActivityAlerts.ts`.)

Gate any SW logic on `window.isSecureContext`, **never** `location.protocol === "https:"` (that misses `localhost` and flag-secured origins — the bug that orphaned kolu's worker).

## The desktop layer needs a secure context (HTTPS)

The freshness **core** (delivery, skew over the wire, reload) works on plain HTTP and `ws://`. The **one-click desktop-feel layer** (the automatic install prompt, the Badging API, service workers) is gated on `window.isSecureContext`, which a self-hosted app reached by bare hostname or private/tailnet IP over plain HTTP does *not* have (`localhost` is exempt). *Manual* install still works over plain http — Chrome/Edge ⋮ → "Create shortcut → open as window", iOS Safari Share → Add to Home Screen — it's only the one-click prompt and the app badge that need HTTPS. surface-app feature-detects and degrades with an actionable hint — never a hard block. Trusted-cert paths for a self-hosted box:

The model surfaces this as `useSurfaceApp().canInstallPwa()` — `true` only in a secure context and not already installed (`isInstalled()`). Gate the *one-click* install affordance on it: over plain `http://` on a LAN/tailnet IP it returns `false`, so the UI can show the manual browser-menu steps (and offer "set up HTTPS for one-click") instead of dangling a dead one-click button. `isInstalled()` reflects standalone display-mode / iOS `navigator.standalone`, and both accessors re-evaluate on `appinstalled` and display-mode changes.

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
- **Did anyone register a *caching* service worker?** The stance is: no `fetch` handler, ever. A worker that caches re-opens the stale-client bug; a fetch-less notification worker (`NOTIFICATION_SW_SOURCE`) is fine — confirm it registers no `fetch` listener.
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
- **The connection lifecycle is derived in-library — and keeps itself alive.** `createServerLifecycle({ ws, probe })` (used by the provider) turns transport open/close + a `processId` probe into `connecting → connected → disconnected → reconnected / restarted` — kolu's `rpc.ts`, encapsulated, so the WS indicator drops into drishti unchanged. It also owns the socket's **liveness**: a default-on half-open watchdog (the folded-in `createHeartbeat`) reuses the same `probe` on an interval and forces `ws.reconnect()` when a probe times out — a silently half-open socket (laptop sleep / Wi-Fi roam / NAT idle-eviction — TCP dead with no FIN/RST, so neither `open` nor `close` fires) would otherwise freeze every stream until a manual reload. Deriving a lifecycle therefore can't leave the socket un-watched (opt out with `heartbeat: false`). For a socket with NO shared lifecycle UI (per-host fleet sockets), `connectSurface` wires the same watchdog default-on around a one-call socket + client build, defaulting the probe to the framework-reserved `system.live` (`@kolu/surface/liveness`) so no app supplies — or forgets — a probe. The server twin, `acceptSurfaceSocket` (`/server`), reaps the matching server-side zombie. `useSurfaceApp().status()` maps it to `live / reconnecting / restarted / down`. Commit (skew) and processId (restart) stay distinct axes. The optional `restartCloseCode` (on `createServerLifecycle` and forwarded through the provider's turnkey `{ ws, probe }` source) lets a host signal a restart synchronously: when the transport closes with that exact code, the lifecycle goes straight to `restarted` instead of `disconnected` — no probe can run, since the socket is already gone. kolu uses it for the server's stale-tab handshake rejection (the host closes a tab whose `pid` no longer matches the live process), so a server restart surfaces the reload overlay without a single dead-terminal subscription replaying.
- **The stale-tab handshake is the package's, end-to-end.** The restart axis above is one half; the gate that *prevents* the replay in the first place is the other, and it lives here too so a second consumer ([drishti](https://github.com/srid/drishti), the identical partysocket+oRPC stack) inherits it whole. **Core** owns the wire contract — `SERVER_PROCESS_ID_PARAM` (`"pid"`), `STALE_PROCESS_CLOSE_CODE` (`4001`), and the runtime-free `rejectStaleProcess(claimedPid, liveId)` (Node *or* Bun calls it). **`/server`**: `serverIdentity()`/`surfaceAppServer()` return the minted `processId` so the gate compares against the SAME id the probe reports (a second mint would never match). **`/solid`**: `createServerLifecycle` gains `onProcessId` (publishes each observed id so the consumer echoes it back as the next reconnect's `pid`) and `onStaleRestart` (fired synchronously at the single site that decodes the stale-close, so the consumer supplies the teardown action without a second `event.code` decode or a reactive effect); `retireSocket({ close, send })` (stop reconnect + a throwing `send` so oRPC's `ClientPeer` rejects rather than the offline buffer growing) is the action they pair. The **turnkey `<SurfaceAppProvider ws probe>` source owns the socket, so it handles the whole handshake for you** — forward `restartCloseCode` + `onProcessId`, and it retires the socket on a stale-restart itself (its `ws` is `WsLike & { close, send }`). A consumer with its own lifecycle uses the `{ status }` source and passes `onStaleRestart: () => retireSocket(ws)` to its own `createServerLifecycle` (as kolu does). Finally, **`/connect`** owns the rest of the plumbing: `createProcessIdEcho` is the shared `pid`-echo (its `remember` feeds `onProcessId`; one echo per app, shared across N sockets in a multi-socket app), `createSurfaceSocket` is the `new PartySocket(...)` with that echo'd URL thunk, and `gateStaleSocket` (`/server`) is the upgrade gate in the one crash-free order. What stays the consumer's either way: **lifecycle ownership** (`rpc.ts` vs the provider), **socket topology** (one socket vs per-host + admin sharing one echo), and the link + clients assembly — *not* the socket builder or the echo (those graduated into `/connect`; the `pid`-echo still re-presents the *dead* id distinct from `serverProcessId()`, just inside `createProcessIdEcho` now).
- **`SurfaceAppProvider`'s `controlPlane` is structurally typed.** It's constrained to `ControlPlane<T>` — a client whose `cells.buildInfo.use({ authority: "server" })` yields the build identity — so passing a client whose surface lacks `buildInfo` (drishti's admin client vs. its per-host clients) is a compile error, not a silent runtime read. The sibling `surfaceClients(...).surfaceApp` client — whose surface IS the surface-app surface (with its `buildInfo` cell) — satisfies it. The internal read is `{ authority: "server" }` (buildInfo is a server cell).
- **Composition is sibling, not merge.** `surfaceAppSurface` (or `surfaceAppSurfaceWith(def)` when extending build identity) is a complete `Surface` carrying the buildInfo cell + the `identity.info` probe. A consumer serves it as a SIBLING of their own surface — `implementSurfaces` (server) / `surfaceClients` (client) / `composeSurfaceContracts` (wire) in `@kolu/surface`, each keyed by surface. No app merges cell maps and procedure maps by hand; the two surfaces never share a namespace, so a key collision is structurally impossible.
- **No second-consumer speculation.** The boundary is shaped by kolu's and drishti's actual edges; it graduates to drishti as the app-agnosticism test.

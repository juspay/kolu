# The stale-client cache bug — investigation log

> Running log of the "client keeps serving an old build after deploy" bug on
> `pureintent`, kept for two purposes: **future debugging** (the diagnostic
> toolkit + signatures below) and **a blog post** (the narrative + learnings).
> Update this as we change things and discover more. PR: #1149.

## Symptom

After deploying a new kolu build, the chrome bar shows `SRV <new> · CLIENT <old> · ≠ srv`
and the running client is an old bundle. The defining signature:

- **Hard reload (cmd+Shift+R) → latest commit.**
- **Normal reload (cmd+R) → stale commit comes back.**

## Current status: **FIXED** — the service worker is killed; the stale layer is gone

Confirmed by experiment: the user **disabled** Chrome's
`unsafely-treat-insecure-origin-as-secure` flag, restarted, and the bug
**vanished with no unregister** — toggling the flag toggled the SW's ability to
control the page, hence the bug. So it was the service worker all along, enabled
by that flag making the plain-HTTP origins secure contexts; this PR's gate
checked `location.protocol === "https:"` instead of `window.isSecureContext` and
orphaned the worker. **Fix shipped:** kolu no longer registers/ships a SW,
`retireServiceWorker()` runs on every load, and a self-destructing `public/sw.js`
retires any worker an earlier build registered. The `no-store` shell + immutable
assets + durable `≠ srv` prompt remain the SW-less freshness mechanism.

### Original diagnosis (before the flag was found) — kept for the trail

The server-side fix (below) is correct and stays. The recurring staleness is a
**service worker** serving its old precache — possible because the user enabled
Chrome's `#unsafely-treat-insecure-origin-as-secure` for `http://pureintent:7692`
and `http://zest:7692`, making those plain-HTTP origins **secure contexts** where a
SW can register. This PR's SW gate checked `location.protocol === "https:"` instead
of `window.isSecureContext`, so it misclassified those origins, stopped managing the
existing worker, and **orphaned it**. Fix: kill the SW (unregister in production +
stop registering). See *Resolution* at the bottom.

> ⚠️ The "Update — service worker RULED OUT" section below was **WRONG** — it
> over-generalized from a test against a *different, truly-insecure* origin
> (`http://100.122.32.106:7692`, not in the flag list). Kept for the trail; see
> *Resolution*.

## What it is NOT (ruled out on the box)

All verified by SSHing to `pureintent` and inspecting the running service:

- **Not the server / deploy.** `KOLU_COMMIT_HASH=f336da5`; `KOLU_CLIENT_DIST`'s
  `index.html` references `index-Be1jJw2f.js`, and that bundle is stamped
  `f336da5` (4×). Server and client dist agree. The deploy is correct.
- **Not the cache headers.** `curl -sI http://<host>:7692/` → `cache-control: no-store`,
  even on a `Cache-Control: max-age=0` (normal-reload) request. Missing
  `/assets/*` → `404 text/plain`. Hashed assets → `immutable`.
- **Not a caching proxy in front of the port.** No `Age`/`Via`/`X-Cache`; a
  direct `curl` to the bound address returns `no-store` fresh on every request.
- **Not the cache-diagnostics removal.** `cacheDiagnostics` was read-only logging
  (`await next()` then `log.info`); it never touched responses. The deployed
  server still returns `no-store`. Removing it changed nothing about delivery.

## The key deduction

A `no-store` response is **never written to the HTTP cache**, so the HTTP cache
cannot replay it on a later normal reload. Therefore the stale bundle served on
a *normal* reload is NOT the browser HTTP cache. It must come from a layer that
(a) intercepts navigations, (b) holds an old build, (c) is consulted on a normal
reload but **bypassed on a hard reload**. Exactly two things behave that way:

1. **A service worker** — cmd+R goes through its `fetch` handler; cmd+Shift+R
   bypasses it. `no-store` (an HTTP-cache directive) is powerless against it.
2. **A caching reverse proxy** on the user's specific path — but a correct proxy
   would honor `no-store`, so it would have to be misconfigured.

The service worker is far more likely: the build ships `sw.js`, and the app is
**installed as a Chrome PWA** — and a true PWA install *requires* a service
worker (registered from a secure context).

## Open thread — the service worker

**Hypothesis:** an old service worker (precaching build `20e5c10`) is controlling
the installed PWA and serving its stale precache on normal reloads.

**Suspected regression cause (this PR's own change):** the HTTPS-only SW gate
added in #1149 may have *orphaned* an existing SW:

- Before: `initPwa()` always ran → `registerSW()` detected new builds and updated
  the worker.
- After: on a non-HTTPS origin `serviceWorkerSupported` is `false`, so `initPwa()`
  early-returns → the new client no longer manages the old SW. And
  `unregisterStaleServiceWorkers()` only runs in dev. → a pre-existing SW is stuck
  serving its stale precache, never updated, never removed.

**Facts still needed (from the user's browser — not inspectable from the box):**

1. Exact URL in the address bar — scheme + host + port (e.g. `http://pureintent:7692`
   vs `https://pureintent.rooster-blues.ts.net:9010`). Determines whether the
   origin is a secure context (where a SW lives).
2. DevTools → Application → Service Workers — is one registered? Its source URL,
   scope, and status.

**Immediate unblock:** DevTools → Application → Service Workers → **Unregister**
(or "Clear site data"), then reload. Removes the stale SW.

**Candidate fix (pending confirmation):** in production, when the SW is not the
intended delivery path, *actively unregister* any lingering SW (promote
`unregisterStaleServiceWorkers()` out of dev-only), so an orphaned worker can't
outlive the gate. If HTTPS *is* the intended path, the #1125 update flow
(prompt → `skipWaiting` → `controllerchange`) must actually activate instead.

## Update — service worker RULED OUT; it's a stuck HTTP-cache entry

Two facts collapsed the SW hypothesis:

- **Reproduces on a second Mac (`zest`).** Cross-machine ⇒ server/path-side, not a
  one-browser quirk. (`:9010` was a red herring — a different, now-dead service.)
- **A real Chrome against the deployed server (`http://100.122.32.106:7692`) reports
  `isSecureContext: false`, `'serviceWorker' in navigator === false`.** No SW can
  exist on a bare-hostname HTTP origin — on *any* of these machines. And that clean
  browser rendered `SRV f336da5 · CLIENT f336da5` — **matched**. Server + deploy are
  perfect; a fresh client is correct.

So the staleness is a **per-origin HTTP-cache entry for `/`** stuck in the affected
browsers. The IP-origin test browser is clean precisely because the cache is keyed
on the `pureintent` *hostname* origin the Macs use — a different cache.

**Why it won't self-heal / why hard reload doesn't fix it permanently:** the entry
was almost certainly cached in a *pre-`no-store`* era when `/` was served with no
`Cache-Control` + a `Last-Modified` of the nix-store epoch (1970). Heuristic
freshness = `(now − Last-Modified) × 10%` ≈ **5.6 years** → the browser treats the
entry as fresh and serves it on a normal reload **without revalidating**, so the
current `no-store` never reaches it. A hard reload bypasses the cache (shows fresh)
but doesn't *evict* the heuristic entry, so the next normal reload serves stale again.

**Confirm:** Network tab → normal reload → the `/` document request shows
`(disk cache)` with no network hit.

**Immediate unblock:** DevTools → Application → **Clear site data** once per browser
(a plain hard reload is not enough — it doesn't evict the entry).

**The strategic decision (kill SW vs force HTTPS):**

- "Kill the SW" doesn't fix this (no SW on this origin); it's only hygiene — stop
  shipping the inert `sw.js` on an insecure origin.
- "Force HTTPS" *would* fix it, as a side effect: `https://` is a different origin,
  so the poisoned http-cache entries don't apply (clean slate) — and it's the only
  context where a SW could properly self-update for a real PWA.
- Verdict pivots on: **is kolu meant to be an installable/offline PWA?** Yes → force
  HTTPS + own the SW. No (live dev tool) → stay HTTP, remove the SW entirely, keep
  `no-store`. Either way, affected browsers need a one-time "Clear site data."

## The server-side fix that shipped (PR #1149)

These are correct and stay regardless of the SW thread — they fix the HTTP-cache
layer of the same property.

| Change | File | Why |
| --- | --- | --- |
| SPA shell → `no-store` (was `no-cache`) | `cacheControl.ts` | a normal reload can't replay a cached shell |
| Missing `/assets/*` → `404` (was immutable HTML) | `index.ts` | wrong-MIME + year-long `immutable` cache poisoning |
| Durable `clientStale` reload prompt | `pwa.ts` | a backgrounded tab still learns it's stale |
| Service worker gated to HTTPS only | `pwa.ts` | a SW off-HTTPS only adds a stale precache — **but see Open thread: this may orphan an existing SW** |
| `≠ srv` indicator on mobile | `MobileTileView` / `MobileChromeSheet` / `ui/StaleBadge` | catch drift on mobile |
| typed `ORPCError("NOT_FOUND")` | `router.ts` / `surface.ts` | kills the opaque "Internal server error" console noise |

## Diagnostic toolkit (for next time)

```sh
# On the box: what is the running server, and what does it serve?
PID=$(systemctl --user show -p MainPID --value kolu.service)
tr '\0' '\n' < /proc/$PID/environ | grep -iE 'KOLU_COMMIT_HASH|KOLU_CLIENT_DIST'
HOST=$(systemctl --user show -p ExecStart --value kolu.service | grep -oP -- '--host \K[0-9.]+')

curl -sI "http://$HOST:7692/" | grep -i cache-control          # expect: no-store
curl -s  "http://$HOST:7692/" | grep -o 'assets/index-[^"]*\.js' # the served bundle
grep -roh -E '<commit>' "$KOLU_CLIENT_DIST"/assets/*.js | sort -u # what commit the dist is stamped
curl -s -o /dev/null -w '%{http_code}\n' "http://$HOST:7692/assets/index-DEADBEEF.js" # expect: 404
```

**Signature decoder:**

- normal reload stale, hard reload fresh → cached **shell** or a **service worker**.
- server returns `no-store` but stale persists on normal reload → **service worker**
  (or a misbehaving proxy), *not* the HTTP cache.
- `CLIENT` shows a commit the server's dist doesn't have → the browser is running a
  cached/precached old bundle, not what the server serves now.

## Learnings (for the blog / the `web-delivery` skill)

- **`no-store` fixes the HTTP-cache layer, not the service-worker layer.** They are
  two independent interception layers; a SW sits in front of the network and
  `no-store` never reaches it.
- **A service worker is a standing liability, not a feature you add and forget.**
  Gating *new* registration is not enough — an *existing* SW outlives the gate.
  Own its full lifecycle, including teardown.
- **Get ground truth from the running system before theorizing** — every wrong
  turn here came from guessing the deployment (HTTPS? proxy? SW?) instead of
  reading it off the box. (The one fact that stayed un-gettable from the box: the
  user's *browser* state — which is exactly where the bug lived.)
- This is why the [`surface-app`](./atlas/src/content/atlas/surface-app.mdx)
  library exists: encode the freshness contract once so the next app doesn't
  relitigate it.

## Resolution — it WAS a service worker (the flag was the missing fact)

The user runs Chrome with `#unsafely-treat-insecure-origin-as-secure` set to
`http://pureintent:7692,http://zest:7692`. That makes those plain-HTTP origins
**secure contexts**, so `navigator.serviceWorker` is available and a SW registered
on both machines. zest's Network panel confirmed it: the `zest` *document* and every
asset showed **`(ServiceWorker)`** in the Size column — the SW was intercepting the
navigation and serving its stale precache (`20e5c10`). Hard reload bypasses the SW
(fresh); normal reload goes through it (stale).

**Why this PR caused the regression:** the SW gate added here checked
`location.protocol === "https:"`. The flag-secured origins are `http://` yet
**secure** (`window.isSecureContext === true`). So the gate wrongly treated them as
"no SW," `initPwa()` early-returned, the new client stopped managing the worker, and
`unregisterStaleServiceWorkers()` only ran in dev — **orphaning** the SW: never
updated, never removed. The correct secure-context test is `window.isSecureContext`,
**never** `location.protocol === "https:"`.

**The fix (chosen): kill the SW.** kolu gains nothing from it (no offline — it needs
a live WebSocket; immutable HTTP caching already covers asset speed; install survives
on a secure context via the manifest alone on modern Chrome). So:

1. `unregisterStaleServiceWorkers()` runs in **production** (not just dev) and deletes
   the SW caches — tears down the orphaned workers on the flag-secured origins and
   self-heals every affected browser on next load.
2. Stop registering / shipping a SW (drop `initPwa`/`registerSW` + the VitePWA `sw.js`
   generation).
3. Keep `no-store` shell + immutable assets + the durable `≠ srv` skew prompt as the
   SW-less freshness mechanism.

**Immediate per-browser unblock:** DevTools → Application → Service Workers →
Unregister (or Clear site data) → reload.

**HTTPS vs the flag (orthogonal to the fix):** the flag is a poor-man's secure
context — works on the user's own machines but is manual per-browser and doesn't
distribute. Real HTTPS (cert / `tailscale serve`) gives every client a secure context
without a flag, but it does **not** fix this bug by itself (it would relocate to a new
origin = clean slate, and keep the SW). Decide it independently of the SW kill.

### Learnings added to the pile

- **`window.isSecureContext`, never `location.protocol === "https:"`** — the latter
  misses `http://localhost` and flag-secured origins. This one wrong predicate caused
  the regression.
- **The diagnostic gap that cost the most: the bug lived in the user's *browser*, and
  every wrong turn came from testing a server / a box-browser / the wrong origin
  instead of the user's actual origin.** The `(ServiceWorker)` Size column and the
  `chrome://flags` setting were the two facts that cracked it — both browser-side.
- **A service worker is a standing liability you must own end-to-end** — gating *new*
  registration doesn't remove an *existing* worker; you need an active unregister
  path, in production, or it outlives the gate forever.

## Development history — generalizing into `@kolu/surface-pwa` (post-#1149)

> This section logs the *design* phase that follows the bugfix: turning the
> hard-won freshness contract into reusable infrastructure. Kept for the eventual
> blog post — the bug is the story's first act; this generalization is the second.
> The living design (formerly the `surface-pwa` plan) was migrated to the Atlas:
> `docs/atlas/src/content/atlas/surface-app.mdx` (rendered to
> `docs/atlas/dist/surface-app.html`).

### Why generalize at all
The same property — "a returning client converges to the deployed build" — has now
been re-derived four times (#696, #1125, #1135, #1149), each slightly differently,
each leaving a gap. The lesson `electricity.html` records: conventions-as-prose
drift; a shared package does not. `@kolu/surface` already proved this for reactive
transport. Delivery freshness is the next electricity.

### Naming evolved as the scope clarified
- `@kolu/web-delivery` — first name; "delivery freshness" = cache + skew + SW.
- `@kolu/surface-web-delivery` — once we accepted oRPC/surface as the substrate, a
  surface-companion name made the relationship explicit.
- `@kolu/surface-pwa` — the final name *and* a scope expansion: not just freshness
  but the whole installable shell on top of surface (manifest, icons, install,
  delivery, SW stance, version skew). The "pwa" noun is owned as the package's
  thesis — *a good PWA on this stack ships no service worker* — not apologized for.

### The design tension (good blog material)
Two three-lens reviews (lowy ∥ hickey ∥ surface-identity) on placement were
unanimous, high-confidence, for a *surface-free, decoupled, split* design: keep the
HTTP/SW mechanics in a package that never imports surface (depending on the
reactive-transport framework for cache-header code is a layering inversion), and let
only a tiny `buildInfo` cell ride surface. They optimized for **portability and
minimal coupling** — a non-surface app could reuse the mechanics.

The product decision went the other way, deliberately: **batteries-included and
surface-native.** Rationale: (1) the name *says* surface — of course it builds on
surface; (2) the user-visible wins (the reload prompt, the skew badge) should be
*owned* by the library so downstream apps don't re-replicate them; (3) **interfaces,
not decoupling, are the extensibility seam** — where an app needs to vary behavior
(kolu adds pty-host staleness to build identity; drishti is happy with the default
`{ commit }`), it overrides an interface rather than the library staying generic.

The reconciliation worth remembering for the blog: *the lenses optimized for "any app
could reuse a piece"; the product optimized for "a surface app gets everything for
free." An extensible interface delivers the second without sacrificing correctness —
apps extend the default rather than fork it.*

### The shape we settled on
- **Depends on `@kolu/surface`.** Genuinely-pure helpers (the cache-directive map,
  the `sw.js` source, `clientIsStale`) live under `utils/`, but the package is a
  surface package, full stop.
- **Entrypoints:** `/server` (static-serve + manifest), `/solid` (SW retirement +
  skew wiring), `/ui` (`<ReloadPrompt/>` + `<StaleBadge/>`, *shipped*, not deferred),
  and `/surface` (a `buildInfo` cell composed into the app's `defineSurface`).
- **A Nix module is part of the package:** it stamps the commit on both sides,
  injecting `__SURFACE_PWA_COMMIT__` into the client build and `SURFACE_PWA_COMMIT`
  into the server env — so commit single-sourcing (invariant #2) is owned by
  surface-pwa, not re-wired per app.
- **Build identity is an interface**, default impl `{ commit }`, with the staleness
  predicate part of it. kolu overrides it to add pty-host divergence; drishti uses
  the default. Two independent freshness axes (build skew vs pty divergence) stay
  distinguishable.
- The service-worker stance (retire, never ship) is documented *with its rationale*
  in the library, so the next app inherits the reasoning, not just the code.

### Open question (unsettled)
Does a *skill* still earn its keep once the library is batteries-included? The
author-guidance half collapses into the README; what remains is a thin review lens
(are you on surface-pwa? did you re-introduce a SW? run the normal-vs-hard-reload
triage). Leaning toward folding the judgment into the README + docs and deferring a
separate skill unless drishti proves it's needed.

### Validated against drishti (the second consumer)
Before writing any code we ran a read-only fit-check against the real
`github.com/srid/drishti`. It's a close shadow of surface-pwa's own scope — already
SolidJS 1.9 + Hono on `@hono/node-server`, a heavy `@kolu/surface` user, and it
hand-rolls a static-shell server, a manifest, icons, and a service worker. So
drishti is less "an app that needs the library" and more "the prior art the library
replaces" — an unusually good fit test. Six findings shaped the API:

1. **Bun.build, not Vite** → commit stamping must be **bundler-agnostic**: server env
   `SURFACE_PWA_COMMIT` + a client define the app's own bundler injects; the Vite/Nix
   `withCommitStamp` is just a convenience. (drishti vendors `@kolu/*` via npins with
   zero flake inputs, same as kolu — adding surface-pwa is a one-line overlay add; the
   bundler, not the flake, is the only difference.)
2. **An active offline-caching SW today, but it doesn't actually need offline** →
   surface-pwa retires it cleanly, same as kolu; an owned-SW opt-in stays available for
   a hypothetical future offline app, but neither kolu nor drishti is one.
3. **No single client `app`** (a `Map<host, surfaceClient>` + an admin client) →
   `<SurfacePwaProvider>` takes a **control-plane client**, not "the app."
4. **A richer manifest than `{ name, themeColor, icons }`** (+ apple head tags),
   already shipped+tested → `installPwaManifest` takes a full, extensible manifest
   and is optional.
5. **Unhashed asset filenames** (`Bun.build` emits `main.js`) → a small drishti PR
   switches to content-hashed output first; `immutable` is documented as requiring
   hashing, and unhashed shell assets stay `no-cache` as a guard.
6. **No commit source yet, default `{ commit }` otherwise sufficient** → validates the
   default build-identity; only the stamp (finding 1) is missing.

No showstoppers — integration is a one-line nix-overlay add once surface-pwa ships as
`packages/surface-pwa`. The throughline: **granular-first** — `installFreshStatic`
usable alone, without dragging manifest or SW opinions; the all-in-one bundle is
greenfield convenience.

### Reframed: surface-app — a class of app, not a generic PWA (renamed from surface-pwa)
Questioning the "pwa" name surfaced the real model. This isn't for any installable web
app — it's for **self-hosted, always-connected, desktop-class apps you run against your
own server** (kolu, drishti): you own the box, the live wire IS the app (no offline),
it's installed and desktop-feeling, and you're usually also the deployer — which is why
a stale client after a redeploy is the defining pain. "pwa" mis-signals
(offline / installable-for-offline), the opposite of the model. Renamed to
**@kolu/surface-app** — "the app shell for a surface wire."

The reframe sharpens scope:
- **Drop, as definitional (not opinion):** offline / precache / SW-as-feature. Install
  becomes a *desktop* affordance (own window, dock, per-host identity), not an offline
  one. Out entirely: SEO, multi-tenant, CDN/edge — public-web concerns.
- **Add — the unifying insight:** build-skew, connection status, and server identity are
  ONE question — *"what's my relationship to the server I'm bound to right now?"* So
  surface-app owns the connection+update+identity **model** (headless `useSurfaceApp()`;
  apps render the UI, consolidate later if it converges), plus desktop-feel affordances:
  an install prompt, the App Badging API, document-title/favicon state.
- **Secure context:** install + badging need HTTPS, which a self-hosted LAN/tailnet app
  lacks by default. We gate the desktop layer on a *trusted* secure context and document
  the cert paths (tailscale serve, mkcert, self-signed); cert management is likely its
  own small library. A research pass is confirming the facts — decisively, whether
  current Chrome still requires a service worker for installability (if so, it tensions
  the no-SW invariant). Build identity stays an extensible interface (kolu adds pty-host;
  drishti uses the default `{ commit }`).

### Research confirmed (desktop layer + secure context)
A four-topic research pass settled the open facts (sources: developer.chrome.com,
web.dev, MDN, W3C secure-contexts, tailscale/mkcert/caddy docs):
- **Install needs NO service worker** anymore — Chrome dropped that requirement (108
  mobile / 112 desktop); a valid manifest over a secure context is installable. So the
  no-SW invariant and "be installable" don't conflict. CAVEAT: the *automatic*
  `beforeinstallprompt` still references a fetch handler, so without a SW the in-page
  Install button is best-effort — but manual browser-menu install always works. So:
  wire the prompt as progressive enhancement, detect installed via
  `display-mode: standalone` (+ iOS `navigator.standalone`), fall back to menu/Add-to-
  Home-Screen copy. Install affordances are Chromium-only.
- **Secure context is the master gate** for install + Badging (`window.isSecureContext`).
  `localhost`/`127.0.0.1`/`*.localhost` are exempt (work over http); LAN IPs and bare
  hostnames over http are NOT — so install/badge are silently unavailable there.
- **Two layers:** the freshness *core* (delivery, skew over the wire, reload) works on
  plain HTTP/`ws://` — kolu on a plain-HTTP LAN keeps working. Only the *desktop layer*
  is gated. (I moderated the research's "hard-block if not secure" recommendation — that
  would break the core — to graceful degradation + an actionable hint.)
- **Trusted-cert paths:** `tailscale serve` (real LE cert on `*.ts.net`, warning-free,
  auto-renew, zero per-device setup) is the recommended path; mkcert / Caddy `tls
  internal` need a per-device CA install; plain self-signed warns. Cert acquisition is a
  different volatility (deployment/infra) → keep it OUT of surface-app: extract kolu's
  self-signed generator into a tiny optional `@kolu/dev-tls` (localhost escape hatch),
  document the trusted recipes, and have surface-app only feature-detect + hint. This
  also closes the saga loop — a real cert removes any reason for the Chrome insecure-
  origin flag that orphaned the SW.
- **Desktop-feel APIs:** one headless attention/count model fans out to `setAppBadge`
  (installed Chromium, Win/macOS; Linux no-ops; Android dot-only; Safari/FF desktop
  none) → `document.title` (universal) → canvas favicon (Safari blocks favicon
  scripting). No SW means badge updates only while a connected page is live — fine,
  since the live wire is the app.

## Loop closed — kolu now CONSUMES `@kolu/surface-app`

The saga is over in code, not just in design. kolu's duplicated implementations
were deleted and replaced by the library it motivated:

- `packages/server/src/cacheControl.ts` (+ its test) → **deleted**; the server
  serves the shell via `installFreshStatic` / the manifest via `installPwaManifest`
  from `@kolu/surface-app/server` (`packages/server/src/index.ts`).
- `packages/client/public/sw.js` → **deleted**; the self-destructing retirement
  worker is now `SW_SOURCE`, served at `/sw.js` by `installFreshStatic`.
- `packages/client/src/pwa.ts` (+ test) and `ui/StaleBadge.tsx`'s derivation,
  `ui/commitRef.ts` (+ test) → **deleted / repointed**; the freshness UX is the
  library's headless model (`useSurfaceApp()`), and `isCleanRef` / `clientIsStale`
  come from `@kolu/surface-app`. kolu keeps only its tailwind `≠ srv` chip.
- `packages/client/src/rpc/rpc.ts`'s hand-rolled connection lifecycle →
  `createServerLifecycle` (rpc.ts is now the thin signal layer over it).
- The commit stamp is `surfaceApp({ commitEnvVar: "KOLU_COMMIT_HASH" })` (Vite
  plugin) → `__SURFACE_APP_COMMIT__`; the server cell uses kolu's existing
  `serverCommit`. One commit source, two faces — kolu keeps its `KOLU_COMMIT_HASH`
  Nix convention (no `default.nix` change).
- Build identity is **extended**, not replaced: `koluBuildInfo`
  (`packages/common/src/surface.ts`) adds the in-process pty-host axis
  (`{ staleKey, navigableCommit }`) to surface-app's `{ commit }` via the generic
  `defineBuildInfo`; the server fills the pty-host column through the cell once the
  in-process pty-host reports its identity at boot. The restart axis (`processId`)
  is surface-app's `serverIdentity` probe at `surface.server.info`; kolu's raw
  `server.info` now carries only per-host branding (title / watermark / theme).

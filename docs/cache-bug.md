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

## Current status: **OPEN** — a stuck HTTP-cache entry for `/` (NOT a service worker)

The server-side fix (below) is shipped and verified correct. After a redeploy the
bug returned and reproduces on a *second* Mac (`zest`). A real Chrome driven
against the deployed server settled the cause — see *Update: SW ruled out*.

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
- This is why the [`web-delivery`](./plans/web-delivery.html) skill + library
  exists: encode the freshness contract once so the next app doesn't relitigate it.

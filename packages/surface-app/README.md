# @kolu/surface-app

The **app shell** for [`@kolu/surface`](../surface) apps that are really *desktop
applications you run against your own server* (kolu, [drishti](https://github.com/srid/drishti)).
Where surface is the live reactive **wire**, surface-app is the static shell
delivered *around* it: served fresh (a returning client always converges to the
build you deployed), installable, and liveness-watched by construction — no
caching service worker, ever.

Serving is **one call**, which owns the listener's whole order — origin gate →
upgrade → stale-tab check → heartbeat enrolment → serve — plus the shell HTTP
layers, the bind, and a teardown registered on the enclosing scope:

```ts
import { serveSurfaceApp } from "@kolu/surface-app/serve";

// `{ group, handlers }` is what `implementSurface` returned; the runtime's own
// close/done stay with the composition root that built it.
const url = yield* serveSurfaceApp({
  group, handlers, clientDist, host, port, allowedOrigins,
});
```

`clientDist` is optional (omit it in dev and there is simply no static route),
and `routes`, `tls` and `middleware` cover what a real listener also needs —
kolu's own server is one of these calls.

Connecting is one call too:

```ts
import { connectSurface } from "@kolu/surface-app/solid";
import { reloadForUpdate } from "@kolu/surface-app/lifecycle";

const { link, client, readout, dispose } = await connectSurface({
  surface,
  retired: reloadForUpdate, // required: what happens when the server retires this wire
});
// client.cells.X.use(...) — the dial, the dispatch, the half-open heartbeat AND
// the stale-tab `pid` handshake are wired for you (the dial is an effect, so the
// seam is async). Even the URL is derived — omitted, it defaults to
// `surfaceWsUrl(location.origin)`, the page's own origin (pass `url` outside a
// browser). The only thing left to spell is what a tab does when the server
// it came from is gone, because that is the one state nothing else can decide.
//
// `readout()` is what an indicator draws: `connecting | live | degraded |
// reconnecting | retired`, plus `needsReload` and — when degraded — the NAMES of
// the subscriptions that stopped. `live` is the conjunction of the wire's state
// and the subscription-health fact, so green is a claim about what reaches the
// page rather than about a socket. The words and colours stay yours.
```

Part of the kolu monorepo — `"@kolu/surface-app": "workspace:*"`.

## Docs

- Reference — [@kolu/surface-app](https://kolu.dev/surface/ref-surface-app)
- See also — [Why surfaces](https://kolu.dev/surface/why-surfaces) · the design note in the [Atlas](../../docs/atlas/src/content/atlas/surface-app.mdx)

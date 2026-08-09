# @kolu/surface-app

The **app shell** for [`@kolu/surface`](../surface) apps that are really *desktop
applications you run against your own server* (kolu, [drishti](https://github.com/srid/drishti)).
Where surface is the live reactive **wire**, surface-app is the static shell
delivered *around* it: served fresh (a returning client always converges to the
build you deployed), installable, and liveness-watched by construction — no
caching service worker, ever.

```ts
import { connectSurface } from "@kolu/surface-app/solid";
import { reloadForUpdate } from "@kolu/surface-app/lifecycle";

const { link, client, status, dispose } = await connectSurface({
  surface,
  url,
  retired: reloadForUpdate, // required: what happens when the server retires this wire
});
// client.cells.X.use(...) — the dial, the dispatch, the half-open heartbeat AND
// the stale-tab `pid` handshake are wired for you (the dial is an effect, so the
// seam is async). The only thing left to spell is what a tab does when the server
// it came from is gone, because that is the one state nothing else can decide.
```

Part of the kolu monorepo — `"@kolu/surface-app": "workspace:*"`.

## Docs

- Reference — [@kolu/surface-app](https://kolu.dev/surface/ref-surface-app)
- See also — [Why surfaces](https://kolu.dev/surface/why-surfaces) · the design note in the [Atlas](../../docs/atlas/src/content/atlas/surface-app.mdx)

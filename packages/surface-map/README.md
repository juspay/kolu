# @kolu/surface-map

A **dynamic keyed map of remote surfaces** — one entry surface, typed once, keyed
at runtime, served as one. N entries are active by construction: a client reaches
any entry's cells/collections/streams through the client object
(`app.entry("boxA").cells.load.use(…)`), and membership is a single authoritative
collection the UI renders honestly — one dead entry becomes one `failed` chip, not
a crash. It is the framework notion behind kolu's host switch and drishti's fleet
view. Depends only on [`@kolu/surface`](../surface).

```ts
import { defineSurfaceMap } from "@kolu/surface-map";
import { serveSurfaceMap } from "@kolu/surface-map/server";

export const hostMap = defineSurfaceMap(z.string(), surface, identityCodec);
const { router } = serveSurfaceMap(hostMap, registry); // a finalized, servable router
```

Part of the kolu monorepo — `"@kolu/surface-map": "workspace:*"`.

## Docs

- Tutorial — [A fleet of surfaces](https://kolu.dev/surface/a-fleet-of-surfaces)
- How-to — [Serve a map of surfaces](https://kolu.dev/surface/serve-a-map)
- Reference — [@kolu/surface-map](https://kolu.dev/surface/ref-surface-map)
- Explanation — [The client half](https://kolu.dev/surface/the-client-half) · [Entry contracts](https://kolu.dev/surface/entry-contracts)

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
import { Schema } from "effect";

export const hostMap = defineSurfaceMap({
  key: Schema.String,
  entry: surface,
  codec: identityCodec,
  // The domain failure value's schema — a failed entry cannot exist without one.
  failure: Schema.Struct({ reason: Schema.String }),
});
// The same { group, handlers } pair implementSurface returns — merge it into
// your own served surface; a tag carries its own route.
const { group, handlers, dispose } = serveSurfaceMap(hostMap, registry);
```

## Nested siblings

An entry may carry whole **sibling surfaces** beside the entry surface — a second
daemon the entry's own socket already serves, re-served through the map and
addressed per key:

```ts
export const padiHostMap = defineSurfaceMap({
  key: HostKeySchema,
  entry: padiEntrySurface,
  codec: hostKeyCodec,
  failure: PadiEntryFailureSchema,
  name: "padi",
  siblings: { odu: oduSurface },
});

// …and in the browser:
padiMap.entry(host).odu.streams.checkout.use(() => ({ repoRoot }));
```

The tag grammar is one segment of nesting, no more. An entry member of a map
mounted as `padi` is `surface/padi/<member>/<verb>`; a sibling member is
`surface/padi/<sibling>/<member>/<verb>`. Upstream — on the entry's own socket,
where that daemon is a plain sibling of its host surface — the same member is
`surface/<sibling>/<member>/<verb>`, so the map hop is a re-tag between the two.
Every sibling call folds the entry's `mapKey` exactly as an entry member's does, so
it routes to that key's session and no other. A sibling name that would shadow an
entry face member (`cells`, `streams`, `state`, …) is refused at declaration.

A sibling face carries the same six bound subtrees an entry face does (`cells` ·
`collections` · `streams` · `events` · `procedures` · `rpc`), typed from that
sibling's own spec — and nothing more: `state` and `clock` stay the ENTRY's,
because membership and the clock offset are facts of the key, and a surface served
under that entry has no second membership of its own. The reactive lens reads the
same, `useEntry(host).odu.streams.checkout.use(…)`: a sibling's subscriptions
re-key on an active-key switch — and on a same-key re-add — by exactly the entry's
rule rather than through a second copy of it.

**Why a sibling and not more members on the entry surface?** Because it is a
different program's contract. padi and odu have two release cadences, two versions
and two clocks; folding odu's members into padi's entry surface would make odu's
contract part of padi's — one spec that two daemons must agree on, and a version
skew in either one that the other has to carry. Keeping it a sibling keeps the two
contracts separate values that are only ever *mounted* together, which is also why
a sibling is declared as a whole `Surface` and not as a spec fragment.

Part of the kolu monorepo — `"@kolu/surface-map": "workspace:*"`.

## Docs

- Tutorial — [A fleet of surfaces](https://kolu.dev/surface/a-fleet-of-surfaces)
- How-to — [Serve a map of surfaces](https://kolu.dev/surface/serve-a-map)
- Reference — [@kolu/surface-map](https://kolu.dev/surface/ref-surface-map)
- Explanation — [The client half](https://kolu.dev/surface/the-client-half) · [Entry contracts](https://kolu.dev/surface/entry-contracts)

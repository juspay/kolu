# @kolu/surface

A small framework for typed reactive state in SolidJS clients backed by an oRPC
streaming server. Declare a surface once — cells, collections, streams, events,
and procedures — and the framework derives the wire contract, wires the server,
and binds the client hooks. You stop hand-writing
fetch → subscribe → reconcile → reconnect and just read the values.

```ts
import { defineSurface } from "@kolu/surface/define";
import { z } from "zod";

export const surface = defineSurface({
  cells: { load: { schema: z.object({ avg: z.number() }), default: { avg: 0 } } },
  collections: { processes: { keySchema: z.number(), schema: Process } },
  procedures: { proc: { kill: { input: z.object({ pid: z.number() }), output: z.object({ ok: z.boolean() }) } } },
});
```

Part of the kolu monorepo — `"@kolu/surface": "workspace:*"`.

## Docs

The four-quadrant home is **[kolu.dev/surface](https://kolu.dev/surface)**:

- Tutorial — [Your first surface](https://kolu.dev/surface/your-first-surface)
- Reference — [@kolu/surface](https://kolu.dev/surface/ref-surface)
- Explanation — [Why surfaces](https://kolu.dev/surface/why-surfaces) · [Reactive honesty](https://kolu.dev/surface/reactive-honesty)

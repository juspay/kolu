# @kolu/surface

A small framework for typed reactive state in SolidJS clients backed by an
[Effect RPC](https://effect.website) streaming server. Declare a surface once —
cells, collections, streams, events, and procedures — and the framework derives
the flat `RpcGroup`, wires the server, and binds the client hooks. You stop
hand-writing fetch → subscribe → reconcile → reconnect and just read the values.

```ts
import { defineSurface } from "@kolu/surface/define";
import { Schema } from "effect";

const Load = Schema.Struct({ avg: Schema.Number });
const Proc = Schema.Struct({ command: Schema.String });

export const surface = defineSurface({
  cells: { load: { schema: Load, default: { avg: 0 } } },
  collections: { processes: { keySchema: Schema.Number, schema: Proc } },
  procedures: {
    proc: {
      kill: {
        input: Schema.Struct({ pid: Schema.Number }),
        output: Schema.Struct({ ok: Schema.Boolean }),
      },
    },
  },
});
// surface.group — one Rpc per member verb, tagged `surface/<member>/<verb>`.
```

Part of the kolu monorepo — `"@kolu/surface": "workspace:*"`.

## Docs

The four-quadrant home is **[kolu.dev/surface](https://kolu.dev/surface)**:

- Tutorial — [Your first surface](https://kolu.dev/surface/your-first-surface)
- Reference — [@kolu/surface](https://kolu.dev/surface/ref-surface)
- Explanation — [Why surfaces](https://kolu.dev/surface/why-surfaces) · [Reactive honesty](https://kolu.dev/surface/reactive-honesty)

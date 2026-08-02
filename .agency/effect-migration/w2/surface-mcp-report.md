# W2 fanout — `@kolu/surface-mcp` on the Effect surface core

Scope delivered: the whole package — `jsonschema.ts` (rewritten on
`Schema.toJsonSchemaDocument`), `expose.ts`, `tools.ts`, `pusher.ts`, `server.ts`,
`index.ts`, `README.md`, and all five test files. **Zero `zod` and zero `@orpc/*`
imports remain in `src/`.** `package.json` is untouched (W6 owns the dep removal;
`zod` is still declared there and is now unused).

Every API fact below was measured against the installed `effect@4.0.0-beta.102`
and compiled with the repo's own `typescript@7.0.2` — nothing is recalled from v3.

---

## 1. `jsonschema.ts` — PLAN D8 / review #14, all five divergences

`z.toJSONSchema(schema, {target, io, unrepresentable, reused, cycles})` becomes
`Schema.toJsonSchemaDocument(schema, { additionalProperties: true })` plus the
same dereference + `enforceObject` glue the module has always owned. The five
measured divergences and what each cost:

| # | Divergence (measured) | Fix |
|---|---|---|
| 1 | Effect emits `additionalProperties: false` on **every** object; zod emitted nothing. A closed tool input is a host break. | Ask the converter for `additionalProperties: true`, then **DROP the redundant `true` in the walk** — absent already means open in JSON Schema, so this restores the zod-era bytes exactly rather than merely being semantically equivalent. |
| 2 | `Schema.Number` encodes as `anyOf:[{type:"number"},{type:"string",enum:["Infinity","-Infinity","NaN"]}]` — faithful to the codec, useless to a host that will offer the agent the string `"NaN"`. | `Schema.Finite`→`{type:"number"}` / `Schema.Int`→`{type:"integer"}` are the faithful spellings **and** `normalizeNumeric` collapses the tolerant union back to its numeric arm anywhere in the tree, so an author who writes plain `Schema.Number` cannot ship the union by accident. Matched structurally and exactly (two members, second is precisely the sentinel enum), so a hand-written lookalike union is left alone — pinned by its own test. Constraints on the numeric arm (`Schema.Number.check(...)`'s `allOf`) and the node's own siblings survive the collapse. |
| 3 | `Schema.Void` / `Schema.Undefined` encode as `{"type":"null"}`, which `enforceObject` would turn into a NO-ARG tool demanding `{"value": null}`. | `isNoArgSchema` special-cases them to `emptyObjectSchema()` **before** `enforceObject`. Checked on the **AST tag**, not on the emitted document, so a genuine `Schema.Null` FIELD keeps its honest `{"type":"null"}`. Pinned twice — in `jsonschema.test.ts` and end-to-end through `resolveExpose` in `expose.test.ts`, since that is the path an actual host reads. |
| 4 | A DECODING default never reaches the document: `withDecodingDefaultKey` is a transformation and the encoded document cannot see through it. | See §1.1 — this one is a **deviation from D8's literal wording**. |
| 5 | `$defs` live on `Document.definitions` while `$ref`s point at `#/$defs/<name>`. The old `collectDefs` read `$defs`/`definitions` **off the schema object** and would have resolved *nothing*, silently dropping every referenced property. | `collectDefs(doc)` reads `doc.definitions` and keys it by `#/$defs/<name>`. |

### 1.1 Divergence 4 — deviation, with the measurement behind it

D8 says "re-emit `default` from the default annotation", which reads as a
converter code path. Measured: there is nothing for the converter to re-emit
from. `default` is a *standard* JSON Schema key and `toJsonSchemaDocument`
**already** emits it from a `default` annotation — the real content of the
divergence is **where the annotation must sit**:

```ts
// round-trips: {"type":"boolean","default":true}, and `strict` is not required
Schema.optionalKey(Schema.Boolean.annotate({ default: true }))
  .pipe(Schema.withDecodingDefaultKey(Effect.succeed(true)))

// silently LOSES the keyword — the annotation is on the post-transformation node
Schema.optionalKey(Schema.Boolean)
  .pipe(Schema.withDecodingDefaultKey(Effect.succeed(true)))
  .annotate({ default: true })
```

Extracting the value from the transformation instead was rejected: the default is
an `Effect` held behind `ast.encoding[0].transformation.decode.run`, so recovering
it would mean *running an arbitrary effect at schema-conversion time* through an
undocumented internal shape.

So the placement is stated as the LAW in `jsonschema.ts`'s header and pinned by
**two** tests — the spelling that round-trips, and the spelling that loses it.
`jsonschema.test.ts:26`'s original assertion (`{type:"boolean", default:true}`)
is satisfied unchanged; no snapshot was relaxed for it.

### 1.2 Two further divergences, neither in D8's five

- **`Schema.Date` → `{"type":"string"}`** where zod's `unrepresentable:"any"`
  degraded `z.date()` to `{}`. This is strictly more faithful — a `Schema.Date`
  is a codec whose ENCODED side is an ISO string, which is exactly what a host
  must send. The old "degrades to `{}`" test is **replaced** by two: a Date is
  advertised as its wire form, and a genuinely OPAQUE `Schema.declare` (no
  structural codec) still degrades to `{}` without throwing. Recorded rather than
  absorbed.
- **A recursive schema's ROOT is emitted as `{"$ref":"#/$defs/<name>"}`** (zod
  inlined the root and only `$ref`ed the recursive field). The dereferencer
  handles it for free — the root ref resolves, and the self-referencing property
  inside hits the `seen` cycle guard and is dropped, with `required` pruned. Both
  the root-level and the F11 nested-object cases are pinned.

### 1.3 Byte-compat (hit list)

MCP `tools/list` JSON Schema is on `recon/zod.md`'s byte-compat hit list, so
`jsonschema.test.ts` gained a **byte-level fixture** asserting the exact
`JSON.stringify(toInputSchema(...))` for a representative tool input (object,
required set, defaulted field, int, array, literal-enum, optional key, nested
object). It was diffed against the zod converter's real output for the equivalent
schema. Only **two** deltas remain, both recorded in the test:

1. `strict` spells `{"type":"boolean","default":true}` where zod spelled
   `{"default":true,"type":"boolean"}` — **key order only**, which JSON does not
   treat as semantic and no MCP host reads positionally;
2. `whole` is a bare `{"type":"integer"}` where zod additionally emitted
   `minimum`/`maximum` at the safe-integer bounds. `Schema.Int` declares
   integrality and nothing else; advertising bounds the schema does not enforce
   would be the converter lying on the schema's behalf.

Everything else — property order, `required` order, the absence of
`additionalProperties` and `$schema` — is byte-identical to the zod era.

---

## 2. `expose.ts` / `tools.ts`

- `ResourceTemplateEntry.keySchema`, and the stream/event `inputSchema` gate, are
  `WireSchemaAny` (`@kolu/surface/define`'s own bound) instead of `ZodType<any>`.
  The `noExplicitAny` biome-ignore on `keySchema` is **deleted** — the Effect
  bound needs no `any`.
- `assertExposableAsResource`'s `inputSchema.safeParse(undefined).success` becomes
  `Option.isNone(Schema.decodeUnknownOption(inputSchema)(undefined))` — the same
  question ("does this member admit the no-argument value?"), asked the Effect way.
- `BespokeTool.input` is now an Effect Schema. It is typed through a new exported
  alias **`ToolInputSchema<I> = Schema.Codec<I, unknown, never, never>`** — the
  same context-free bound `WireSchema<T>` puts on every spec schema, spelled
  locally so `tools.ts` does not depend on `@kolu/surface/define` for one type.

---

## 3. `server.ts` — the client face, the reads, and the run edges

### 3.1 What the adapter drives

`SurfaceClientCallable` survives as the callable-leaved structural shape (the
TS2590 dodge is unchanged), but its docstring now names `buildSurfaceFace` rather
than `ContractRouterClient`. The call convention changed underneath it:

| position | before | now |
|---|---|---|
| streaming verb | `proc(input, {signal}) => Promise<AsyncIterable>` | `proc(input) => Stream` |
| unary verb | `proc(input, {signal}) => Promise<T>` | `proc(input) => Promise<T>` (the face's own `Effect.runPromise` edge) |
| a dead/partial face | `source == null` guard | `Stream.isStream` guard → a `Stream.fail` carrying the same "resolved no streaming source" message |

`resolveCall` now returns `{ open: () => Stream, mimeType, kind }` — the input is
closed over, so there is one lazy opener instead of a `(proc, input)` pair every
caller had to re-assemble.

### 3.2 Reads

- `readFirstFrameSnapshot` is `Stream.runHead` + `Option` — taking the head ends
  the stream, which releases the subscription through its own finalizers (the
  Effect equivalent of the old `for await … return`). An empty open still FAILS,
  never collapses to `null`.
- **`readCollectionItemSnapshot` is reimplemented locally**, in Effect, as a
  three-arm `Effect.raceAll` (item first frame / live `keys`-absence watch /
  hard 5s deadline). Both absence bounds stay always-armed, the delete-race and
  the never-born-key cases keep their existing tests, and the uncertain
  `"deadline"` verdict is still logged loudly. See §5.1 for why it is not the
  framework helper, and §6 for the hand-off.
- **Every arm SUCCEEDS with a discriminated outcome — including the failure arm.**
  This is load-bearing, not style: `Effect.raceAll` *ignores an early failure and
  keeps waiting for a success*, so a genuinely broken item read expressed as a
  failure would lose the race to the 5s deadline and be reported to the agent as a
  benign "not present". Carrying the failure as a value and re-raising it after
  the race keeps a dropped link loud
  (`caught-error-must-not-collapse-to-empty`). `Effect.catch` (failure channel
  only) is used, never `catchCause` — a DEFECT must still surface and an
  INTERRUPT is the request's own cancellation.

### 3.3 The `AbortSignal` seam (D10/#18)

There is no `signal` on any surface call any more. Dispositions:

| site | before | now |
|---|---|---|
| `resources/read` | `signal` threaded into every client call | `Effect.runPromise(readSnapshot(...), { signal })` — **one** translation at the edge; interrupting the read's fiber tears down every subscription it opened. Strictly stronger than the old threading, which depended on each call site remembering to pass it. |
| `ResourcePusher` per-URI stream | one `AbortController` per URI | one FIBER per URI; `fiber.interruptUnsafe()` IS the unsubscribe. |
| exposed-procedure tool call | `proc(args, {signal})` | `proc(args)` — **a behaviour change, stated**: a unary member ref is a Promise with no interrupt handle, so cancelling a `tools/call` on an exposed procedure no longer cancels the underlying call. It never had a way to for a unary oRPC call either beyond aborting the HTTP request; what is genuinely lost is the streaming-tool case, which no exposed procedure is. |
| bespoke tool handler | `handler(args, client, signal)` | **unchanged.** A bespoke handler is a consumer-supplied Promise-shaped function, not a surface member, so the `AbortSignal` is the consumer's own cancellation vocabulary and the MCP request signal is handed to it verbatim. |

### 3.4 The `Effect.run*` edges, enumerated (#25 / W6 allowlist)

This package is a genuine process boundary (the MCP SDK is Promise/callback
shaped). It runs effects at exactly **two** framework-owned places, both named in
`server.ts`'s header:

1. `server.ts` — `Effect.runPromise` in the `resources/read` handler;
2. `pusher.ts` — `Effect.runFork` per subscription fiber.

(Test files add a third, in a *consumer-supplied* bespoke handler in
`compose.test.ts`, which is deliberately the consumer's own edge.)

---

## 4. `pusher.ts` — one deliberate behaviour change

The spine is otherwise ported verbatim (single attachment, debounce, bounded
retry, generation token). Two changes:

1. **`StreamFor<Client>` is `(client, uri) => Stream | undefined`** — no
   `signal`, no Promise. It is documented as PURE: it resolves an address into a
   lazy stream and must not subscribe. A throw out of it is a wiring bug and is
   left to crash rather than laundered into a retry (the old `Promise` form could
   reject because it *performed* the subscribe; the new one cannot).
2. **A detach now INTERRUPTS every live stream fiber.** The oRPC-era detach
   deliberately did NOT abort per-stream — aborting raced an RPC cancel-send
   against the transport close (`ERR_STREAM_DESTROYED`), and disposing the CLIENT
   tore every stream with it. Neither half holds now: interruption is not a
   message sent over the wire (it releases the stream's own scoped finalizers
   in-process), and the in-process `directDispatch` case has **no client to
   dispose at all**, so leaving the fibers running would leak one live handler
   subscription per URI for the life of the process. The generation token is
   KEPT, because its other job is untouched: telling a fiber's exit handler "you
   were torn down" from "your source settled". Pinned by a NEW test
   (`a detach INTERRUPTS every live subscription fiber`) that observes each
   stream's `Stream.ensuring` finalizer running.

The "aborting a single-URI unsubscribe produces no unhandled rejection" test is
restated on the Effect axis: an interrupted subscription reports nothing to
`onError`, reschedules nothing, and leaks no rejection.

---

## 5. Deviations from the brief / PLAN, with reasons

1. **The bounded collection-item read is reimplemented in this package rather
   than reused from `@kolu/surface/first-frame`.** `firstFrameOrThrow` /
   `firstFrameOfCollectionItem` are AsyncIterable + `AbortSignal`-shaped and were
   not migrated by S1–S4, so they cannot consume a `Stream`-shaped face at all.
   Bridging with `Stream.toAsyncIterable` was measured as wrong, not merely
   inelegant: the helper's teardown is `ac.abort()` in a `finally`, which a
   bridged stream ignores, so the LOSING race arm's `keys` subscription would be
   parked in a `for await` forever — a leaked subscription per absent-key read.
   The framework helper's design intent (live next to the held-open-`get`
   footgun it guards) is honoured in the code comment and in §6's hand-off.
2. **`Schema.Number` is normalized in the converter, not only documented.** D8
   and #14 both phrase item 2 as an authoring rule ("use `Schema.Finite`/`Int`");
   the brief says "in the converter". Both are implemented — the rule is
   documented and the converter enforces it — because an authoring rule with no
   mechanical backstop ships the union the first time someone writes
   `Schema.Number`, and this output is on the byte-compat hit list.
3. **Divergence 4 is an authoring law with two tests, not a converter pass.**
   §1.1.
4. **The `z.date()` degradation test is replaced, not re-snapshotted away.**
   §1.2 — the new behaviour is strictly more faithful, and the "unrepresentable
   degrades rather than throws" property is preserved by a new opaque-declaration
   test.
5. **`Schema.Struct({})` (an empty struct) is NOT special-cased.** Effect emits
   `anyOf:[{type:"object"},{type:"array"}]` for it, which `enforceObject` would
   wrap under `value`. No real tool input is an empty struct — a no-arg tool
   spells `Schema.Void` or omits `input`, both of which are handled — so no
   speculative special case was added. Recorded here so it is a known gap rather
   than a surprise.
6. **`website/src/content/surface/ref-surface-mcp.mdx` was NOT updated.** §7 is
   a public-API break list; PLAN W6 owns "examples + website surface reference
   MDX", and `.claude/rules/surface-reference.md` is satisfied by the PR, not by
   this commit — the same disposition S3 §10.2 took, for the same reason (the
   rest of the shared API is being rewritten concurrently in this worktree).

---

## 6. Asks of the reconcile pass / later waves

1. **`@kolu/surface/src/firstFrame.ts` is dead on arrival for a `Stream`-shaped
   face.** `firstFrameOrThrow` collapses to `Stream.runHead` + `Option`;
   `firstFrameOfCollectionItem` collapses to the three-arm `Effect.raceAll` now
   living in `surface-mcp/src/server.ts` (`readCollectionItemSnapshot`). That
   race belongs back in the framework, beside the held-open-`get` footgun it
   guards — **please graduate it**, and note the `raceAll`-ignores-failures
   subtlety in §3.2 when you do. Its other consumers (`kaval-tui/src/attach.ts`,
   `padi-tui/src/read.ts`) are W5 and will need the Stream-native twin too.
2. **`packages/kolu-mcp`** consumes `BespokeTool.input` with zod schemas
   (`screenText.ts`, `sendInput.ts`, `wait.ts`, `expose.ts`, `serve.ts`). It is
   already on W3's list; note that its `.describe()` calls become
   `.annotate({ description })`, and that every MCP-facing numeric must become
   `Schema.Finite`/`Schema.Int` (or ride the converter's normalization).
3. **W6**: drop `zod` from `packages/surface-mcp/package.json` (nothing in `src/`
   imports it any more), and refresh `ref-surface-mcp.mdx` from §7.

---

## 7. Public API breaks (additions to the drishti / odu follow-up list)

1. `toInputSchema(schema?)` / `inputSchema(schema?)` take a `WireSchemaAny`
   (Effect Schema), not a `ZodType`.
2. `ResourceTemplateEntry.keySchema` is a `WireSchemaAny`.
3. `BespokeTool.input` is an Effect Schema. **New export
   `ToolInputSchema<I>`**.
4. `ClientOrConnection` / `ServeSurfaceAsMcpOptions.client` now hand back a
   `buildSurfaceFace`-shaped client (streaming verbs return `Stream`, unary verbs
   return `Promise`), not an oRPC `ContractRouterClient`. **`SurfaceClientCallable`
   and `ClientOrConnection` are now exported from the package root** so a
   consumer can name the shape it must supply.
5. `PusherDeps.stream` (`StreamFor<Client>`) is
   `(client, uri) => Stream | undefined` — the `signal` parameter and the
   `Promise`/`AsyncIterable` return are gone.
6. A `ResourcePusher` detach/stop now interrupts live subscription fibers (§4.2).
7. A `tools/call` on an EXPOSED PROCEDURE no longer propagates the MCP request's
   cancellation (§3.3). A bespoke tool handler's `AbortSignal` parameter is
   unchanged.
8. `serveSurfaceAsMcp`'s own signature, `resolveExpose`, `ExposeMap`,
   `ToolExposure`, `ResourceEntry`, `ToolEntry`, `ResolvedExpose`, the URI
   helpers and `ToolResult` are all **unchanged**.

`package.json` was not edited, so PLAN standing rule 5 does not fire for this
package.

---

## 8. Gate

```
pnpm --filter @kolu/surface-mcp typecheck      → ZERO errors (tsc 7.0.2)
pnpm --filter @kolu/surface-mcp test:unit      → 5 files, 69 tests, ALL GREEN
    jsonschema.test.ts 17 · expose.test.ts 11 · pusher.test.ts 10
    server.test.ts     25 · compose.test.ts     6
biome lint --error-on-warnings packages/surface-mcp   → clean (14 files)
biome format packages/surface-mcp                     → clean (scoped write, so a
    concurrently-edited sibling package is never written under another agent)
grep for `zod` / `@orpc` imports in src/                → NO hits
```

Test-count deltas (nothing was deleted; the count went 5 files / 57 → 5 / 69):

| file | delta |
|---|---|
| `jsonschema.test.ts` | 11 → 17. New: the `Void`/`Undefined` pin (divergence 3), the two `default`-placement pins (divergence 4), the open-objects pin (divergence 1), the numeric-normalization pin + its "lookalike union left alone" negative, the opaque-declaration degradation, and the BYTE FIXTURE. The `z.date()` test became the Date-as-wire-form pin. |
| `expose.test.ts` | 10 → 11. New: a no-input procedure advertises an empty object end-to-end through `resolveExpose`. |
| `pusher.test.ts` | 9 → 10. New: a detach interrupts every live subscription fiber. |
| `server.test.ts` | 23 → 25. New: a bespoke tool whose args fail its schema returns `isError` (the `decodeUnknownSync` edge), and a member that resolves NO streaming source throws (the other half of the dropped-bridge shape). |
| `compose.test.ts` | 6 → 6, unchanged in kind — but now proves the composition over `directDispatch` + `buildSurfaceFace`, i.e. the exact face a wire link mints. |

---

## 9. Nothing here invalidates a PLAN assumption

- **D8** is fully implemented, with item 4 re-grounded on measurement (§1.1) and
  item 2 strengthened from an authoring rule into a converter guarantee.
- **#14**'s "keep `jsonschema.test.ts`'s assertions as the gate rather than
  re-snapshotting them away" is honoured: the only assertion that moved is the
  `z.date()` one, replaced by two stronger pins with the reason stated in the
  test.
- **D10/#18** is closed inside the package: no `AbortSignal` reaches a surface
  call; the one residual is the bespoke-handler parameter, which is the
  consumer's vocabulary by design (§3.3).
- **D2/#13** holds — the face decodes procedure/stream/event inputs at its edge,
  which is why the MCP host's raw JSON arguments can be forwarded verbatim.
- **#25**'s edge discipline: two framework-owned `Effect.run*` sites, both named
  in code (§3.4).
- No `package.json` `dependencies` block changed, so standing rule 5 does not
  fire.

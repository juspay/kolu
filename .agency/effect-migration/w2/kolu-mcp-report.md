# W5 — `kolu-mcp` on the Effect client tier

Scope delivered: the whole package — `screenText.ts`, `sendInput.ts`, `wait.ts`,
`serve.ts`, plus `wait.test.ts` rewritten onto the Stream-shaped client and a NEW
`argSchemas.test.ts`. `expose.ts` and `index.ts` needed no change. **Zero `zod`
and zero `@orpc/*` imports remain in `src/`** (the only surviving occurrence of
the word is one comment in `argSchemas.test.ts` recording what the blurb used to
be). `package.json` is untouched — `zod` is still declared there and is now
unused; W6 owns the removal.

Every API fact below was measured against the installed `effect@4.0.0-beta.102`
and compiled with the repo's own `typescript@7.0.2`.

---

## 1. The three arg schemas — and the annotation trap that nearly ate every blurb

The brief was "`.describe` → Schema annotations that surface-mcp's new jsonschema
converter renders as descriptions — verify the annotation key it reads." The key
is `description`, which `Schema.toJsonSchemaDocument` passes through verbatim
(`effect/src/JsonSchema.ts:318`). Verifying it turned up a second, unadvertised
placement rule that matters more than the key does.

### 1.1 ANNOTATE FIRST, CHECK SECOND — the measured law

`SchemaAST.annotate` (`effect/src/SchemaAST.ts:3136`) does **not** annotate the
node when the schema already carries a check:

```ts
export function annotate<A extends AST>(ast: A, annotations): A {
  if (ast.checks) {
    const last = ast.checks[ast.checks.length - 1]
    return replaceChecks(ast, Arr.append(ast.checks.slice(0, -1), last.annotate(annotations)))
  }
  …
}
```

It rewrites the LAST CHECK. The converter then emits a check's annotations inside
an **`allOf` branch**, which is legal draft-2020-12 and which no MCP host reads as
the property's description. Measured, on the real converter:

| spelling | emitted property node |
|---|---|
| `Schema.Number.annotate({description}).check(Schema.isInt())` | `{"description":"blurb","type":"integer"}` ✅ |
| `Schema.Int.annotate({description})` | `{"type":"integer","allOf":[{"description":"blurb"}]}` ❌ |
| `Schema.Int.check(isGreaterThan(0)).annotate({description})` | `{"type":"integer","allOf":[{"exclusiveMinimum":0,"description":"blurb"}]}` ❌ |
| `…check(…).annotateKey({description})` | `{"type":"integer","allOf":[{"exclusiveMinimum":0},{"description":"blurb"}]}` ❌ |

The trap has teeth precisely because `Schema.Int` **is** `Schema.Number.check(isInt())`
— i.e. the spelling D8/#14 divergence 2 tells an author to reach for is already
"checked", so the obvious `Schema.Int.annotate({ description })` silently loses
the blurb. Nothing fails; the agent just stops being told what `tail` counts.

So every described-and-checked field in this package is spelled
`Schema.Number.annotate({ description }).check(Schema.isInt(), …)`: the blurb
lands on the node, and `isInt` still makes the field advertise as `integer`
rather than as the Infinity/NaN-tolerant union. The law is stated in
`wait.ts`'s `MillisecondsSchema`, cross-referenced from `screenText.ts` and
`sendInput.ts`, and pinned by a test that asserts BOTH the winning spelling and
the losing one — the same discipline `jsonschema.test.ts` applies to the
`default` keyword, and for the same reason (a silent loss is invisible in a
decode test).

`Schema.String` is check-free, so `sendInput.ts`'s `text`/`key` blurbs need only
the plain `.annotate`. The `optionalKey`-placement law (annotation INSIDE the
wrapper, on the encoded-side node) is honoured everywhere.

### 1.2 The mapping, field by field (#17)

These are MCP tool arguments — a host's JSON, decoded in-process by
`Schema.decodeUnknownSync` inside `surface-mcp`'s bespoke dispatch. They are not
a persisted or daemon-wire format, but the #17 rule still applies literally:
every zod `.optional()` became `Schema.optionalKey`, never `Schema.optional`.
No field had a `.default(...)`, so `withDecodingDefaultKey` never comes up.

| field | before | after |
|---|---|---|
| `screenText.tail` | `z.number().int().positive().optional().describe(…)` | `Schema.optionalKey(Schema.Number.annotate({description}).check(isInt, isGreaterThan(0)))` |
| `sendInput.text` / `.key` | `z.string().optional().describe(…)` | `Schema.optionalKey(Schema.String.annotate({description}))` |
| `wait.*.timeoutMs` | `z.number().int().positive().max(MAX_TIMER_MS).optional().describe(…)` | `Schema.optionalKey(MillisecondsSchema(…))` |
| `wait_outputSettled.idleMs` | same, REQUIRED | `MillisecondsSchema(…)` (required) |
| `wait_agentState.until` | `z.array(z.enum(WAIT_STATES)).nonempty().describe(…)` | `Schema.Array(Schema.Literals(WAIT_STATES)).annotate({description}).check(Schema.isNonEmpty())` |
| `id` (all four) | `TerminalIdSchema` | unchanged — terminal-vocab already ships it as `Schema.String.check(Schema.isUUID())` |

`z.infer<…>` → `typeof …Schema.Type` throughout. The decoded shapes gain
`readonly` modifiers (S3), which no call site minded.

### 1.3 What the emitted JSON Schema actually changed

`argSchemas.test.ts` carries a **byte-level fixture** for `screen_text`'s document
(hit-list rule 3). Two shape deltas from the zod era, both structural to Effect's
converter and neither a loss of meaning:

1. **Checks emit into `allOf`.** `tail` is
   `{"description":…,"type":"integer","allOf":[{"exclusiveMinimum":0}]}` where zod
   emitted `{"type":"integer","exclusiveMinimum":0,"description":…}`. Same
   constraint, one nesting level down. The base type and the description stay at
   the top, which is what a host renders.
2. **`TerminalIdSchema` now advertises its UUID pattern**
   (`allOf:[{pattern:…, format:"uuid"}]`) where zod's `z.uuid()` emitted only
   `format:"uuid"`. Strictly more information for the host.

`wait_agentState.until` emits `items:{"type":"string","enum":[…]}` (zod emitted
the bare enum) plus `allOf:[{minItems:1}]`. Objects stay OPEN — the fixture
asserts no `additionalProperties`, so `surface-mcp`'s divergence-1 fix is
verified end-to-end from this package too.

---

## 2. `wait.test.ts` — the harness on the Stream-shaped face

Two forced rewrites, one restated pin.

### 2.1 The fake client mints `Stream`s, and the fake had to become interruptible

`PadiSurfaceClient`'s stream verbs now return a lazy `Stream` synchronously with
no `AbortSignal` option, so the fake's `.get()`/`.keys()` return
`FakeStream.stream()`.

The first attempt used `Stream.fromAsyncIterable` over the existing async
generator, and **every open-ended test hung**. The reason is worth recording: a
generator parked in `await waitNext()` cannot be resumed by `iter.return()`, so
`iterateUntilAborted`'s teardown never unwinds the watcher — and `runWait`
*awaits its watchers* before resolving, so a settled outcome never returns. The
old harness got away with it only because it resolved its waiters from an
`AbortSignal` listener, which no longer exists.

The fake is therefore a `Stream.callback` with an `Effect.acquireRelease`
subscription: teardown is scope closure, which is synchronous and cannot be
parked. It also counts releases (`torn`), which the restated PIN below needs.

### 2.2 The lost-feed bound, restated on the Effect axis

The old PIN — "`settleOnLostFeed`'s `terminals.keys` read is bounded by
`ctx.signal`" — spied on an option that no longer exists (a member verb has no
`signal`). Deleting it would have dropped the hazard, so it is restated as the
hazard itself: with the attach feed ended and the `keys` stream **never
yielding**, the wait must still settle on its `timeoutMs` AND release the keys
subscription (`torn === 1`). That is exactly the unbounded-tail hang the original
guarded, expressed through interruption instead of through a threaded signal.

### 2.3 Dead transport is a tagged error now

`deadTransportError("SURFACE_STDIO_TRANSPORT_CLOSED", …)` (gone from
`@kolu/surface/client`) → `new SurfaceStdioTransportClosed({ reason })` from
`@kolu/surface/errors`, delivered as `Stream.fail(dead)`. The assertion is
unchanged and still the strong one: `rejects.toBe(dead)` — the identical
instance propagates, never folded into `closed`.

---

## 3. `screenText.ts` / `sendInput.ts` — the AbortSignal seam (D10/#18)

Both handlers dropped their third parameter. `client.surface.screen.text({id},
{signal})` → `client.surface.screen.text({id})`; likewise
`lifecycle.sendInput`. This is the behaviour change `surface-mcp`'s report §3.3
already declared for exposed procedures, now true for these two bespoke tools as
well: cancelling a `tools/call` no longer cancels the underlying padi procedure.
Both are single-round-trip unary calls with no streaming leg, so what is lost is
the ability to abandon an in-flight request early, not the ability to abandon a
long subscription.

The `wait_*` handlers **keep** their `signal` and pass it to
`awaitOutputSettled`/`awaitAgentState` verbatim — those are `runWait`-scaffolded
primitives that still speak `AbortSignal` (padi owns the Stream↔AbortSignal
translation in `watch.ts`'s `iterateUntilAborted`), and that signal is the MCP
request's own cancellation. Nothing to change and nothing lost: a wait is the one
tool here that genuinely blocks.

---

## 4. `serve.ts`

Compiles unchanged against the new `serveSurfaceAsMcp`: `KoluMcpConnection`
(`{ client: PadiSurfaceClient; dispose }`) already IS the `ClientOrConnection`
shape the adapter now asks for, because `PadiSurfaceClient` is a
`buildSurfaceFace` face. Only the docblock moved, to name the two shape changes a
reader of this file will now see downstream (streams are lazy `Stream`s;
no `AbortSignal` option anywhere).

`KOLU_MCP_TOOLS: Record<string, BespokeTool>` still type-checks: `BespokeTool`'s
`input` is now `ToolInputSchema<unknown>` and each tool's handler keeps the
existing `args as XArgs` narrowing. Parameterizing each entry
(`BespokeTool<ScreenTextArgs>`) was tried and rejected — under
`strictFunctionTypes` a `handler: (args: ScreenTextArgs) => …` is not assignable
to the `Record<string, BespokeTool>` the registry and `serveSurfaceAsMcp` are
typed with, so it would trade one cast for a worse one at the registry.

---

## 5. Deviations / judgement calls

1. **The `allOf`-burial fix is an AUTHORING law here, not a converter change.**
   Hoisting a check's `description` to the node would be a change to
   `surface-mcp/src/jsonschema.ts`, a sibling package under concurrent edit, and
   it is arguably the author's call where an annotation lands. The mechanical
   backstop for THIS package is `argSchemas.test.ts`, which asserts the
   top-level `description` for every blurbed field of all four tool schemas. See
   §7 for the ask.
2. **The `ctx.signal` PIN was restated, not deleted** (§2.2). Its title changed;
   it is not one of the three ledger-frozen padi test files (#24), and it lives
   in `kolu-mcp`, so no `coverage-ledger.yaml` row is implicated.
3. **`expose.ts` was not touched.** Its `ExposeMap<PadiSurfaceSpec>` and the
   named-denial table are schema-free and resolve against the migrated
   `padiSurface.spec` unchanged — `expose.test.ts` (11 assertions, including the
   live in-memory served face) passes as-is, which is the proof.
4. **`package.json` untouched**, so PLAN standing rule 5 does not fire. Two
   stale declarations are left for W6: `zod` (now unused) and
   `@effect/platform-node` (declared since W1, never imported by `src/`).

---

## 6. Test-count delta

Nothing was deleted. 4 files / 29 tests → **5 files / 35 tests**.

| file | delta |
|---|---|
| `argSchemas.test.ts` | **NEW, 6 tests**: the annotate-first/check-second law (winning + losing spelling), the `screen_text` BYTE FIXTURE, `sendInput`'s two blurbs, the wait tools' bounded-integer pin, the `until` enum pin, and "no tool input is CLOSED". |
| `wait.test.ts` | 11 → 11. Harness rewritten (§2); the `ctx.signal` PIN restated as a bounded-lost-feed PIN. |
| `screenText.test.ts` (5) · `sendInput.test.ts` (6) · `expose.test.ts` (7) | unchanged. |

---

## 7. Asks of later waves

1. **`surface-mcp` — consider hoisting a check's `description` (and `title`) out
   of `allOf` in `jsonschema.ts`'s walk.** The trap in §1.1 will bite every
   future author of an MCP-facing schema, and it fails silently. The
   surface-mcp report's own §5.2 argument for normalizing `Schema.Number` in the
   converter rather than by authoring rule applies here verbatim. If it is
   hoisted, this package's `allOf` expectations (the byte fixture, the
   milliseconds bounds, the `until` `minItems`) are the assertions to update —
   they are deliberately explicit rather than snapshotted, so the diff will show
   exactly what moved.
2. **W6**: drop `zod` and (unless something starts importing it)
   `@effect/platform-node` from `packages/kolu-mcp/package.json`; per standing
   rule 5, refresh `nix/workspace.nix:178` and re-check `default.nix`
   stableLeaves in the same commit.

---

## 8. Gate

```
pnpm --filter kolu-mcp typecheck                  → ZERO errors (tsc 7.0.2)
pnpm --filter kolu-mcp test:unit                  → 5 files, 35 tests, ALL GREEN
    argSchemas.test.ts 6 · expose.test.ts 7 · screenText.test.ts 5
    sendInput.test.ts  6 · wait.test.ts    11
biome lint --error-on-warnings packages/kolu-mcp  → clean (13 files)
biome format packages/kolu-mcp                    → clean (scoped write)
grep for `zod` / `@orpc` imports in src/           → NO hits
```

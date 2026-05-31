---
title: "Announcing @kolu/surface: typed reactive state for SolidJS + oRPC"
description: "A small framework that owns the snapshot+deltas wire protocol so your Solid client and oRPC server stop hand-rolling it. Five primitives, one declaration, contract derived end-to-end."
pubDate: 2026-05-04
author: "Sridhar Ratnakumar"
---

[`@kolu/surface`](https://github.com/juspay/kolu/tree/master/packages/surface) is a small framework for SolidJS clients backed by an oRPC streaming server. **Declare the reactive surface of your app once; the framework derives the typed contract, the server router, and the client hooks from a single spec.** It owns the wire protocol — snapshot+deltas, retry-on-reconnect, per-channel pub/sub — so your domain code stops referencing channel names, store keys, retry contexts, or oRPC procedure refs.

It was extracted from [Kolu](https://kolu.dev) and now ships as a workspace-private package alongside it. This post walks through why the framework exists, the five primitives it offers, the API for defining and implementing a surface, the runnable example, and how Kolu itself uses it.

## Why: electricity

In [_Righting Software_](https://www.amazon.com/Righting-Software-Method-Engineering-Architecture/dp/0136524036), Juval Löwy argues that infrastructure should feel like the **electricity** in a building: invisible, ubiquitous, plugged into via simple sockets. Domain code is the appliance you swap. The wiring stays put. **Volatility-based decomposition** is the discipline of deciding which is which. (The analogy is also developed in the [InformIT excerpt](https://www.informit.com/articles/article.aspx?p=2995357&seqNum=2) of Chapter 2 if you want a free read.)

Kolu's client had a dozen call sites doing the same thing: subscribe to an oRPC streaming RPC, lift the AsyncIterable into a Solid `Accessor`, reconcile new values into a local store, dispatch errors to a toast. Its server had the mirror image: hand-rolled `yield current; for await (ev of subscribeSystem(...)) yield ev` loops in every streaming handler, plus the parallel `publishSystem("X:changed", value)` write path threaded through every domain mutation.

The pattern was obvious enough that I'd been writing it for weeks. It also turned out to have **no Kolu-specific decision in any of it.** The schema varied. The procedure name varied. The `(channel, payload type)` pair varied. Everything else — the snapshot-then-deltas frame ordering, the retry context, the publish-then-subscribe symmetry, the reconcile-vs-assign branch on the store write — was electricity.

That's the bar for extraction: **what would I extract as utility before I'd accept any of these per-call-site fixes?** When the answer is "all of it," the question stops being _is this snippet clean?_ and becomes _is the snippet at the right altitude?_ The framework is the answer to the second question.

## The surface package

`@kolu/surface` exposes **five primitives**. Each captures a structurally distinct shape that bites at runtime if collapsed into a single primitive:

| Primitive | The question it answers | Cardinality | Persistable | Mutable from client | Has current value |
|-----------|-------------------------|-------------|-------------|---------------------|-------------------|
| `Cell<T>` | "What's the current X?" | One singleton | Optional | Yes | Yes |
| `Collection<K,T>` | "What's the current X for each key K?" | Many, keyed | Optional | Yes | Yes (per key) |
| `Stream<I,T>` | "What's the live output for input I?" | One per input combo | Never | No (read-only) | Yes |
| `Event<I,T>` | "Has X happened yet?" | Occurrences over time | Never | No (read-only) | **No** — handler-based |
| `Procedure` | "Run this side-effect on the server" | Per call | n/a | Yes (RPC) | n/a |

Cell, Collection, and Stream are *state* — there's a current value the consumer renders. Event is *occurrence* — a handler fires per yield, no current value to read. Procedure is *imperative* — a request/response RPC bound to the same surface namespace as the reactive primitives.

The vocabulary borrows from [reflex-frp](https://github.com/reflex-frp/reflex)'s `Dynamic` / `Incremental` / `Event` lattice, translated to an oRPC wire boundary. The structural difference between Cell and Stream comes from there directly: **Cells are identities over time** (same logical entity, value evolves; you can `set` one), while **Streams are functions being re-evaluated** (server-derived from external state — git, fs, network — that the framework doesn't own; you can't `set` one without becoming the cache).

Anything genuinely outside these shapes — bidirectional binary streams, custom retry plumbing — stays as raw oRPC, accessed via a one-line `streamCall(client.X.Y, input, opts)` escape hatch that threads the same retry context the hooks use.

## The API

A surface is declared in three places — common, server, client — each layer derived from the same spec.

```
common/  defineSurface({ cells, collections, streams, events, procedures })  ─┐
                                  │                                           │ contract
                                  ▼                                           │ derived
server/  implementSurface(surface, { channel, cells, collections, … })  ◀────┘
                                  │
                                  ▼
client/  surfaceClient(surface, { transport })
                ├─ rpc            (raw oRPC client, retry-wired)
                ├─ cells          (.use, .upsert, .patch)
                ├─ collections    (.use, .upsert, .remove)
                ├─ streams        (.use)
                └─ events         (.use)
```

### Define (`common/surface.ts`)

```ts
import { defineSurface } from "@kolu/surface/define";
import { z } from "zod";

const NoteIdSchema = z.string();
const NoteSchema = z.object({
  id: NoteIdSchema,
  title: z.string(),
  body: z.string(),
  updatedAt: z.number(),
});
const EditorPrefsSchema = z.object({
  fontSize: z.number().int().min(10).max(32),
  theme: z.enum(["light", "dark"]),
});

export const surface = defineSurface({
  cells: {
    prefs: {
      schema: EditorPrefsSchema,
      default: { fontSize: 16, theme: "light" },
      patchSchema: EditorPrefsSchema.partial(),
      patch: (current, p) => ({ ...current, ...p }),
    },
  },
  collections: {
    notes: { keySchema: NoteIdSchema, schema: NoteSchema },
  },
  streams: {
    search: {
      inputSchema: z.object({ query: z.string() }),
      outputSchema: z.object({ matches: z.array(NoteIdSchema) }),
    },
  },
  events: {
    autosave: {
      inputSchema: NoteIdSchema,
      outputSchema: z.object({ noteId: NoteIdSchema, savedAt: z.number() }),
    },
  },
  procedures: {
    notes: {
      // Imperative escape hatch — id minted server-side, so it doesn't
      // fit the collection's `upsert`-with-key shape.
      create: { input: z.object({ title: z.string() }), output: NoteSchema },
    },
  },
});

// `surface.contract` is a typed oRPC router built statically from the
// spec — no parallel literal to maintain. Use it on both sides:
//   server: const t = implement(surface.contract);
//   client: websocketLink<typeof surface.contract>(ws);
```

A single mapped helper `SurfaceTypes<typeof surface.spec>` lifts the runtime types out of the spec, so consumers reach for `SF["cells"]["prefs"]["Value"]` instead of maintaining a parallel set of `z.infer` aliases. The spec is the single source of truth for schemas, defaults, and types.

### Implement (`server/surface.ts`)

```ts
import {
  confStore,
  implementSurface,
  publisherChannel,
} from "@kolu/surface/server";
import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import { surface } from "common/surface";

const publisher = new MemoryPublisher();

export const { router, ctx } = implementSurface(surface, {
  channel: <T>(name: string) => publisherChannel<T>(publisher, name),

  cells: {
    prefs: { store: confStore(conf, "prefs") },
  },
  collections: {
    notes: {
      readAll: () => allNotes(),
      upsert: (id, note) => upsertNote(id, note),
      remove: removeNote,
    },
  },
  streams: {
    // Poll-on-event shape: the framework synthesizes the snapshot +
    // install + re-read + isEqual loop internally.
    search: {
      read: async ({ query }) => ({ matches: searchNotes(query) }),
      install: (_input, cb) => onNotesChange(cb),
      isEqual: (a, b) => a.matches.join(",") === b.matches.join(","),
    },
  },
  events: {
    autosave: {
      // Single-yield-then-close: forward a per-input channel.
      source: (id, signal, { bus }) => bus.subscribe(signal),
    },
  },
  procedures: {
    notes: {
      create: async ({ input, ctx }) => {
        const note = { id: newId(), title: input.title, body: "", updatedAt: Date.now() };
        ctx.collections.notes.upsert(note.id, note);
        return note;
      },
    },
  },
});

// Spread `router` into a host `t.router({...})` alongside any hand-written
// raw-oRPC blocks; import `ctx` from domain modules for typed mutations:
//   ctx.cells.prefs.set(next)
//   ctx.collections.notes.upsert(id, value)
//   ctx.events.autosave.publish(noteId, payload)
```

`implementSurface` returns `{ router, ctx }`. The `ctx` is the typed mutation surface domain code uses to write through the framework — every mutation flows through one apply+publish chain, so there's no parallel `store.set + bus.publish` path that can drift.

For Streams, the framework absorbs two common shapes. The poll-on-event form (above) is for state the server doesn't own — files, git refs, anything that fires "something changed" without telling you what. Provide `read` + `install` + `isEqual` and the framework handles snapshot-then-deltas, equality-suppression, and reconnect. Or provide a raw `source: (input, signal) => AsyncIterable<T>` for cases that don't fit poll-on-event.

### Consume (`client/wire.ts`)

```ts
import { surfaceClient } from "@kolu/surface/solid";
import type { ContractRouterClient } from "@orpc/contract";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import { surface } from "common/surface";

const ws = new PartySocket(`wss://${host}/rpc/ws`);

export const app = surfaceClient<
  typeof surface.spec,
  ContractRouterClient<typeof surface.contract, ClientRetryPluginContext>
>(surface, { websocket: ws });

// In components — bound `.use()` hooks drop source/mutate/keyToInput
// from the per-call args; the surface supplies them.
const prefs = app.cells.prefs.use({
  authority: "local",
  initial: DEFAULT_PREFS,
});
const notes = app.collections.notes.use();
//   notes.keys()         — Accessor<NoteId[]>, defaults to the server's keys stream
//   notes.byKey(id)?.()  — Subscription<Note> per key
//   notes.upsert(k, v)   — bound mutation (also at app.collections.notes.upsert)
const search = app.streams.search.use(
  () => ({ query: query() }),
  { onError: (err) => toast.error(`Search failed: ${err.message}`) },
);
app.events.autosave.use(
  selectedId,
  (payload) => flashSavedToast(payload),
  { onError: (err) => console.error(err) },
);

// Imperative procedures go through `app.rpc` under the `surface.*` namespace:
const note = await app.rpc.surface.notes.create({ title: "Untitled" });
```

The bound `.use()` shape is the headline ergonomic win. Compared to passing procedure refs at every call site, the surface client pre-binds each primitive to its oRPC entry, drops the wire-identity args, and threads `STREAM_RETRY` context internally. The hooks **own the snapshot+deltas reconcile path**, the per-key reactive lifecycle (via `mapArray`), the local-authority optimistic merge (for cells with `authority: "local"`), and the resubscribe-on-reconnect cleanup.

## What the framework absorbs

So you don't write any of these per call site:

- **Snapshot+deltas wire protocol** — every server handler yields a fresh full snapshot first, then deltas; the streaming retry plugin re-invokes the source on every reconnect, so the new iterator's first yield replaces stale client state. Get this wrong and reconnects silently lose state.
- **Retry context** — `ClientRetryPlugin` parameterized at both `RPCLink` and `ContractRouterClient` so per-call `{ context }` options type-check; the hooks thread `STREAM_RETRY` (infinite retry on transport, propagate `ORPCError`) automatically.
- **Per-key channels** — `Channel<T>.publish(v)` / `.subscribe(signal)` / `.consume({ onEvent, onError })`. Channel names derive from the surface key; domain code never types `"X:changed"`.
- **Reconcile vs assign** — primitives get plain assignment; objects/arrays go through Solid's `reconcile` for fine-grained reactivity.
- **Per-collection lifecycle** — `useCollection` runs `mapArray` over the live key set; each key gets its own reactive owner, automatically disposed when the key leaves.
- **Local authority's "ignore subsequent echoes"** — `useCell` with `authority: "local"` reconciles the first server yield, then ignores the subscription so an unrelated event piggybacking on the same channel doesn't stomp a just-made client write whose RPC hasn't round-tripped yet.

## The runnable example

`packages/surface/example/` is a minimal in-memory notes app demonstrating all five primitives end-to-end. ~500 LOC across server + client + common; single-file `App.tsx` with every hook visible; SolidJS + Tailwind v4. Self-contained — no Kolu-internal imports, just `@kolu/surface/{*}` plus the standard oRPC + Hono + Vite stack.

```sh
just surface-example
```

Enters the Nix devshell and starts the Hono server (port 7700) plus Vite dev server (port 5174) in parallel.

| Primitive | What the example demonstrates |
|---|---|
| `Cell<EditorPrefs>` | Editor preferences (font size, theme). `authority: "local"` for instant-UI mutation; `applyPatch` defaulted from the spec's `patch` so server and client merge with the same function. |
| `Collection<NoteId, Note>` | Notes keyed by id. Sidebar list with per-key reactive lifecycle. `notes.upsert` / `notes.delete` are framework-bound; `notes.create` is an imperative procedure that mints the id server-side. |
| `Stream<{query}, SearchResult>` | Full-text search, one-shot per query. `useStream` re-subscribes on input change; the server runs the source once and closes. Demonstrates the raw `source` shape. |
| `Event<NoteId, AutosaveEvent>` | "Saved" flash beside the active note title. Per-id channel; the autosave debounce in the server publishes to it; the client's `useEvent` handler triggers the flash. |
| `Procedure` | `notes.create` — the imperative escape hatch for verbs the primitives can't model (id minting, cross-primitive coordination). |

The example existed first as a tractable substrate for iterating on the framework itself. **The discipline is that any framework change has to land on the example before it touches Kolu.** That keeps the API decisions visible end-to-end at 500 LOC instead of buried in Kolu's hundred-file consumer codebase.

## How Kolu uses it

Kolu has 10 typed primitives plus a handful of imperative procedures and raw streaming shapes. Every server-pushed reactive surface in Kolu maps to one entry in `packages/common/src/surface.ts`.

### Cells

| Descriptor | Backs | Authority | Persistence |
|---|---|---|---|
| `preferences` | User preferences (theme, scrollLock, sound, right-panel state, …) | `local` | `confStore("preferences")` |
| `terminalList` | Live terminal list — drives the pill tree, canvas tile set, mobile swipe order | `server` | `inMemoryStore` (registry is canonical) |
| `activityFeed` | Recent repos cd'd into + recent agent CLIs spotted via OSC 633;E | `server` | `confStore("activityFeed")` |
| `session` | Last-persisted snapshot of terminals + active id (drives session restore) | `server` | `confStore("session")` |

### Collections

| Descriptor | Backs |
|---|---|
| `terminalMetadata` | Per-terminal metadata (cwd, git, PR, agent state, foreground process) — each terminal's tile chrome and inspector reads its own key |

### Streams

| Descriptor | Backs |
|---|---|
| `gitStatus` | Code-view's Local/Branch mode file list (changed files) |
| `gitDiff` | Code-view's unified diff for the selected file |
| `fsListAll` | Code-view's All-mode tree (full repo path list) |
| `fsReadFile` | Code-view's All-mode body (file content) |

### Events

| Descriptor | Backs |
|---|---|
| `terminalExit` | Per-terminal one-shot exit notification — drives the exit toast and the active-terminal auto-switch |

### Raw oRPC (everything else)

Shapes that don't fit a primitive stay imperative — terminal lifecycle (`create`/`kill`/`resize`/`sendInput`/...), git mutations (`worktreeCreate`/`worktreeRemove`), screen queries, and the bidirectional binary `terminal.attach` stream. They live in a hand-written `oc.router({...})` alongside `surface.contract`. The composition is one spread:

```ts
export const contract = oc.router({
  ...surface.contract,
  terminal: rawTerminalContract,  // hand-written for terminal.attach + friends
});
```

### What disappeared from Kolu

The framework absorbed roughly 800 lines of plumbing across client and server:

- **Zero** call sites of `createSubscription` / `createReactiveSubscription` outside `@kolu/surface/solid`.
- **Zero** hand-rolled `yield X; for await (ev of subscribeSystem_(...)) yield ev` loops in `router.ts`.
- **Zero** `publishSystem("X:changed", value)` or `publishForTerminal(channel, id, v)` calls — every server-side publish flows through a typed `Channel<T>`.
- **Zero** `import { stream }` or hand-threaded `STREAM_RETRY` in client code — the bound layer threads context internally.
- **Zero** `pollOnEvent` wrappers per stream — declarative `{ read, install, isEqual }` synthesizes inside the framework.
- **Zero** `AbortController + consumeChannel` plumbing in meta providers — `Channel.consume` owns the controller and returns the cleanup.

Adding a new cell in Kolu now touches **two files**: the descriptor in `packages/common/src/surface.ts`, the wiring in `packages/server/src/surface.ts`. The client gets it for free via `app.cells.X.use(...)`.

## What the framework deliberately doesn't do

Kolu is single-client per session. The framework doesn't carry plumbing it doesn't need:

- **No `Behavior`-style pull-only sampling.** Reflex's `Behavior t a` is a function `t -> a` you sample without subscribing. In a Solid client we have closures and `createMemo`; nothing the framework ships needs to model "value at time t" as a separate concept.
- **No cross-network query machinery.** Reflex's `Group q` / `crop` / `SelectedCount` story (used in Obelisk / Focus) pays off when 100 clients are watching the same key. Single-client kolu doesn't have that problem; refcounting + crop projections would be plumbing without payback.
- **No monadic Dynamic composition.** Reflex composes `Dynamic`s into bigger `Dynamic`s monadically (`bind`, `joinDyn`, `holdDyn`). We expose Solid's primitives (`createMemo`, `on`, `derive`) for that — the framework's job stops at the wire boundary.
- **No one-primitive-fits-all.** Cell/Collection/Stream/Event are split because the type-level distinctions encode domain invariants the type system enforces. A `Stream` is read-only and never persisted; an `Event` has no current value to render; `Cell.default` is one canonical seed shared across consumers. Collapsing those would move invariants from compile-time enforcement to runtime convention.

## Where it goes from here

> **Status: internal-use only.** `@kolu/surface` is workspace-private and shipped alongside Kolu, not as a standalone package. The API is still settling — the recent passes already deleted `mergeIntoStore` (consumer escape hatch absorbed into a flat-shape schema), absorbed `pollOnEvent` (per-stream wrapper became a declarative `{ read, install, isEqual }`), and folded `consumeChannel` into `Channel<T>.consume`. Each was a "thing the framework was half-providing"; expect more of the same. Don't reach for it from outside Kolu yet.

The frame for ongoing work is **subtraction, not addition**. Each iteration tries to remove a concept the consumer needs to know about. The remaining axes:

- **Further simplification.** The `build*` type-oracle helpers in `define.ts` (eight runtime-dead functions kept only for `ReturnType<typeof X>` inference) are still a pattern that could collapse if mapped types could derive from runtime entry-builders directly. The `surfaceClient` generic awkwardness (`Rpc` parameter defaulted because TS's union-resolution budget can't expand both `SurfaceContractFor<S>` and `ContractRouterClient<...>` in the same pass) is another smell that wants resolution. Schema suffix naming (`CellSpec.schema`, `CollectionSpec.keySchema`) survived from the first pass and is cheap to fix in-flight, expensive once a second consumer arrives.
- **Schema-walking for discriminated-union reconciliation.** Solid's `setStore` deep-merge can't preserve DU variant invariants without a per-path `reconcile` call, which forces consumers to pass a `mergeIntoStore` escape hatch. The framework could walk the cell's Zod schema once at registration, find every `z.discriminatedUnion` subtree, and reconcile those automatically. Kolu's only DU-shaped storage was already flattened (the right-panel `tab` field is now `activeTab` + `codeMode`), so the walker doesn't earn its keep yet.
- **Derived streams** (`{ from, compute }` over a graph dep) — designed and built once, then deleted because neither Kolu nor the example needed it. The shape is genuinely the right design for server-derived primitives; it just doesn't have a use case yet. A second consumer with a server-side derivation requirement would resurrect it.
- **Implicit dep tracking via Solid server-side.** The most ambitious axis: run Solid's reactive runtime on the server too, so a stream's `compute` body declares its inputs by reading them — same `createMemo` semantics, no `from:` prelude. That collapses the framework's surface area further but adds a runtime dep both sides have to agree on.

For now: Cell, Collection, Stream, Event, Procedure. Five shapes the framework type-system-enforces, derived from one spec, snapshot+deltas on the wire, retry-resilient. Kolu's domain code stops referencing channel names, store keys, retry contexts, or oRPC procedure refs. The framework's job is to keep shrinking the consumer's API surface, not to grow into a general-purpose library.

[`@kolu/surface` source](https://github.com/juspay/kolu/tree/master/packages/surface) · [the runnable example](https://github.com/juspay/kolu/tree/master/packages/surface/example) · [Kolu's surface declaration](https://github.com/juspay/kolu/blob/master/packages/common/src/surface.ts)

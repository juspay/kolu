# @kolu/cells

Typed reactive state cells for SolidJS clients backed by an oRPC streaming server.

Three primitives cover the majority of typed reactive state pushed from a server to a Solid client:

| Primitive | The question it answers | Cardinality | Live updates from server | Persistable | Mutable from client |
|-----------|-------------------------|-------------|--------------------------|-------------|---------------------|
| `Cell<T>` | "What's the current X?" | One singleton | Yes (push on change) | Optional | Yes |
| `Collection<K,T>` | "What's the current X for each key K?" | Many, keyed | Yes (per-key push) | Optional | Yes |
| `Stream<I,T>` | "What's the live output for input I?" | One per input combo | Yes (push on derived-state change) | Never | No (read-only) |

Anything genuinely outside these shapes — bidirectional binary streams, lifecycle events, commands, queries — stays as raw oRPC.

## Why three primitives, not one

Each captures a structurally distinct shape that bites at runtime if collapsed:

- **Cell vs Collection** — folding many keyed values into a single `Cell<Map<K,V>>` makes every subscriber re-render when any key changes. Independent peers should be observable independently.
- **Cell/Collection vs Stream** — Streams are computed views over external state (the file system, git, network) the server doesn't own. Caching them as Cells means the framework would have to invalidate state it doesn't manage.
- **Cell vs Stream** — Cells are identities over time (same logical entity, value evolves). Streams are functions being re-evaluated. The semantic difference shows up in mutation: you can `set` a Cell; you can't `set` a Stream's output without becoming the cache.

## Install

This is a workspace-private package. Wire it into both server and client packages:

```jsonc
// packages/server/package.json + packages/client/package.json
{
  "dependencies": {
    "@kolu/cells": "workspace:*"
  }
}
```

## Architecture

The library is intentionally non-magical: it does **not** auto-derive an oRPC contract via runtime reflection. TypeScript needs the contract literal at compile time for the typed client to work end-to-end. Consumers hand-list contract entries in their own `oc.router({...})` and pass the matching descriptor to the framework's helpers.

```
                  ┌─────────────────────────┐
                  │ kolu-common/cells.ts    │   Descriptors live here.
                  │   cell, collection,     │   Pure data: name, schemas,
                  │   stream descriptors    │   defaults. No runtime behavior.
                  └─────────────────────────┘
                          │              │
                          │ imports      │ imports
                          ▼              ▼
       ┌─────────────────────┐   ┌─────────────────────┐
       │ server:              │   │ client:              │
       │   cellHandlers,      │   │   createCellsClient, │
       │   collectionHandlers,│   │   useCell,           │
       │   streamHandlers,    │   │   useCollection,     │
       │   pollOnEvent,       │   │   useStream,         │
       │   confStore /        │   │   streamCall         │
       │   publisherChannel   │   │   (Solid hooks)      │
       └─────────────────────┘   └─────────────────────┘
```

## Cell

A singleton typed value. The server owns the canonical state; clients subscribe with snapshot-then-deltas semantics.

### Define

```ts
// packages/common/src/cells.ts
import { cell } from "@kolu/cells";
import { z } from "zod";

export const PreferencesSchema = z.object({
  theme: z.string(),
  shuffleTheme: z.boolean(),
  // ...
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const preferences = cell({
  name: "preferences",
  schema: PreferencesSchema,
  default: { theme: "light", shuffleTheme: false },
});
```

### Server-side handler

`cellHandlers` returns the four handler bodies a typed cell needs (`get`, `set`, `patch`, `test__set`). Persistence and pub/sub plug in via `CellStore<T>` and `ChannelBus<T>` interfaces — adapters for `conf` (`confStore`) and `@orpc/experimental-publisher` (`publisherChannel`) ship with the framework.

```ts
// packages/server/src/router.ts
import { cellHandlers, confStore, publisherChannel } from "@kolu/cells/server";
import { preferences } from "kolu-common/cells";

const handlers = cellHandlers(preferences, {
  store: confStore<Preferences>(conf, "preferences"),
  bus: publisherChannel<Preferences>(publisher, "preferences:changed"),
  patch: applyPreferencesPatch,  // (current, patch) => next
});

const t = implement(contract);
export const appRouter = t.router({
  preferences: {
    get: t.preferences.get.handler(handlers.get),
    update: t.preferences.update.handler(handlers.patch),
    test__set: t.preferences.test__set.handler(handlers.test__set),
  },
  // ...
});
```

The framework guarantees snapshot-then-deltas on `get` (yields `store.get()` first, then every value pushed to `bus`); `set`/`patch` validate, persist, and broadcast on the same bus. Swap in any `CellStore` (sqlite, redis, in-memory via `inMemoryStore(default)`) or `ChannelBus` (Redis pub/sub, NATS, etc.) without touching the handler logic.

### Client setup

The framework owns the typed-client construction so consumers never reach into framework internals. Build it once at app start:

```ts
// packages/client/src/cells.ts (kolu)
import { createCellsClient } from "@kolu/cells/solid";
import type { contract } from "kolu-common/contract";

const ws = new WebSocket(`wss://${host}/rpc/ws`);
export const client = createCellsClient<typeof contract>({ websocket: ws });
```

`createCellsClient` installs `ClientRetryPlugin` and returns the typed oRPC client. Hooks accept procedure refs (e.g. `client.preferences.get`) and thread `STREAM_RETRY` retry context internally — there's no `stream` namespace to maintain. For raw streaming RPCs that don't fit a Cell/Collection/Stream descriptor (terminal `attach`, lifecycle `onExit`), use `streamCall(procedure, input, opts)` — same retry context, escape hatch for non-descriptor shapes.

### Client-side hook

```ts
// packages/client/src/settings/usePreferences.ts
import { useCell } from "@kolu/cells/solid";
import { preferences } from "kolu-common/cells";
import { client } from "../cells";

export function usePreferences() {
  return useCell(preferences, {
    source: client.preferences.get,
    mutate: client.preferences.update,
    authority: "local",       // optimistic local apply; ignore server echoes after init
    initial: DEFAULT_PREFERENCES,
    applyPatch: (current, p) => deepMergePrefs(current, p),
  });
}
```

The hook returns:

```ts
{
  value:   () => Preferences | undefined,
  pending: () => boolean,
  error:   () => Error | undefined,
  set:     (next: Preferences) => Promise<void>,
  patch:   (p: PreferencesPatch) => Promise<void>,
  sub:     Subscription<Preferences>,
}
```

### Authority modes

- **`"server"` (default)** — server is canonical. Every server push reconciles into the local view. Mutations RPC; the resulting echo updates the view.

- **`"local"`** — local store is authoritative after init. The first server yield seeds the store; subsequent server pushes are ignored. `set` / `patch` apply locally synchronously (instant UI response), then RPC to the server. The server's echo is intentionally ignored to avoid stomping a just-made client write whose RPC hasn't round-tripped yet.

Local authority is for state where instant UI response gates re-render timing. Without it, every flip introduces a single-frame lag while the round-trip completes.

For non-shallow merges (e.g. discriminated-union nested fields), pass `mergeIntoStore` instead of (or in addition to) `applyPatch`. It receives Solid's `setStore` directly:

```ts
mergeIntoStore: (setStore, patch) => {
  if (patch.tab) setStore("rightPanel", "tab", reconcile(patch.tab));
  if (patch.collapsed !== undefined) setStore("rightPanel", "collapsed", patch.collapsed);
}
```

## Collection

A keyed dictionary of typed values. Each key is independently observable; the live key set is its own subscription.

### Define

```ts
import { collection } from "@kolu/cells";

export const terminalMetadata = collection({
  name: "terminalMetadata",
  keySchema: TerminalIdSchema,
  schema: TerminalMetadataSchema,
});
```

### Client-side hook

```ts
const meta = useCollection(terminalMetadata, {
  keys: () => terminalIds(),  // caller-provided live key set (any reactive accessor)
  valueSource: client.terminal.onMetadataChange,
  keyToInput: (id) => ({ id }),  // adapt key shape to the procedure's input shape
});

meta.keys();          // Accessor<TerminalId[]>
meta.byKey(id);       // Subscription<TerminalMetadata> | undefined
meta.byKey(id)?.();   // current value or undefined
```

`keyToInput` is required when the procedure's input shape isn't the bare key — most contracts wrap it (`{ id }`, `{ key }`, etc.). When input is the key itself, omit it.

Per-key subscriptions are managed via `mapArray` so SolidJS handles lifecycle: when a key leaves the live set, its reactive owner is disposed, the per-key subscription's `onCleanup` fires, the AbortController aborts, and the server stream tears down. No manual Map / version signals / abort plumbing required at the call site.

## Stream

A derived view computed on demand from a reactive input. Snapshot-then-deltas, never persisted.

### Define

```ts
import { stream } from "@kolu/cells";

export const gitStatus = stream({
  name: "gitStatus",
  inputSchema: z.object({ repoPath: z.string(), mode: GitDiffModeSchema }),
  outputSchema: GitStatusOutputSchema,
});
```

### Server-side: `pollOnEvent`

For streams that watch external state (git, fs), the framework provides `pollOnEvent` — a snapshot-then-deltas helper that reads on each event tick and yields only when the value changed:

```ts
import { pollOnEvent } from "@kolu/cells/server";

git: {
  onStatusChange: t.git.onStatusChange.handler(async function* ({ input, signal }) {
    yield* pollOnEvent({
      read: () => unwrapGit(getStatus(input.repoPath, input.mode, log)),
      isEqual: gitStatusOutputEqual,
      install: (cb) => subscribeRepoChange(input.repoPath, cb, log),
      signal,
    });
  }),
}
```

The initial read's exception propagates to the client (first frame); subsequent read failures retry on the next tick — a transient git error shouldn't tear down a long-lived subscription.

### Client-side hook

```ts
const status = useStream(
  gitStatus,
  () => repoPath() ? { repoPath: repoPath(), mode: mode() } : null,
  client.git.onStatusChange,
);

status();          // current GitStatusOutput | undefined
status.pending();  // true between input change and first yield
status.error();    // last subscription error
```

When the input changes, the previous subscription tears down and a fresh one starts; value resets to `undefined` between input change and first yield.

## What stays raw oRPC

Three categories don't fit any of the three primitives — keep them as plain oRPC procedures:

| Pattern | Why it doesn't fit | How to consume |
|---------|--------------------|----------------|
| Bidirectional binary streams (e.g. terminal `attach`) | Subscribe-before-yield ordering, custom retry hooks (e.g. xterm buffer reset). Not state — a protocol. | `streamCall(client.terminal.attach, { id }, { signal, onRetry })` |
| Lifecycle events (e.g. terminal `onExit`) | Single-yield-then-close, not continuous state. | `streamCall(client.terminal.onExit, { id })` |
| Commands and queries (`create`, `kill`, `worktreeCreate`, `info`) | Request/response. No subscription dimension. | `client.terminal.create(...)` directly |

`streamCall` applies `STREAM_RETRY` context (and merges in an optional `onRetry` callback) so transport drops re-subscribe transparently — same retry semantics as the descriptor-driven hooks, escape hatch for non-descriptor shapes.

## API reference

### Descriptors (`@kolu/cells`)

```ts
cell({ name, schema, default }): Cell<Name, T>
collection({ name, keySchema, schema }): Collection<Name, K, T>
stream({ name, inputSchema, outputSchema }): Stream<Name, I, T>
```

### Server (`@kolu/cells/server`)

```ts
cellHandlers(cell, { store, bus, patch?, onMutate? }): { get, set, patch, test__set }
collectionHandlers(coll, { readAll, readOne?, upsert, remove, perKeyBus, keysBus }):
  { keys, get, update, delete, test__set }
streamHandlers(stream, { source }): { get }

pollOnEvent({ read, isEqual, install, signal, onReadError? }): AsyncIterable<T>

// Storage + bus adapters
inMemoryStore<T>(initial): CellStore<T>
confStore<T>(conf, key): CellStore<T>
publisherChannel<T>(publisher, channelName): ChannelBus<T>

interface CellStore<T> { get(): T; set(v: T): void }
interface ChannelBus<T> { publish(v: T): void; subscribe(signal?): AsyncIterable<T> }
```

### Solid client (`@kolu/cells/solid`)

```ts
useCell(cell, { source, mutate?, authority?, applyPatch?, mergeIntoStore?, initial?, onError? })
useCollection(collection, { keys, valueSource, keyToInput?, onError? })
useStream(stream, inputFn, source, { onError? }?)

streamCall(procedure, input, { signal?, onRetry? }?): Promise<AsyncIterable<O>>
createCellsClient<C>({ websocket }): ContractRouterClient<C, ...>

createSubscription(source, options?): Subscription<T>           // leaf primitive
createReactiveSubscription(inputFn, factory, options?): Subscription<T>
```

`source` / `valueSource` accept typed oRPC procedure refs directly (e.g. `client.preferences.get`); the hook threads `STREAM_RETRY` retry context internally. The leaf primitives `createSubscription` / `createReactiveSubscription` are exposed for advanced consumers that need direct AsyncIterable→Accessor lifting outside the cell/collection/stream taxonomy.

## Design notes

- **Snapshot-then-deltas is load-bearing.** The streaming retry plugin re-invokes the source function on every reconnect. The first frame of every stream MUST be a fresh full snapshot, otherwise reconnects silently lose state. Every server-side helper enforces this in code.

- **The reconcile-or-assign branch is shared.** `createSubscription` and `createReactiveSubscription` use identical logic to write a new value into the local store: `reconcile` for objects/arrays (fine-grained reactivity), plain assignment for primitives. This used to be duplicated with a "keep in sync" comment between the two; now it lives in one place.

- **Local authority's "ignore subsequent echoes" is the subtle invariant.** A naive implementation reconciles every server push into the local store. The bug surfaces only when an unrelated event piggybacks on the same channel: an activity-feed tick, say, would stomp a just-made preferences write whose RPC hadn't round-tripped yet. `useCell` with `authority: "local"` reconciles only on the first yield and then ignores the subscription thereafter — the local store is authoritative.

- **No second consumer pressure.** This package was extracted to decomplect Kolu's client and server source trees, not to be reused. The boundary is shaped by Kolu's actual ragged edges (terminal.attach's subscribe-before-yield, gitStatus's poll-on-event) rather than speculative ones; no contract auto-derivation, no pluggable backends beyond what Kolu actually has.

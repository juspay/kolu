---
description: Cross-file invariants for oRPC streaming procedures (server snapshot-then-deltas, plugin context parameterization)
applyTo: "{packages/client/src,packages/server/src,packages/common/src}/**"
---

## oRPC Streaming Procedures

Two invariants an agent editing any single file would otherwise miss. They are independent rules (different layers, different enforcement mechanisms) that share a trigger: **touching any streaming procedure**.

> The earlier "route client calls through the `stream` namespace" rule was retired when the `@kolu/surface` framework absorbed `STREAM_RETRY` context plumbing — `useCell` / `useCollection` / `useStream` thread it internally, and `streamCall(client.X.Y, input, opts)` is the one-line escape hatch for raw streaming RPCs (`attach`, lifecycle events). There is no `stream` namespace to maintain anymore.

### 1. Server handlers yield snapshot-then-deltas

Every server-side streaming handler in `packages/server/src/router.ts` MUST yield a full state snapshot as its first item, then stream deltas. This is the invariant that makes `ClientRetryPlugin`'s transparent re-subscribe work: on reconnect, the plugin re-invokes the source, and the new iterator's first yield is a fresh snapshot that replaces stale client state.

Two acceptable shapes:

- **Implicit**: each yield is already a full replacement (e.g. `onMetadataChange` yields a current `TerminalMetadata`; `preferences.get` yields a current `Preferences`; `activity.get` yields a current `ActivityFeed`; `session.get` yields the current `SavedSession | null`; `terminal.list` yields a current `TerminalInfo[]`). Client reducers can just use the latest value.
- **Explicit discriminated union**: when clients accumulate deltas into a derived structure, yield `{ kind: "snapshot", ... } | { kind: "delta", ... }`. Client reducers replace on snapshot, append on delta. Without the discriminator, reconnect replays the history into an already-populated accumulator and duplicates state.

If a new handler yields deltas only (no initial snapshot), reconnects will silently lose state with no error.

For Cell/Collection/Stream handlers built via `cellHandlers` / `collectionHandlers` / `streamHandlers` from `@kolu/surface/server`, the framework guarantees this invariant — the `get` generator yields `store.get()` / `readOne(key)` / `source(input)`'s first frame before iterating the bus. For raw oRPC streaming handlers (terminal `attach`, lifecycle events), the discipline is the author's.

### 2. Parameterize plugin contexts immediately

When installing an oRPC client plugin that extends `ClientContext` (e.g. `ClientRetryPlugin`), parameterize both `RPCLink<Context>` AND `ContractRouterClient<contract, Context>` at the same time. `@kolu/surface/client`'s `createCellsClient<C>({ websocket })` does this internally — consumers don't need to repeat it.

Without this, per-call `{ context: ... }` options fall through to the default `Record<PropertyKey, any>` context type and TypeScript cannot catch typos — a misspelled field silently does nothing at runtime. This is a latent failure mode: tests still pass, the bug only surfaces when the context field you wanted to set is silently absent.

The rule extends to future plugins: any plugin that exposes a context interface must be threaded through both type parameters the moment it's installed.

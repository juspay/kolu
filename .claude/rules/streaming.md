---
paths:
  - "{packages/client/src,packages/server/src,packages/common/src}/**"
---

## oRPC Streaming Procedures

Three invariants an agent editing any single file would otherwise miss. They are independent rules (different layers, different enforcement mechanisms) that share a trigger: **touching any streaming procedure**.

### 1. Route client calls through the `stream` namespace

Every async-iterator RPC the client consumes goes through `packages/client/src/rpc/rpc.ts`'s `stream` object, not `client.*` directly. The wrapper bakes in `STREAM_RETRY` context so `ClientRetryPlugin` can transparently re-subscribe on WebSocket reconnect.

**When adding a new streaming procedure** (to `packages/common/src/contract.ts` + `packages/server/src/router.ts`), also add a corresponding entry to the `stream` object. Consumers MUST use `stream.xxx(...)` — calling `client.xxx(...)` directly silently loses reconnect handling.

`stream.attach` takes an `onRetry` callback because imperative consumers (xterm.js `Terminal.tsx`, `TerminalPreview.tsx`) must clear their buffer before the retried iterator delivers its fresh snapshot — otherwise scrollback double-paints.

### 2. Server handlers yield snapshot-then-deltas

Every server-side streaming handler in `packages/server/src/router.ts` MUST yield a full state snapshot as its first item, then stream deltas. This is the invariant that makes `ClientRetryPlugin`'s transparent re-subscribe work: on reconnect, the plugin re-invokes the source, and the new iterator's first yield is a fresh snapshot that replaces stale client state.

Two acceptable shapes:

- **Implicit**: each yield is already a full replacement (e.g. `onMetadataChange` yields a current `TerminalMetadata`; `preferences.get` yields a current `Preferences`; `activity.get` yields a current `ActivityFeed`; `session.get` yields the current `SavedSession | null`; `terminal.list` yields a current `TerminalInfo[]`). Client reducers can just use the latest value.
- **Explicit discriminated union**: when clients accumulate deltas into a derived structure, yield `{ kind: "snapshot", ... } | { kind: "delta", ... }`. Client reducers replace on snapshot, append on delta. Without the discriminator, reconnect replays the history into an already-populated accumulator and duplicates state. Canonical example: `fs.watch` (file-tree changes from chokidar) — the snapshot carries the full path list; deltas carry `added`/`removed` arrays that consumers fold into Pierre's `tree.batch([...])` for incremental updates.

If a new handler yields deltas only (no initial snapshot), reconnects will silently lose state with no error.

### 3. Parameterize plugin contexts immediately

When installing an oRPC client plugin that extends `ClientContext` (e.g. `ClientRetryPlugin`), parameterize both `RPCLink<Context>` AND `ContractRouterClient<contract, Context>` at the same time. The current code uses `ClientRetryPluginContext`.

Without this, per-call `{ context: ... }` options fall through to the default `Record<PropertyKey, any>` context type and TypeScript cannot catch typos — a misspelled field silently does nothing at runtime. This is a latent failure mode: tests still pass, the bug only surfaces when the context field you wanted to set is silently absent.

The rule extends to future plugins: any plugin that exposes a context interface must be threaded through both type parameters the moment it's installed.

---
paths:
  - "{packages/client/src,packages/server/src,packages/common/src}/**"
---

## oRPC Streaming Procedures

Three invariants an agent editing any single file would otherwise miss. They are independent rules (different layers, different enforcement mechanisms) that share a trigger: **touching any streaming procedure**.

### 1. Apply `STREAM_RETRY` — via `client.rawStream` or `unenrolledStreamCall`, never a bare `client.*` call

Every async-iterator RPC the client consumes must carry the `STREAM_RETRY` context so `ClientRetryPlugin` transparently re-subscribes on WebSocket reconnect. That context is applied structurally in `@kolu/surface/src/client.ts` — there is no hand-rolled `stream` wrapper object (the old `packages/client/src/rpc/rpc.ts` `stream` namespace no longer exists; `rpc.ts` holds only `createServerLifecycle`). Two paths bake it in:

- **`client.rawStream(name, proc, input, { onItem, onRetry, isExpectedStop })`** — a SURFACE-scoped raw stream that ENROLS into `client.health()` (throws outside a reactive owner, so a raw stream can't silently escape the health fact). This is the default for a surface stream member.
- **`unenrolledStreamCall(proc, input, { signal, onRetry })`** (from `@kolu/surface/client`) — the bare, un-enrolled call: `STREAM_RETRY` applied, but DELIBERATELY carved out of any surface `health()`. Reach for it only when the stream's health is a per-consumer concern that must not flicker the global gate.

Both merge a supplied `onRetry` into the retry context so the plugin invokes the callback before each re-subscribe (`@kolu/surface/src/client.ts`). The terminal **attach** stream (`padiSurface.streams.terminalAttach`, called as `padiRpc(padi).surface.terminalAttach.get` in `terminal/Terminal.tsx`) uses `unenrolledStreamCall` for exactly this reason (Leak-A carve-out): a single terminal's re-attach — overflow re-attach #1591, PTY exit — must never light padi's connection-health indicator. Its `onRetry` resets xterm + the scroll lock and re-arms the snapshot boundary, because imperative consumers must clear their buffer before the retried iterator delivers its fresh snapshot — otherwise scrollback double-paints.

**When adding a new streaming procedure**, pick `client.rawStream` (enrolled) unless the stream is a deliberate health carve-out (`unenrolledStreamCall`). A bare `client.xxx(...)` / `padiRpc(padi).surface.xxx.get(...)` call without one of these silently loses reconnect handling.

### 2. Server handlers yield snapshot-then-deltas

Every server-side streaming handler in `packages/server/src/router.ts` MUST yield a full state snapshot as its first item, then stream deltas. This is the invariant that makes `ClientRetryPlugin`'s transparent re-subscribe work: on reconnect, the plugin re-invokes the source, and the new iterator's first yield is a fresh snapshot that replaces stale client state.

Two acceptable shapes:

- **Implicit**: each yield is already a full replacement (e.g. `onMetadataChange` yields a current `TerminalMetadata`; `preferences.get` yields a current `Preferences`; `activity.get` yields a current `ActivityFeed`; `session.get` yields the current `SavedSession | null`; `terminal.list` yields a current `TerminalInfo[]`). Client reducers can just use the latest value.
- **Explicit discriminated union**: when clients accumulate deltas into a derived structure, yield `{ kind: "snapshot", ... } | { kind: "delta", ... }`. Client reducers replace on snapshot, append on delta. Without the discriminator, reconnect replays the history into an already-populated accumulator and duplicates state.

If a new handler yields deltas only (no initial snapshot), reconnects will silently lose state with no error.

### 3. Parameterize plugin contexts immediately

When installing an oRPC client plugin that extends `ClientContext` (e.g. `ClientRetryPlugin`), parameterize both `RPCLink<Context>` AND `ContractRouterClient<contract, Context>` at the same time. The current code uses `ClientRetryPluginContext`.

Without this, per-call `{ context: ... }` options fall through to the default `Record<PropertyKey, any>` context type and TypeScript cannot catch typos — a misspelled field silently does nothing at runtime. This is a latent failure mode: tests still pass, the bug only surfaces when the context field you wanted to set is silently absent.

The rule extends to future plugins: any plugin that exposes a context interface must be threaded through both type parameters the moment it's installed.

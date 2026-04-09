---
description: Cross-file invariants for oRPC streaming procedures (client stream namespace, server snapshot-then-deltas, plugin context parameterization)
applyTo: "{client/src,server/src,common/src}/**"
---

## oRPC Streaming Procedures

Three invariants an agent editing any single file would otherwise miss. They are independent rules (different layers, different enforcement mechanisms) that share a trigger: **touching any streaming procedure**.

### 1. Route client calls through the `stream` namespace

Every async-iterator RPC the client consumes goes through `client/src/rpc.ts`'s `stream` object, not `client.*` directly. The wrapper bakes in `STREAM_RETRY` context so `ClientRetryPlugin` can transparently re-subscribe on WebSocket reconnect.

**When adding a new streaming procedure** (to `common/src/contract.ts` + `server/src/router.ts`), also add a corresponding entry to the `stream` object. Consumers MUST use `stream.xxx(...)` — calling `client.xxx(...)` directly silently loses reconnect handling.

`stream.attach` takes an `onRetry` callback because imperative consumers (xterm.js `Terminal.tsx`, `TerminalPreview.tsx`) must clear their buffer before the retried iterator delivers its fresh snapshot — otherwise scrollback double-paints.

### 2. Server handlers yield snapshot-then-deltas

Every server-side streaming handler in `server/src/router.ts` MUST yield a full state snapshot as its first item, then stream deltas. This is the invariant that makes `ClientRetryPlugin`'s transparent re-subscribe work: on reconnect, the plugin re-invokes the source, and the new iterator's first yield is a fresh snapshot that replaces stale client state.

Two acceptable shapes:

- **Implicit**: each yield is already a full replacement (e.g. `onMetadataChange` yields a current `TerminalMetadata`; `state.get` yields a current `ServerState`; `terminal.list` yields a current `TerminalInfo[]`). Client reducers can just use the latest value.
- **Explicit discriminated union**: when clients accumulate deltas into a derived structure (e.g. `onActivityChange` → sparkline array), yield `{ kind: "snapshot", samples: [...] } | { kind: "delta", sample: ... }`. Client reducers replace on snapshot, append on delta. Without the discriminator, reconnect replays the history into an already-populated accumulator and duplicates samples.

If a new handler yields deltas only (no initial snapshot), reconnects will silently lose state with no error.

### 3. Parameterize plugin contexts immediately

When installing an oRPC client plugin that extends `ClientContext` (e.g. `ClientRetryPlugin`), parameterize both `RPCLink<Context>` AND `ContractRouterClient<contract, Context>` at the same time. The current code uses `ClientRetryPluginContext`.

Without this, per-call `{ context: ... }` options fall through to the default `Record<PropertyKey, any>` context type and TypeScript cannot catch typos — a misspelled field silently does nothing at runtime. This is a latent failure mode: tests still pass, the bug only surfaces when the context field you wanted to set is silently absent.

The rule extends to future plugins: any plugin that exposes a context interface must be threaded through both type parameters the moment it's installed.

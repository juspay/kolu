---
description: Cross-file invariants for surface streaming members (the retry fence via client.rawStream/unenrolledStreamCall, server snapshot-then-deltas, and the captured-input hazard)
applyTo: "{packages/client/src,packages/server/src,packages/common/src}/**"
---

## Streaming members

Three invariants an agent editing any single file would otherwise miss. They are independent rules (different layers, different enforcement mechanisms) that share a trigger: **touching any streaming member**.

### 1. Apply the retry fence — via `client.rawStream` or `unenrolledStreamCall`, never a bare `client.*` call

A streaming member hands back a **lazy Effect `Stream`**. Every one the client consumes must be wrapped in the framework's **per-subscription retry fence** (`fenceStream` + `STREAM_RETRY`, `@kolu/surface/src/client.ts`) so a dropped socket transparently re-subscribes. The fence is per SUBSCRIPTION and not per link, deliberately: Effect RPC's own `retryTransientErrors` reconnects the socket but **re-issues nothing** — an established-socket close fails every in-flight call and no layer below re-opens them. Two paths bake the fence in:

- **`client.rawStream(name, proc, input, { onItem, onRetry, isExpectedStop })`** — a SURFACE-scoped raw stream that ENROLS into `client.health()` (throws outside a reactive owner, so a raw stream can't silently escape the health fact). This is the default for a surface stream member.
- **`unenrolledStreamCall(proc, input, { onRetry })`** (from `@kolu/surface/client`) — the bare, un-enrolled call: the fence applied, but DELIBERATELY carved out of any surface `health()`. Reach for it only when the stream's health is a per-consumer concern that must not flicker the global gate.

`onRetry` fires once per RETRYABLE failure, INSIDE the fence and before the delay, so "fired ⇒ a re-subscribe follows" holds and a consumer that clears its buffer is never left with a cleared view and no new stream. The terminal **attach** stream (`padiSurface.streams.terminalAttach`, in `terminal/Terminal.tsx`) uses `unenrolledStreamCall` for exactly this reason (Leak-A carve-out): a single terminal's re-attach — overflow re-attach #1591, PTY exit — must never light padi's connection-health indicator. Its `onRetry` resets xterm + the scroll lock and re-arms the snapshot boundary, because imperative consumers must clear their buffer before the retried stream delivers its fresh snapshot — otherwise scrollback double-paints.

What the fence retries is a **positive** test (`shouldRetryStreamError`): an Effect RPC `RpcClientError` transport failure, plus the one named retryable relay end (`SurfaceRelayTransportLost`). Everything else fails the stream on its first occurrence — a **declared** (PLAN D4) tagged procedure error is an application-level answer, and the two permanently-dead transport tags (`SurfaceTransportRetired`, `SurfaceStdioTransportClosed`) are corpses a retry loop would storm against.

**When adding a new streaming member**, pick `client.rawStream` (enrolled) unless the stream is a deliberate health carve-out (`unenrolledStreamCall`). Consuming a member's `Stream` directly — without either wrapper — silently loses reconnect handling.

**There is no `signal`.** Cancellation is fiber interruption (PLAN D10/#18): interrupting the subscription's scoped fiber runs the stream's own finalizers, which IS the unsubscribe. A one-shot read of the opening frame is `@kolu/surface/first-frame`'s `firstFrameOrThrow` / `firstFrameOrUndefined`, which take the `Stream` itself.

### 2. Server handlers yield snapshot-then-deltas

Every server-side streaming handler (`packages/server/src/router.ts`, and every `implementSurface` `streams.<key>` slot) MUST yield a full state snapshot as its first item, then stream deltas. This is the invariant that makes the fence's transparent re-subscribe work: `Stream.retry` re-runs the WHOLE stream, so the next frame the consumer sees is a fresh snapshot that replaces stale client state.

Two acceptable shapes:

- **Implicit**: each yield is already a full replacement (e.g. `onMetadataChange` yields a current `TerminalMetadata`; `preferences.get` yields a current `Preferences`; `activity.get` yields a current `ActivityFeed`; `session.get` yields the current `SavedSession | null`; `terminal.list` yields a current `TerminalInfo[]`). Client reducers can just use the latest value.
- **Explicit discriminated union**: when clients accumulate deltas into a derived structure, yield `{ kind: "snapshot", ... } | { kind: "delta", ... }`. Client reducers replace on snapshot, append on delta. Without the discriminator, reconnect replays the history into an already-populated accumulator and duplicates state.

If a new handler yields deltas only (no initial snapshot), reconnects will silently lose state with no error.

### 3. A member's input is CAPTURED — never a live fact

The fence re-subscribes by REPLAYING the input it read once, at the first call. So a stream whose input carries a LIVE fact (a size, a cursor, a viewport) re-sends a STALE one after any transport drop — and if the server acts on that input (kolu's terminal attach resizes the PTY to it), the replay actively moves shared state backwards.

Either keep the input a **stable key**, or have the consumer REFUSE an answer computed for the stale fact and reopen the stream. The terminal attach is the worked example: it remembers the grid it asked at, drops a snapshot answering any other grid, and re-reads the live grid on every open (`client/src/terminal/Terminal.tsx`). Painting the stale answer and correcting afterwards does NOT work — the damage (scrollback wrapped at the wrong width) is already done.

# live

End-to-end reactive streams — typed pub/sub on the server, SolidJS signals on the client.

## The problem

Server-pushed state routed through a request-response cache (TanStack Query) introduces accidental complexity: experimental streaming APIs, parallel store workarounds for synchronous reactivity, and cache key management for data that's already being pushed to you.

## The idea

Two primitives per side, nothing shared between them:

- **Server** (`live/server`): `createChannel` + `liveQuery`
- **Client** (`live/solid`): `createLive` + `createAction`

The transport layer (oRPC, gRPC, WebSocket, SSE) stays separate. `live` only cares about `AsyncIterable<T>` — the universal streaming interface.

## Server

### `createChannel<T>()`

Typed in-memory pub/sub. Publish values; subscribers get `AsyncIterable<T>`.

```ts
import { createChannel } from "kolu-live/server";

const counter = createChannel<number>();

// Publish from anywhere
counter.publish(42);

// Subscribe in a handler
for await (const n of counter.subscribe(signal)) {
  console.log(n);
}
```

### `createKeyedChannel<K, T>()`

Same thing, multiplexed by key. Each key gets an independent channel.

```ts
import { createKeyedChannel } from "kolu-live/server";

const metadata = createKeyedChannel<string, TerminalMetadata>();

// Publish to a specific key
metadata.publish(terminalId, { cwd: "/home", ... });

// Subscribe to a specific key
for await (const meta of metadata.subscribe(terminalId, signal)) { ... }
```

### `liveQuery(subscribe, snapshot)`

Snapshot-first async generator. Subscribes before computing the snapshot, so no events are lost between the two. Returns a function that takes an `AbortSignal`.

```ts
import { liveQuery } from "kolu-live/server";

// In a router handler:
const handler = liveQuery(
  (signal) => metadata.subscribe(id, signal),
  () => getCurrentMetadata(id),
);

// Usage: yield* handler(signal)
```

### `liveQueryMany(subscribe, snapshot)`

Same pattern, but the snapshot yields multiple items (e.g., a history array).

```ts
import { liveQueryMany } from "kolu-live/server";

const handler = liveQueryMany(
  (signal) => activity.subscribe(id, signal),
  () => getActivityHistory(id), // Iterable<ActivitySample>
);
```

## Client (SolidJS)

### `createLive(source, options?)`

Converts `Promise<AsyncIterable<T>>` into a reactive signal.

Returns `{ value, error, pending, mutate }` — three independent signals, not a sum type. Uses `createStore` + `reconcile` internally for fine-grained reactivity on object fields.

```tsx
import { createLive } from "kolu-live/solid";

// Replacing stream (default) — each event replaces the value:
const meta = createLive(() => client.terminal.onMetadataChange({ id }));
meta.value(); // TerminalMetadata | undefined
meta.pending(); // true until first event
meta.error(); // Error | undefined

// Fine-grained subfield access — only re-renders when cwd changes:
const cwd = () => meta.value()?.cwd;
const branch = () => meta.value()?.git?.branch;

// Accumulating stream — events fold via reducer:
const samples = createLive(() => client.terminal.onActivityChange({ id }), {
  reduce: (acc, item) => [...acc, item].slice(-200),
  initial: [],
});
samples.value(); // ActivitySample[]
```

### Optimistic updates

```tsx
// Instant local write + fire-and-forget server call.
// Next server push overwrites (confirms or corrects).
meta.mutate(
  (current) => ({ ...current, themeName: "dracula" }),
  () => client.terminal.setTheme({ id, themeName: "dracula" }),
);
```

### `createAction(fn)`

Wraps an async function with reactive lifecycle tracking.

```tsx
import { createAction } from "kolu-live/solid";

const [create, creating] = createAction(client.terminal.create);

// Fire:
const info = await create({ cwd: "/home" });

// React to lifecycle:
creating.pending(); // true while in flight
creating.value(); // result of last successful call
creating.error(); // error from last failed call
```

## What this replaces

| Before                                 | After                          |
| -------------------------------------- | ------------------------------ |
| `@orpc/experimental-publisher/memory`  | `createChannel` (~50 LOC)      |
| `experimental_liveOptions()`           | `createLive()`                 |
| `experimental_streamedOptions()`       | `createLive()` with `reduce`   |
| Parallel SolidJS store workaround      | Gone — signals are synchronous |
| Hand-written snapshot-first generators | `liveQuery()`                  |
| TanStack Query for subscriptions       | Gone                           |
| `select()` / `Live<T>` sum type        | Plain derived accessors        |

## Design decisions

**Separate signals, not a sum type.** `{ value, error, pending }` instead of `Live<T> = pending | ok | error`. Each concern is an independent signal — composition is just `() => meta.value()?.git`. No wrapper to unwrap.

**`createStore` + `reconcile` for objects.** Ensures `() => meta.value()?.cwd` only triggers when `cwd` actually changes, not on every metadata update. This is what makes `select()` unnecessary.

**Reducer for accumulation.** `createStreamed` was merged into `createLive` with an optional `reduce` parameter. Replacing is the default (identity reducer). Accumulating is `reduce: (acc, item) => [...acc, item]`.

**Source is `() => Promise<AsyncIterable<T>>`.** Matches what oRPC returns for `eventIterator` endpoints. The factory function (not a raw iterable) allows re-subscription on reconnect.

## Example

See [`example/`](./example/) for a working server demo and conceptual client components.

```sh
# Run the server example (counter + chat demo):
npx tsx live/example/server.ts
```

# live

End-to-end reactive streams — typed pub/sub on the server, SolidJS signals on the client.

## The problem

Server-pushed state routed through a request-response cache (TanStack Query) introduces accidental complexity: experimental streaming APIs, parallel store workarounds for synchronous reactivity, and cache key management for data that's already being pushed to you.

## The idea

Two primitives per side, nothing shared between them:

- **Server** (`live/server`): `createChannel` + `liveQuery`
- **Client** (`live/solid`): `createLive` + `createAction`

The transport layer (oRPC, gRPC, WebSocket, SSE) stays separate. `live` only cares about `AsyncIterable<T>` — the universal streaming interface.

## Tutorial

We'll build a live worker dashboard — a server that spawns ticking workers, and a SolidJS client that displays them in real time. By the end, we'll have workers appearing, ticking, and disappearing without the client ever polling.

The completed code is in [`example/`](./example/). We can run it now and work backwards, or follow along below.

```sh
cd live/example && just dev
# Open http://localhost:5173
```

### Create a channel and publish to it

We start on the server. A channel is how we push data to connected clients. Let's create one for the worker list:

```ts
import { createChannel } from "kolu-live/server";

const workerList = createChannel<WorkerInfo[]>();
```

Whenever our worker list changes, we publish:

```ts
workers.set(id, entry);
workerList.publish(listWorkers());
```

Every subscriber receives the new list. We haven't defined any subscribers yet — that comes next.

### Expose the channel as a streaming endpoint

We need to turn our channel into something clients can connect to. `liveQuery` does this — it subscribes to the channel, then yields a snapshot of the current state, then yields live updates. The subscribe-before-snapshot ordering guarantees nothing is lost.

```ts
import { liveQuery } from "kolu-live/server";

// In our oRPC router:
list: t.worker.list.handler(async function* ({ signal }) {
  yield* liveQuery(
    (s) => workerList.subscribe(s),
    () => listWorkers(),
  )(signal);
}),
```

We can verify this works by running the server and connecting with a WebSocket client. The first message is the snapshot (current worker list), then each subsequent message is a live update.

### Consume the stream on the client

On the client, oRPC gives us `Promise<AsyncIterable<T>>` for streaming endpoints. We feed that directly to `createLive`:

```tsx
import { createLive } from "kolu-live/solid";

const list = createLive(() => client.worker.list());
```

`list` now has three signals: `value()`, `pending()`, `error()`. We render the list:

```tsx
<Show when={list.pending()}>Connecting...</Show>
<For each={list.value()}>
  {(info) => <WorkerCard id={info.id} />}
</For>
```

When we create a worker on the server, `workerList.publish(...)` fires, the stream pushes the new list, and `list.value()` updates. The `<For>` renders the new card. No polling, no refetch, no cache invalidation.

### Add per-entity streams with keyed channels

Each worker has its own metadata (tick count, status). We use a keyed channel — one channel per worker ID:

```ts
import { createKeyedChannel } from "kolu-live/server";

const metadata = createKeyedChannel<string, WorkerMeta>();

// In our tick function:
metadata.publish(id, entry.meta);
```

The router handler follows the same pattern:

```ts
onMetadataChange: t.worker.onMetadataChange.handler(async function* ({ input, signal }) {
  yield* liveQuery(
    (s) => metadata.subscribe(input.id, s),
    () => getMetadata(input.id),
  )(signal);
}),
```

On the client, we subscribe per worker. Because `createLive` uses `createStore` + `reconcile` internally, accessing individual fields like `tickCount` only re-renders when that field actually changes:

```tsx
const meta = createLive(() => client.worker.onMetadataChange({ id: props.id }));

const name = () => meta.value()?.name;
const ticks = () => meta.value()?.tickCount ?? 0;
```

### Accumulate stream events with a reducer

Some streams produce events that build up over time — activity samples, chat messages, log lines. We pass a `reduce` option to `createLive`:

```tsx
const samples = createLive(
  () => client.worker.onActivityChange({ id: props.id }),
  {
    reduce: (acc, sample) => [...acc, sample].slice(-50),
    initial: [],
  },
);
```

`samples.value()` is now the last 50 activity samples. Each new event from the server folds into the array. We can render a sparkline from it:

```tsx
const sparkline = createMemo(() =>
  (samples.value() ?? []).map(([, active]) => (active ? "▓" : "░")).join(""),
);
```

### Track mutations with `createAction`

We wrap server calls with `createAction` to get reactive pending/error/value signals:

```tsx
const [create, creating] = createAction(() => client.worker.create());
```

```tsx
<button onClick={() => create()} disabled={creating.pending()}>
  {creating.pending() ? "Creating..." : "+ New Worker"}
</button>
```

We don't need to update the list manually after creating — the server publishes to `workerList`, and our `createLive` subscription picks it up automatically.

### What we built

The dashboard now has:

- A live worker list that updates when workers are created or killed
- Per-worker metadata that ticks in real time
- An activity sparkline accumulating samples over time
- Create/kill buttons with loading state

All of this with four primitives: `createChannel` and `liveQuery` on the server, `createLive` and `createAction` on the client.

## Reference

### Server (`kolu-live/server`)

#### `createChannel<T>()`

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

#### `createKeyedChannel<K, T>()`

Same thing, multiplexed by key. Each key gets an independent channel.

```ts
import { createKeyedChannel } from "kolu-live/server";

const metadata = createKeyedChannel<string, TerminalMetadata>();

// Publish to a specific key
metadata.publish(terminalId, { cwd: "/home", ... });

// Subscribe to a specific key
for await (const meta of metadata.subscribe(terminalId, signal)) { ... }
```

#### `liveQuery(subscribe, snapshot)`

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

#### `liveQueryMany(subscribe, snapshot)`

Same pattern, but the snapshot yields multiple items (e.g., a history array).

```ts
import { liveQueryMany } from "kolu-live/server";

const handler = liveQueryMany(
  (signal) => activity.subscribe(id, signal),
  () => getActivityHistory(id), // Iterable<ActivitySample>
);
```

### Client (`kolu-live/solid`)

#### `createLive(source, options?)`

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

#### Optimistic updates

```tsx
// Instant local write + fire-and-forget server call.
// Next server push overwrites (confirms or corrects).
meta.mutate(
  (current) => ({ ...current, themeName: "dracula" }),
  () => client.terminal.setTheme({ id, themeName: "dracula" }),
);
```

#### `createAction(fn)`

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

| Before                                | After                          |
| ------------------------------------- | ------------------------------ |
| `@orpc/experimental-publisher/memory` | `createChannel` (~50 LOC)      |
| `experimental_liveOptions()`          | `createLive()`                 |
| `experimental_streamedOptions()`      | `createLive()` with `reduce`   |
| Parallel SolidJS store workaround     | Gone — signals are synchronous |
| Hand-written snapshot-first generators | `liveQuery()`                 |
| TanStack Query for subscriptions      | Gone                           |
| `select()` / `Live<T>` sum type       | Plain derived accessors        |

## Design decisions

**Separate signals, not a sum type.** `{ value, error, pending }` instead of `Live<T> = pending | ok | error`. Each concern is an independent signal — composition is just `() => meta.value()?.git`. No wrapper to unwrap.

**`createStore` + `reconcile` for objects.** Ensures `() => meta.value()?.cwd` only triggers when `cwd` actually changes, not on every metadata update. This is what makes `select()` unnecessary.

**Reducer for accumulation.** `createStreamed` was merged into `createLive` with an optional `reduce` parameter. Replacing is the default (identity reducer). Accumulating is `reduce: (acc, item) => [...acc, item]`.

**Source is `() => Promise<AsyncIterable<T>>`.** Matches what oRPC returns for `eventIterator` endpoints. The factory function (not a raw iterable) allows re-subscription on reconnect.

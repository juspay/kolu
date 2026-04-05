# live

End-to-end reactive streams — signals on the server, SolidJS signals on the client, AsyncIterable on the wire.

## The problem

Server-pushed state routed through a request-response cache (TanStack Query) introduces accidental complexity: experimental streaming APIs, parallel store workarounds for synchronous reactivity, and cache key management for data that's already being pushed to you.

Imperative pub/sub (`channel.publish(value)`) is the manual version of what reactive signals do automatically.

## The idea

Signals on both sides, wire in the middle:

- **Server** (`@solidjs/signals` + `kolu-live/server`): `createSignal` for state, `live()` to bridge signals → AsyncIterable, `events()` for discrete events
- **Client** (`kolu-live/solid`): `createLive` + `createAction`

The transport layer (oRPC, gRPC, WebSocket, SSE) stays separate. `live` only cares about `AsyncIterable<T>` — the universal streaming interface.

## Tutorial

We'll build a live worker dashboard — a server that spawns ticking workers, and a SolidJS client that displays them in real time. By the end, we'll have workers appearing, ticking, and disappearing without the client ever polling.

The completed code is in [`example/`](./example/). We can run it now and work backwards, or follow along below.

```sh
cd live/example && just dev
# Open http://localhost:5173
```

### Define state as signals on the server

We model server state with signals from `@solidjs/signals`. A signal holds a value that can change over time — and anything that depends on it recomputes automatically.

```ts
import { createSignal, createMemo } from "@solidjs/signals";

const [tickCount, setTickCount] = createSignal(0);
const [status, setStatus] = createSignal<"running" | "paused">("running");

// Derived — recomputes when tickCount or status changes
const meta = createMemo(() => ({
  name: "alpha",
  tickCount: tickCount(),
  status: status(),
}));
```

We mutate state by calling the setter. No `channel.publish()` — the signal graph handles notification.

```ts
setInterval(() => setTickCount((c) => c + 1), 1000);
```

### Bridge signals to the wire with `live()`

`live()` watches a reactive expression and yields a new value whenever its dependencies change. The first yield is the snapshot (current state). Subsequent yields are live updates.

```ts
import { live } from "kolu-live/server";

// In our oRPC router:
list: t.worker.list.handler(async function* ({ signal }) {
  yield* live(() => workerList())(signal);
}),

onMetadataChange: t.worker.onMetadataChange.handler(async function* ({ input, signal }) {
  yield* live(() => worker.meta())(signal);
}),
```

One line per handler. The signal graph tracks dependencies. When `workerList` or `worker.meta()` changes, the generator yields the new value automatically.

### Use `events()` for discrete events

Not everything is state. Activity samples, log lines, and exit codes are things that _happen_ — they don't have a "current value." We use `events()` for these:

```ts
import { events } from "kolu-live/server";

const [pushActivity, iterateActivity] = events<ActivitySample>();

// Push from domain logic:
pushActivity([Date.now(), true]);

// In a router handler — snapshot then live:
onActivityChange: async function* ({ input, signal }) {
  for (const sample of worker.activityHistory) yield sample;
  for await (const sample of worker.iterateActivity(signal)) yield sample;
},
```

Two lines in the handler: yield the history, then yield live events. Each line does one thing.

### Consume streams on the client with `createLive`

The client side is unchanged from before. oRPC gives us `Promise<AsyncIterable<T>>` for streaming endpoints. We feed that to `createLive`:

```tsx
import { createLive } from "kolu-live/solid";

const list = createLive(() => client.worker.list());
```

`list` has three signals: `value()`, `pending()`, `error()`. We render:

```tsx
<Show when={list.pending()}>Connecting...</Show>
<For each={list.value()}>
  {(info) => <WorkerCard id={info.id} />}
</For>
```

Because `createLive` uses `createStore` + `reconcile` internally, accessing `meta.value()?.tickCount` only re-renders when `tickCount` actually changes.

### Track mutations with `createAction`

```tsx
const [create, creating] = createAction(() => client.worker.create());
```

```tsx
<button onClick={() => create()} disabled={creating.pending()}>
  {creating.pending() ? "Creating..." : "+ New Worker"}
</button>
```

We don't update the list manually — the server's `workerList` signal changes, `live()` pushes the new list, and the client's `createLive` updates automatically.

### What we built

- Server state as signals — `setTickCount(c => c + 1)` is the entire mutation
- `live()` bridges signals to AsyncIterable — one line per handler, no manual publish
- `events()` for discrete occurrences — push/iterate pair
- Client renders with `createLive` — fine-grained reactivity, no cache layer

## Reference

### Server

Server state uses `@solidjs/signals` (`createSignal`, `createMemo`, `createRoot`, `flush`). Import those directly from `@solidjs/signals`. The `kolu-live/server` module exports the bridging primitives:

#### `live(fn)`

Bridges a reactive expression to an AsyncGenerator. Tracks all signal reads inside `fn`. When any dependency changes, re-evaluates and yields the new value.

```ts
import { live } from "kolu-live/server";

yield * live(() => count())(signal);
```

First yield is the snapshot. Subsequent yields are live updates. The signal graph handles dependency tracking — no manual subscribe/publish.

#### `events()`

Creates a push/iterate pair for discrete events.

```ts
import { events } from "kolu-live/server";

const [push, iterate] = events<ActivitySample>();

push([Date.now(), true]);

for await (const sample of iterate(signal)) { ... }
```

Events are buffered from the moment `iterate()` is called, not when `for-await` starts.

### Client (`kolu-live/solid`)

#### `createLive(source, options?)`

Converts `Promise<AsyncIterable<T>>` into a reactive signal.

Returns `{ value, error, pending, mutate }` — three independent signals, not a sum type. Uses `createStore` + `reconcile` internally for fine-grained reactivity on object fields.

```tsx
import { createLive } from "kolu-live/solid";

const meta = createLive(() => client.terminal.onMetadataChange({ id }));
meta.value(); // T | undefined
meta.pending(); // true until first event
meta.error(); // Error | undefined

// Fine-grained — only re-renders when cwd changes:
const cwd = () => meta.value()?.cwd;

// Accumulating — events fold via reducer:
const samples = createLive(() => client.terminal.onActivityChange({ id }), {
  reduce: (acc, item) => [...acc, item].slice(-200),
  initial: [],
});
```

#### Optimistic updates

```tsx
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
creating.pending(); // true while in flight
creating.value(); // result of last successful call
creating.error(); // error from last failed call
```

## Design decisions

**Signals on the server.** State is `createSignal` / `createMemo` from `@solidjs/signals`. Mutations are signal writes. `live()` bridges the reactive graph to AsyncIterable. No manual publish — the signal graph IS the notification system.

**State vs events.** `live()` is for values that change (metadata, lists, preferences). `events()` is for things that happen (activity samples, log lines). Different concerns, different primitives.

**Separate signals on the client, not a sum type.** `{ value, error, pending }` instead of `Live<T> = pending | ok | error`. Composition is just `() => meta.value()?.git`.

**`createStore` + `reconcile` for objects.** Ensures `() => meta.value()?.cwd` only triggers when `cwd` actually changes.

**`@solidjs/signals` as the reactive runtime.** Beta (v0.13.x), but the coupling is bounded: 4 functions (`createRoot`, `createEffect`, `onCleanup`, `flush`), 1 file (~30 LOC). Works on Node.js with no hacks.

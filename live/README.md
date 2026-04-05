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

We're building a **worker dashboard** — a small app where you can spawn background workers, watch them tick in real time, pause them, kill them. Think of it as a tiny process manager.

The app has two parts:

- A **server** (Node.js) that manages workers and holds their state as reactive signals
- A **client** (SolidJS in the browser) that displays the workers and lets you interact with them

They talk over a WebSocket. The server pushes state changes to the client automatically — no polling, no manual cache updates.

Let's see it first, then build it.

### See the finished app

```sh
cd live/example && just dev
```

Open http://localhost:5173. We should see a dark dashboard with one worker already ticking — its tick count climbing, a green activity sparkline filling in, and live output scrolling. We can click "+ New Worker" to spawn more, pause/resume them with ⏸/▶, and kill them with ✕. Every change is instant — the server pushes, the client reacts.

Now let's build it from scratch.

### Server: hold state in signals

We start on the server. Each worker has a tick count and a status. We model these as signals — reactive values that notify dependents when they change:

```ts
// server.ts
import { createSignal, createMemo, flush } from "@solidjs/signals";

const [tickCount, setTickCount] = createSignal(0);
const [status, setStatus] = createSignal<"running" | "paused">("running");

const meta = createMemo(() => ({
  name: "alpha",
  tickCount: tickCount(),
  status: status(),
}));
```

`meta` is a derived signal — it recomputes whenever `tickCount` or `status` changes. We make the worker tick with a plain `setInterval`:

```ts
setInterval(() => {
  setTickCount((c) => c + 1);
  flush(); // push signal updates to subscribers immediately
}, 1000);
```

No `channel.publish()`. We just write to the signal. Everything downstream reacts.

### Server: send state to the client with `live()`

The client connects over WebSocket and subscribes to streaming endpoints (via oRPC). We need to turn our reactive signals into a stream of values the client can consume.

`live()` does exactly this — it watches a reactive expression and yields a new value each time its dependencies change:

```ts
// server.ts
import { live } from "kolu-live/server";

// oRPC handler — one line
list: t.worker.list.handler(async function* ({ signal }) {
  yield* live(() => workerList())(signal);
}),
```

When a client connects, `live()` evaluates `workerList()` immediately (the snapshot), then yields again each time the signal changes. When the client disconnects, `signal` aborts and the generator cleans up.

We do the same for per-worker metadata:

```ts
onMetadataChange: t.worker.onMetadataChange.handler(async function* ({ input, signal }) {
  const worker = requireWorker(input.id);
  yield* live(() => worker.meta())(signal);
}),
```

### Server: push discrete events with `events()`

Not everything is state. When a worker ticks, we also want to push the tick message as a log line, and record an activity sample. These are things that _happen_, not values that _are_ — they don't have a "current value" to snapshot.

We use `events()` for these — a simple push/iterate pair:

```ts
// server.ts
import { events } from "kolu-live/server";

const [pushTick, iterateTicks] = events<string>();

// In our tick function:
pushTick(`[alpha] tick #${count}`);
```

The handler yields events as they arrive:

```ts
attach: t.worker.attach.handler(async function* ({ input, signal }) {
  for await (const msg of worker.iterateTicks(signal)) yield msg;
}),
```

For activity samples, we also have a history to catch up late-joining clients. We yield the history first, then live events:

```ts
onActivityChange: async function* ({ input, signal }) {
  for (const sample of worker.activityHistory) yield sample;
  for await (const sample of worker.iterateActivity(signal)) yield sample;
},
```

### Client: render live state with `createLive`

Now the client. oRPC streaming endpoints return `Promise<AsyncIterable<T>>`. We feed that to `createLive`, which turns it into a SolidJS reactive signal:

```tsx
// App.tsx
import { createLive } from "kolu-live/solid";
import { client } from "./rpc";

function WorkerDashboard() {
  const list = createLive(() => client.worker.list());

  return (
    <Show when={list.pending()}>Connecting...</Show>
    <For each={list.value()}>
      {(info) => <WorkerCard id={info.id} />}
    </For>
  );
}
```

`list.value()` updates automatically when the server pushes a new worker list. No refetch, no cache key, no invalidation. We just render it.

Each worker card subscribes to its own metadata stream:

```tsx
function WorkerCard(props: { id: string }) {
  const meta = createLive(() =>
    client.worker.onMetadataChange({ id: props.id }),
  );

  return (
    <div>
      {meta.value()?.name} — {meta.value()?.tickCount} ticks
    </div>
  );
}
```

Because `createLive` uses `createStore` + `reconcile` internally, `meta.value()?.tickCount` only re-renders when `tickCount` actually changes — not on every metadata update.

### Client: accumulate events with a reducer

For activity samples, we want to build up an array over time. We pass a `reduce` option:

```tsx
const samples = createLive(
  () => client.worker.onActivityChange({ id: props.id }),
  {
    reduce: (acc, sample) => [...acc, sample].slice(-50),
    initial: [],
  },
);
```

Each event from the server folds into the array. We render a sparkline:

```tsx
const sparkline = () =>
  (samples.value() ?? []).map(([, active]) => (active ? "▓" : "░")).join("");
```

### Client: fire mutations with `createAction`

When the user clicks "+ New Worker", we call the server. `createAction` wraps the call with reactive lifecycle tracking:

```tsx
const [create, creating] = createAction(() => client.worker.create());

<button onClick={() => create()} disabled={creating.pending()}>
  {creating.pending() ? "Creating..." : "+ New Worker"}
</button>;
```

We don't manually add the new worker to the list. The server creates the worker, the `workerList` signal updates, `live()` pushes the new list, and the client's `createLive` picks it up. End-to-end reactivity.

### What we built

A server holding state in signals, a client rendering that state reactively, connected by a WebSocket that carries the signal changes as AsyncIterable streams. No manual pub/sub on the server, no cache layer on the client. Four primitives made the whole thing work:

- **`live()`** — server signals → stream (for state)
- **`events()`** — push/iterate (for things that happen)
- **`createLive()`** — stream → SolidJS signal (for rendering)
- **`createAction()`** — async call → pending/error/value (for mutations)

The full code is in [`example/`](./example/).

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

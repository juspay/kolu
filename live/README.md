# live

End-to-end reactive streams — signals on the server, SolidJS signals on the client, AsyncIterable on the wire.

## The problem

Server-pushed state routed through a request-response cache (TanStack Query) introduces accidental complexity: experimental streaming APIs, parallel store workarounds for synchronous reactivity, and cache key management for data that's already being pushed to you.

Imperative pub/sub (`channel.publish(value)`) is the manual version of what reactive signals do automatically.

## The idea

Signals on both sides, wire in the middle:

- **Server** (`@solidjs/signals` + `live/server`): `createSignal` for state, `live()` to bridge signals → AsyncIterable, `events()` for discrete events
- **Client** (`live/solid`): `createLive` + `createAction`

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

### Part 1: State with signals and `live()`

We'll get a single worker ticking on the server, display it in the browser, then scale to multiple workers with create/kill.

#### Server: a worker that ticks

We start on the server. Each worker has a tick count and a status. We model these as signals — reactive values that notify dependents when they change:

```ts
// server.ts
import { createSignal, createMemo, flush } from "@solidjs/signals";
import { live } from "live/server";

const [tickCount, setTickCount] = createSignal(0);
const [status, setStatus] = createSignal<"running" | "paused">("running");

// Derived — recomputes when tickCount or status changes
const meta = createMemo(() => ({
  name: "alpha",
  tickCount: tickCount(),
  status: status(),
}));
```

Now we make it tick:

```ts
setInterval(() => {
  setTickCount((c) => c + 1);
  flush(); // push signal updates to subscribers immediately
}, 1000);
```

No `channel.publish()`. We just call the setter. Everything downstream reacts.

#### Server: stream `meta` to the client

The client will connect over WebSocket and subscribe to streaming endpoints via oRPC. We need to turn our reactive `meta` signal into a stream the client can consume.

`live()` does this — it watches a reactive expression and yields a new value each time its dependencies change:

```ts
onMetadataChange: t.worker.onMetadataChange.handler(async function* ({ signal }) {
  yield* live(() => meta())(signal);
}),
```

When a client connects, `live()` evaluates `meta()` immediately — that's the snapshot. Then each time `tickCount` changes, `meta` recomputes and `live()` yields the new value. When the client disconnects, `signal` aborts and the generator cleans up.

#### Client: render the ticking worker

Now the client. The oRPC client gives us `Promise<AsyncIterable<T>>` for streaming endpoints. We feed that to `createLive`, which turns it into a SolidJS reactive signal:

```tsx
// App.tsx
import { createLive } from "live/solid";
import { client } from "./rpc";

function WorkerCard() {
  const meta = createLive(() => client.worker.onMetadataChange());

  const name = () => meta.value()?.name;
  const ticks = () => meta.value()?.tickCount ?? 0;

  return (
    <div>
      {name()} — {ticks()} ticks
    </div>
  );
}
```

Open the browser. We should see "alpha — 0 ticks", then "alpha — 1 ticks", "alpha — 2 ticks"... updating every second. The server writes to a signal, `live()` streams it, `createLive` renders it. That's the whole loop.

Because `createLive` uses `createStore` + `reconcile` internally, `ticks()` only re-renders when `tickCount` actually changes — not on every metadata update.

#### Server: manage multiple workers

Our dashboard needs to spawn and kill workers. We keep a Map of workers and a signal for the current list:

```ts
const workers = new Map<string, Worker>();
const [workerList, setWorkerList] = createSignal<WorkerInfo[]>([]);

function createWorker() {
  const id = String(nextId++);
  const [tickCount, setTickCount] = createSignal(0);
  const meta = createMemo(() => ({
    name: "alpha",
    tickCount: tickCount(),
    /* ... */
  }));
  workers.set(id, { meta, tickCount /* ... */ });

  // Update the list signal — all subscribers see the new worker
  setWorkerList([...workers.values()].map((w) => w.info));
  flush();
}
```

The list handler streams the `workerList` signal, and the metadata handler looks up a specific worker:

```ts
list: t.worker.list.handler(async function* ({ signal }) {
  yield* live(() => workerList())(signal);
}),

onMetadataChange: t.worker.onMetadataChange.handler(async function* ({ input, signal }) {
  const worker = workers.get(input.id);
  yield* live(() => worker.meta())(signal);
}),
```

When we call `createWorker()`, `workerList` updates, and every connected client receives the new list automatically.

#### Client: list + create

```tsx
import { createLive, createAction } from "live/solid";

function WorkerDashboard() {
  const list = createLive(() => client.worker.list());
  const [create, creating] = createAction(() => client.worker.create());

  return (
    <>
      <button onClick={() => create()} disabled={creating.pending()}>
        {creating.pending() ? "Creating..." : "+ New Worker"}
      </button>
      <For each={list.value()}>{(info) => <WorkerCard id={info.id} />}</For>
    </>
  );
}
```

Click "+ New Worker". The server creates a worker, `workerList` updates, `live()` pushes, `createLive` re-renders the list. We didn't touch the list ourselves — end-to-end reactivity did it.

At this point we have a working dashboard: create workers, watch them tick, see the list update. All with `live()` on the server and `createLive` on the client.

### Part 2: Events with `events()`

State covers values that _are_ — the worker list, metadata. But workers also produce things that _happen_: tick log lines and activity samples. These don't have a "current value" — they're discrete events. We use a different primitive for these.

#### Server: push events

`events()` returns a push/iterate pair. We push from domain logic:

```ts
import { events } from "live/server";

const [pushTick, iterateTicks] = events<string>();

// In the tick function:
pushTick(`[alpha] tick #${tickCount()}`);
```

The handler iterates:

```ts
attach: t.worker.attach.handler(async function* ({ input, signal }) {
  const worker = workers.get(input.id);
  for await (const msg of worker.iterateTicks(signal)) yield msg;
}),
```

For activity samples, we also keep a history so late-joining clients catch up. We yield the history first, then live events:

```ts
onActivityChange: async function* ({ input, signal }) {
  const worker = workers.get(input.id);
  for (const sample of worker.activityHistory) yield sample;
  for await (const sample of worker.iterateActivity(signal)) yield sample;
},
```

#### Client: accumulate events with a reducer

On the client, events need to accumulate into an array. We pass a `reduce` option to `createLive`:

```tsx
const samples = createLive(
  () => client.worker.onActivityChange({ id: props.id }),
  {
    reduce: (acc, sample) => [...acc, sample].slice(-50),
    initial: [],
  },
);

// Render a sparkline:
const sparkline = () =>
  (samples.value() ?? []).map(([, active]) => (active ? "▓" : "░")).join("");
```

Each event from the server folds into the array. The sparkline fills in as the worker ticks.

### What we built

A server holding state in signals, a client rendering that state reactively, connected by a WebSocket. No manual pub/sub on the server, no cache layer on the client. Four primitives:

- **`live()`** — server signals → stream (for state)
- **`events()`** — push/iterate (for things that happen)
- **`createLive()`** — stream → SolidJS signal (for rendering)
- **`createAction()`** — async call → pending/error/value (for mutations)

The full working code is in [`example/`](./example/).

## Reference

### Server

Server state uses `@solidjs/signals` (`createSignal`, `createMemo`, `createRoot`, `flush`). Import those directly from `@solidjs/signals`. The `live/server` module exports the bridging primitives:

#### `live(fn)`

Bridges a reactive expression to an AsyncGenerator. Tracks all signal reads inside `fn`. When any dependency changes, re-evaluates and yields the new value.

```ts
import { live } from "live/server";

yield * live(() => count())(signal);
```

First yield is the snapshot. Subsequent yields are live updates. The signal graph handles dependency tracking — no manual subscribe/publish.

#### `events()`

Creates a push/iterate pair for discrete events.

```ts
import { events } from "live/server";

const [push, iterate] = events<ActivitySample>();

push([Date.now(), true]);

for await (const sample of iterate(signal)) {
  /* ... */
}
```

Events are buffered from the moment `iterate()` is called, not when `for-await` starts.

### Client (`live/solid`)

#### `createLive(source, options?)`

Converts `Promise<AsyncIterable<T>>` into a reactive signal.

Returns `{ value, error, pending, mutate }` — three independent signals, not a sum type. Uses `createStore` + `reconcile` internally for fine-grained reactivity on object fields.

```tsx
import { createLive } from "live/solid";

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
import { createAction } from "live/solid";

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

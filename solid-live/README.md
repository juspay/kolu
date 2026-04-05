# solid-live

End-to-end reactive signals — `@solidjs/signals` on the server, SolidJS `Accessor` on the client, `AsyncIterable` on the wire.

`solid-live` supplements SolidJS with three primitives for server↔client reactivity:

| Primitive            | Side   | What it does                                                                    |
| -------------------- | ------ | ------------------------------------------------------------------------------- |
| `live(fn)`           | Server | Watches a reactive expression, yields an `AsyncGenerator` of its values         |
| `events()`           | Server | Push/iterate pair for discrete events (not state)                               |
| `createLive(source)` | Client | Converts `AsyncIterable` into a SolidJS `Accessor` with `.pending` and `.error` |

Everything else uses standard SolidJS: `createSignal` for state, `createMemo` for derivations, `createResource` for mutation lifecycle, `createEffect` for side effects. `solid-live` doesn't reinvent these.

## The problem

Server-pushed state routed through a request-response cache (TanStack Query) introduces accidental complexity: experimental streaming APIs, parallel store workarounds for synchronous reactivity, and cache key management for data that's already being pushed to you.

Imperative pub/sub (`channel.publish(value)`) is the manual version of what reactive signals do automatically.

## The idea

Signals on both sides, wire in the middle:

- **Server** (`@solidjs/signals` + `solid-live/server`): `createSignal` for state, `live()` to bridge signals → AsyncIterable, `events()` for discrete events
- **Client** (`solid-live/solid`): `createLive` to turn the stream back into a SolidJS signal. Mutations are plain RPC calls.

The transport layer (oRPC, gRPC, WebSocket, SSE) stays separate. `solid-live` only cares about `AsyncIterable<T>` — the universal streaming interface.

## Tutorial

We're building a **worker dashboard** — a small app where you can spawn background workers, watch them tick in real time, pause them, kill them. Think of it as a tiny process manager.

The app has two parts:

- A **server** (Node.js) that manages workers and holds their state as reactive signals
- A **client** (SolidJS in the browser) that displays the workers and lets you interact with them

They talk over a WebSocket. The server pushes state changes to the client automatically — no polling, no manual cache updates.

Let's see it first, then build it.

### See the finished app

```sh
cd solid-live/examples/full && just dev
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
import { live } from "solid-live/server";

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
import { createEffect } from "solid-js";
import { createLive, type LiveSignal } from "solid-live/solid";
import { client } from "./rpc";

type WorkerMeta = { name: string; tickCount: number; status: string };

function WorkerCard() {
  // LiveSignal<T> extends Accessor<T | undefined> — it's a real SolidJS signal.
  // Call it to read the value, use it in JSX, pass it to createEffect — it works
  // everywhere a SolidJS signal works.
  const meta: LiveSignal<WorkerMeta> = createLive(() =>
    client.worker.onMetadataChange(),
  );

  // Works in createEffect — proves it's a real signal
  createEffect(() => {
    console.log("tick count changed:", meta()?.tickCount);
  });

  // Works as derived accessors
  const name = () => meta()?.name;
  const ticks = () => meta()?.tickCount ?? 0;

  // Works in JSX — reactive, fine-grained
  return (
    <div>
      {name()} — {ticks()} ticks
    </div>
  );
}
```

Open the browser. We should see "alpha — 0 ticks", then "alpha — 1 ticks", "alpha — 2 ticks"... updating every second, with each change logged to the console by `createEffect`. The server writes to a signal, `live()` streams it, `createLive` turns it back into a SolidJS `Accessor`. End-to-end signals.

`meta()` returns `WorkerMeta | undefined` (undefined until the first event). `meta.pending()` and `meta.error()` are also SolidJS accessors for lifecycle state. Because `createLive` uses `createStore` + `reconcile` internally, `ticks()` only re-renders when `tickCount` actually changes.

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
import { createLive } from "solid-live/solid";

function WorkerDashboard() {
  const list = createLive(() => client.worker.list());

  return (
    <>
      <button onClick={() => client.worker.create()}>+ New Worker</button>
      <For each={list()}>{(info) => <WorkerCard id={info.id} />}</For>
    </>
  );
}
```

Click "+ New Worker". The server creates a worker, `workerList` updates, `live()` pushes, `createLive` re-renders the list. We didn't touch the list ourselves — the mutation is a plain RPC call, the list update arrives through the signal.

At this point we have a working dashboard: create workers, watch them tick, see the list update. All with `live()` on the server and `createLive` on the client.

### Part 2: Events with `events()`

State covers values that _are_ — the worker list, metadata. But workers also produce things that _happen_: tick log lines and activity samples. These don't have a "current value" — they're discrete events. We use a different primitive for these.

#### Server: push events

`events()` returns a push/iterate pair. We push from domain logic:

```ts
import { events } from "solid-live/server";

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
  (samples() ?? []).map(([, active]) => (active ? "▓" : "░")).join("");
```

Each event from the server folds into the array. The sparkline fills in as the worker ticks.

### What we built

A server holding state in signals, a client rendering that state reactively, connected by a WebSocket. No manual pub/sub on the server, no cache layer on the client. Three primitives from `solid-live`, everything else standard SolidJS:

- **`live()`** — server signals → stream (for state)
- **`events()`** — push/iterate (for things that happen)
- **`createLive()`** — stream → SolidJS signal (for rendering)
- Mutations are plain RPC calls. Use `createResource` if you need loading/error tracking.

The full working code is in [`examples/full/`](./examples/full/).

## Reference

### Server

Server state uses `@solidjs/signals` (`createSignal`, `createMemo`, `createRoot`, `flush`). Import those directly from `@solidjs/signals`. The `solid-live/server` module exports the bridging primitives:

#### `live(fn)`

Bridges a reactive expression to an AsyncGenerator. Tracks all signal reads inside `fn`. When any dependency changes, re-evaluates and yields the new value.

```ts
import { live } from "solid-live/server";

yield * live(() => count())(signal);
```

First yield is the snapshot. Subsequent yields are live updates. The signal graph handles dependency tracking — no manual subscribe/publish.

#### `events()`

Creates a push/iterate pair for discrete events.

```ts
import { events } from "solid-live/server";

const [push, iterate] = events<ActivitySample>();

push([Date.now(), true]);

for await (const sample of iterate(signal)) {
  /* ... */
}
```

Events are buffered from the moment `iterate()` is called, not when `for-await` starts.

### Client (`solid-live/solid`)

#### `createLive(source, options?)`

Converts `Promise<AsyncIterable<T>>` into a SolidJS signal.

Returns a callable signal function (like `createResource`). Call it to read the value. `.error`, `.pending`, `.mutate` are properties on the function.

```tsx
import { createLive } from "solid-live/solid";

const meta = createLive(() => client.terminal.onMetadataChange({ id }));
meta(); // T | undefined — this IS a SolidJS reactive read
meta.pending(); // true until first event
meta.error(); // Error | undefined

// Fine-grained — only re-renders when cwd changes:
const cwd = () => meta()?.cwd;

// Accumulating — events fold via reducer:
const samples = createLive(() => client.terminal.onActivityChange({ id }), {
  reduce: (acc, item) => [...acc, item].slice(-200),
  initial: [],
});
samples(); // ActivitySample[]
```

## Design decisions

**Signals on the server.** State is `createSignal` / `createMemo` from `@solidjs/signals`. Mutations are signal writes. `live()` bridges the reactive graph to AsyncIterable. No manual publish — the signal graph IS the notification system.

**State vs events.** `live()` is for values that change (metadata, lists, preferences). `events()` is for things that happen (activity samples, log lines). Different concerns, different primitives.

**`createLive` returns a SolidJS signal.** `meta()` reads the value — a real reactive read, not a wrapper. `.error`, `.pending`, `.mutate` are properties on the signal function, following SolidJS's `createResource` pattern. Composition is just `() => meta()?.git`.

**`createStore` + `reconcile` for objects.** Ensures `() => meta()?.cwd` only triggers when `cwd` actually changes.

**`@solidjs/signals` as the reactive runtime.** Beta (v0.13.x), but the coupling is bounded: 4 functions (`createRoot`, `createEffect`, `onCleanup`, `flush`), 1 file (~30 LOC). Works on Node.js with no hacks.

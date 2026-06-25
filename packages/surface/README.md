# @kolu/surface

A small framework for typed reactive state in SolidJS clients backed by an oRPC streaming server. Declare the surface once; the framework derives the contract, wires the server, and binds the client hooks.

Four primitives cover the majority of typed server-to-client signal a Solid client consumes:

| Primitive | The question it answers | Cardinality | What the server sends | Persistable | Mutable from client | Has current value |
|-----------|-------------------------|-------------|------------------------|-------------|---------------------|-------------------|
| `Cell<T>` | "What's the current X?" | One singleton | Snapshot then deltas (push on change) | Optional | Yes | Yes |
| `Collection<K,T>` | "What's the current X for each key K?" | Many, keyed | Per-key snapshot then deltas | Optional | Yes | Yes (per key) |
| `Stream<I,T>` | "What's the live output for input I?" | One per input combo | Snapshot then deltas (push on derived-state change) | Never | No (read-only) | Yes |
| `Event<I,T>` | "Has X happened yet?" | Occurrences over time | Zero or more occurrences (no snapshot) | Never | No (read-only) | **No** — handler-based |

The first three (Cell, Collection, Stream) are *state* — there's a current value the consumer renders. `Event` is *occurrence* — a handler fires per yield, no current value to read. Anything genuinely outside these shapes — bidirectional binary streams, commands, queries — stays as raw oRPC.

## Why four primitives, not one

Each captures a structurally distinct shape that bites at runtime if collapsed:

- **Cell vs Collection** — folding many keyed values into a single `Cell<Map<K,V>>` makes every subscriber re-render when any key changes. Independent peers should be observable independently.
- **Cell/Collection vs Stream** — Streams are computed views over external state (the file system, git, network) the server doesn't own. Caching them as Cells means the framework would have to invalidate state it doesn't manage.
- **Cell vs Stream** — Cells are identities over time (same logical entity, value evolves). Streams are functions being re-evaluated. The semantic difference shows up in mutation: you can `set` a Cell; you can't `set` a Stream's output without becoming the cache.
- **Stream vs Event** — Streams have a current value that's rendered (every consumer reads `sub()`); the wire promises a fresh snapshot on every (re-)subscribe. Events are point-in-time fires consumed via handler — no current value, no snapshot obligation, late subscribers miss past occurrences. Modelling `terminal.onExit` as a `Stream<{id}, ExitCode>` would force the consumer to render an iterator that yields once and closes — the wire shape would lie about cardinality.

## Install

This is a workspace-private package. Wire it into both server and client packages:

```jsonc
// packages/server/package.json + packages/client/package.json
{
  "dependencies": {
    "@kolu/surface": "workspace:*"
  }
}
```

## Two ways in

**Manual** — hand-list each primitive (`cell({...})`, `collection({...})`, `stream({...})`, `event({...})`), hand-list the oRPC contract that talks to them, hand-wire the server's handlers, hand-pass `source`/`mutate` refs to `useCell`/`useCollection`/etc. Maximum flexibility; substantial plumbing per descriptor.

**Surface** (`@kolu/surface/define`) — one `defineSurface({...})` declaration covers every Cell, Collection, Stream, Event, and imperative procedure the app exposes. From it the framework derives:

- `surface.contract` — replaces the hand-written `oc.router({...})` literal.
- `implementSurface(surface, deps)` — replaces the per-verb `t.X.<verb>.handler(handlers.<verb>)` plumbing (server-side).
- `surfaceClient(surface, link)` — replaces hand-passed `source`/`mutate`/`valueSource`/`keyToInput` at every hook call site (client-side). The `link` is any member of the link family below — `surfaceClient` is transport-agnostic.

Every surface also carries one **framework-reserved procedure**, `surface.system.live` (`@kolu/surface/liveness`), injected by `defineSurface` and auto-answered by `implementSurface` — no app declares or implements it. It is a contract-agnostic liveness round-trip a client-side watchdog can call to tell a live link from a silently half-open one, *without* each app nominating its own probe verb. `probeSurfaceLive(client)` is the one-liner that calls it; the browser-leg `createHeartbeat` (`@kolu/surface-app/connect`) and the ssh-leg `HostSession` watchdog (`@kolu/surface-nix-host`) both default their probe to it, so liveness is on by construction and there is no probe for an app to forget. It merges into an app's own `system` namespace (e.g. kaval's `system.heartbeat`) and only rejects a duplicate `live` verb.

A surface is reached through one of several **links**. A link maps "a way to reach the served contract" to a `ContractRouterClient<contract>` (the client is the only abstraction that spans all of them — the direct link has no transport at all):

- `websocketLink(ws)` (`@kolu/surface/links/websocket`) — over a WebSocket; the browser path.
- `stdioLink({ read, write })` (`@kolu/surface/links/stdio`) — over a subprocess / ssh stdio pair.
- `unixSocketLink({ socketPath })` (`@kolu/surface/links/unix-socket`) — over a local unix socket; the local-IPC path to a daemon on the same machine (kaval-tui → kaval / kolu-server's pty-host). Async (it dials), and returns `{ client, dispose }` because it owns the socket it opened; the serve side is `serveOverUnixSocket` (`@kolu/surface/unix-socket`). Same framing as the stdio pair — a connected `net.Socket` is just a Duplex.
- `directLink(router)` (`@kolu/surface/links/direct`) — the **identity element**: in-process, no wire. Feed it `implementSurface(surface, deps).router` and every call invokes the handlers directly (microtask-deferred), so the consumer holds the exact `ContractRouterClient<contract>` a socket/ssh consumer would — byte-identical across a later transport swap. Useful for tests, single-process deployments, or the in-process phase of a service that will later be decoupled behind a socket. (Streams come back as async iterables, exactly as the wire-link clients yield them.)

`createLoopbackPair()` (`@kolu/surface/loopback`) is **not** a link — it's the in-process transport *primitive* you feed into `stdioLink` + `serveOverStdio` to exercise the wire codec without forking (so it lives outside `links/`). The serve side is `implementSurface(surface, deps)` (→ a router) plus, for wire links, `serveOverStdio({ router, transport })`.

The surface is opt-in. Reach for it when you're standing up a new app surface or writing a self-contained module; stay manual when an existing wire shape doesn't match the surface's verb-naming defaults (currently `get`/`patch`/`set`/`test__set` for cells, `keys`/`get`/`update`/`delete`/`test__set` for collections — see the example for the full set). The two approaches compose: spread `surface.contract` alongside a sibling `oc.router({...})` of raw procedures, and similarly for `implementSurface`'s output.

See `## Surface` below and `packages/surface/example/` for three end-to-end demos:

- **`example/` — notes app** (single-process WebSocket): exercises every primitive against an in-memory store. The canonical "first surface" tour.
- **`example/remote-process-monitor/` — three-tier bridge**: a SolidJS browser ↔ Node parent ↔ remote agent over `ssh` stdio. The agent reads `/proc` (linux) or `sysctl` (darwin), exposes a typed surface, and the parent re-serves it to the browser using the framework's WebSocket transport. Exercises the R-1.5 additions — stdio link, peer-server, in-process loopback (for tests), in-memory channel — in the same shape Kolu R-2's `RemoteTerminalBackend` will use.
- **`example/mini-ci/` — a CI-runner TUI over stdio** (no browser): a long-lived runner owns a task DAG and streams it to a terminal client over `stdioLink` — a node-state Cell, a per-node log Stream (snapshot-then-delta), and a `rerun` mutation. The TUI drives the runner via `HostSession` **the drishti way** — `nix copy` the prebuilt `mini-ci-runner` closure to the host, realise it, run `--stdio` over ssh — and the default pipeline runs **real typecheck CI** for the remote-process-monitor example (`tsc --noEmit` over its dependency closure). The falsifiability test for "interactive TUI over oRPC stdio" and the structural twin of [`kolu-tui`](../../docs/atlas/src/content/atlas/pty-daemon-tui.mdx)'s `list`/`attach`/input.

## Architecture

The framework is intentionally non-magical: it does **not** auto-derive an oRPC contract via runtime reflection. TypeScript needs the contract literal at compile time for the typed client to work end-to-end. Consumers hand-list contract entries in their own `oc.router({...})` and pass the matching descriptor to the framework's helpers.

(For surface-driven consumers, `surface.contract` *is* a literal at compile time — it's built statically from the spec by `defineSurface`. The contract is still hand-listed; the surface just reads each entry once instead of you typing it twice.)

```
                  ┌─────────────────────────┐
                  │ kolu-common/surface.ts    │   Descriptors live here.
                  │   cell, collection,     │   Pure data: name, schemas,
                  │   stream descriptors    │   defaults. No runtime behavior.
                  └─────────────────────────┘
                          │              │
                          │ imports      │ imports
                          ▼              ▼
       ┌───────────────────────┐   ┌───────────────────────┐
       │ server:               │   │ solid:                │
       │   implementSurface,   │   │   surfaceClient,      │
       │   cellHandlers,       │   │   useCell,            │
       │   collectionHandlers, │   │   useCollection,      │
       │   streamHandlers,     │   │   useStream,          │
       │   eventHandlers,      │   │   useEvent,           │
       │   confStore /         │   │   unenrolledStreamCall│
       │   publisherChannel    │   │   (Solid hooks)       │
       └───────────────────────┘   └───────────────────────┘
```

## Cell

A singleton typed value. The server owns the canonical state; clients subscribe with snapshot-then-deltas semantics.

### Define

```ts
// packages/common/src/surface.ts
import { cell } from "@kolu/surface";
import { z } from "zod";

export const PreferencesSchema = z.object({
  theme: z.string(),
  shuffleTheme: z.boolean(),
  // ...
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const preferences = cell({
  name: "preferences",
  schema: PreferencesSchema,
  default: { theme: "light", shuffleTheme: false },
});
```

### Server-side handler

`cellHandlers` returns the four handler bodies a typed cell needs (`get`, `set`, `patch`, `test__set`). Persistence and pub/sub plug in via `CellStore<T>` and `Channel<T>` interfaces — adapters for `conf` (`confStore`) and `@orpc/experimental-publisher` (`publisherChannel`) ship with the framework.

```ts
// packages/server/src/router.ts
import { cellHandlers, confStore, publisherChannel } from "@kolu/surface/server";
import { preferences } from "kolu-common/surface";

const handlers = cellHandlers(preferences, {
  store: confStore<Preferences>(conf, "preferences"),
  bus: publisherChannel<Preferences>(publisher, "preferences:changed"),
  patch: applyPreferencesPatch,  // (current, patch) => next
});

const t = implement(contract);
export const appRouter = t.router({
  preferences: {
    get: t.preferences.get.handler(handlers.get),
    update: t.preferences.update.handler(handlers.patch),
    test__set: t.preferences.test__set.handler(handlers.test__set),
  },
  // ...
});
```

The framework guarantees snapshot-then-deltas on `get` (yields `store.get()` first, then every value pushed to `bus`); `set`/`patch` validate, persist, and broadcast on the same bus. Swap in any `CellStore` (sqlite, redis, in-memory via `inMemoryStore(default)`) or `Channel` (Redis pub/sub, NATS, etc.) without touching the handler logic.

### Client setup

The framework owns the typed-client construction so consumers never reach into framework internals. Build it once at app start:

```ts
// packages/client/src/wire.ts (kolu)
import { websocketLink } from "@kolu/surface/links/websocket";
import type { contract } from "kolu-common/contract";

const ws = new WebSocket(`wss://${host}/rpc/ws`);
export const client = websocketLink<typeof contract>(ws);
```

`websocketLink` installs `ClientRetryPlugin` and returns the typed oRPC client. Hooks accept procedure refs (e.g. `client.preferences.get`) and thread `STREAM_RETRY` retry context internally — there's no `stream` namespace to maintain. For raw streaming RPCs that don't fit a Cell/Collection/Stream descriptor (terminal `attach`, lifecycle `onExit`), use `unenrolledStreamCall(procedure, input, opts)` — same retry context, escape hatch for non-descriptor shapes.

### Client-side hook

```ts
// packages/client/src/settings/usePreferences.ts
import { useCell } from "@kolu/surface/solid";
import { preferences } from "kolu-common/surface";
import { client } from "../cells";

export function usePreferences() {
  return useCell(preferences, {
    source: client.preferences.get,
    mutate: client.preferences.update,
    authority: "local",       // optimistic local apply; ignore server echoes after init
    initial: DEFAULT_PREFERENCES,
    applyPatch: (current, p) => deepMergePrefs(current, p),
  });
}
```

The hook returns:

```ts
{
  value:   () => Preferences | undefined,
  pending: () => boolean,
  error:   () => Error | undefined,
  set:     (next: Preferences) => Promise<void>,
  patch:   (p: PreferencesPatch) => Promise<void>,
  sub:     Subscription<Preferences>,
}
```

### Authority modes

- **`"server"` (default)** — server is canonical. Every server push reconciles into the local view. Mutations RPC; the resulting echo updates the view.

- **`"local"`** — local store is authoritative after init. The first server yield seeds the store; subsequent server pushes are ignored. `set` / `patch` apply locally synchronously (instant UI response), then RPC to the server. The server's echo is intentionally ignored to avoid stomping a just-made client write whose RPC hasn't round-tripped yet.

Local authority is for state where instant UI response gates re-render timing. Without it, every flip introduces a single-frame lag while the round-trip completes.

For non-shallow merges (e.g. discriminated-union nested fields), pass `mergeIntoStore` instead of (or in addition to) `applyPatch`. It receives Solid's `setStore` directly:

```ts
mergeIntoStore: (setStore, patch) => {
  if (patch.tab) setStore("rightPanel", "tab", reconcile(patch.tab));
  if (patch.collapsed !== undefined) setStore("rightPanel", "collapsed", patch.collapsed);
}
```

For high-frequency local-authority writes (a resize splitter firing a patch per frame during a drag), configure `coalesceMs` and opt the individual write in with `{ coalesce: true }` — the **server** round-trip is debounced while the **local** apply stays synchronous:

```ts
const prefs = useCell(preferences, {
  authority: "local",
  initial: DEFAULT_PREFERENCES,
  applyPatch: deepMergePrefs,
  coalesceMs: 150,           // debounce window for opted-in writes
});

prefs.patch({ rightPanel: { size } }, { coalesce: true }); // drag — debounced
prefs.patch({ colorScheme: "dark" });                      // toggle — immediate
```

Coalescing is **per-write, not per-cell**: a plain `patch(p)` still flushes immediately, so a cell mixing volatilities (continuous panel sizes + discrete toggles) doesn't debounce the toggles — a quick reload after a toggle can't lose it. Opted-in patches accumulate through `applyPatch`, so heterogeneous keys written inside one window land in a single flush (the payload stays a patch, not a full-value snapshot) — this requires `applyPatch` to be a pure spread-merge, enforced at construction. A coalesced `patch` resolves after the local apply, not the server ack; flush failures surface via `onError`.

## Collection

A keyed dictionary of typed values. Each key is independently observable; the live key set is its own subscription.

### Define

```ts
import { collection } from "@kolu/surface";

export const terminalMetadata = collection({
  name: "terminalMetadata",
  keySchema: TerminalIdSchema,
  schema: TerminalMetadataSchema,
});
```

### Client-side hook

```ts
const meta = useCollection(terminalMetadata, {
  keys: () => terminalIds(),  // caller-provided live key set (any reactive accessor)
  valueSource: client.terminal.onMetadataChange,
  keyToInput: (id) => ({ id }),  // adapt key shape to the procedure's input shape
});

meta.keys();          // Accessor<TerminalId[]>
meta.byKey(id);       // Subscription<TerminalMetadata> | undefined
meta.byKey(id)?.();   // current value or undefined
```

`keyToInput` is required when the procedure's input shape isn't the bare key — most contracts wrap it (`{ id }`, `{ key }`, etc.). When input is the key itself, omit it.

Per-key subscriptions are managed via `mapArray` so SolidJS handles lifecycle: when a key leaves the live set, its reactive owner is disposed, the per-key subscription's `onCleanup` fires, the AbortController aborts, and the server stream tears down. No manual Map / version signals / abort plumbing required at the call site.

## Stream

A derived view computed on demand from a reactive input. Snapshot-then-deltas, never persisted.

### Define

```ts
import { stream } from "@kolu/surface";

export const gitStatus = stream({
  name: "gitStatus",
  inputSchema: z.object({ repoPath: z.string(), mode: GitDiffModeSchema }),
  outputSchema: GitStatusOutputSchema,
});
```

### Server-side: declarative poll-on-event

For streams that watch external state (git, fs), the framework absorbs the snapshot+install+re-read+isEqual loop. The stream impl declares `read` + `install` + `isEqual`; the framework synthesizes the source internally:

```ts
streams: {
  gitStatus: {
    read: async (input) =>
      unwrapGit(await getStatus(input.repoPath, input.mode, log)),
    install: (input, cb) => subscribeRepoChange(input.repoPath, cb, log),
    isEqual: gitStatusOutputEqual,
  },
}
```

The initial read's exception propagates to the client (first frame); subsequent read failures retry on the next tick — a transient git error shouldn't tear down a long-lived subscription. Subsequent-read errors flow through `onReadError` (per-stream) or the top-level `onStreamReadError` set on `implementSurface`'s deps. The framework refuses to wire a poll-shape stream that has no observability for these failures (boot-time check).

The raw `source: (input, signal) => AsyncIterable<T>` shape stays available for cases that don't fit poll-on-event (custom snapshot computation, long-poll, bidirectional streams). The two shapes are a discriminated union; supplying both is a type error.

### Client-side hook

```ts
const status = useStream(
  gitStatus,
  () => repoPath() ? { repoPath: repoPath(), mode: mode() } : null,
  client.git.onStatusChange,
);

status();          // current GitStatusOutput | undefined
status.pending();  // true between input change and first yield
status.error();    // last subscription error
```

When the input changes, the previous subscription tears down and a fresh one starts; value resets to `undefined` between input change and first yield.

## Event

A point-in-time channel: occurrences flow from server to client, the consumer registers a handler, no current value to render. Distinct from `Stream<I,T>` because the framework guarantees no snapshot on (re-)subscribe — late subscribers miss past occurrences by design. Lifecycle notifications (terminal exit, session expiry, one-shot completions) fit this shape.

### Define

```ts
import { event } from "@kolu/surface";

export const terminalExitEvent = event({
  name: "terminalExit",
  inputSchema: z.object({ id: TerminalIdSchema }),
  outputSchema: z.number(),  // exit code
});
```

### Server-side handler

`eventHandlers` produces the `get` body for the contract entry. The framework explicitly does **not** require the source to yield a snapshot — sources may yield zero, one, or many occurrences before the iterator closes:

```ts
import { eventHandlers } from "@kolu/surface/server";

const exitHandlers = eventHandlers(terminalExitEvent, {
  source: async function* (input, signal) {
    requireTerminal(input.id);
    for await (const code of terminalChannels.exit(input.id).subscribe(signal)) {
      yield code;
      return;  // single-yield-then-close
    }
  },
});

t.terminal.onExit.handler(exitHandlers.get);
```

The split from `streamHandlers` exists so authors can't accidentally wire an event source — which has no snapshot — to a stream handler that promises snapshot-then-deltas.

### Client-side hook

```ts
useEvent(
  terminalExitEvent,
  () => ({ id: terminalId }),
  client.terminal.onExit,
  (exitCode) => {
    toast.warning(`Terminal exited with ${exitCode}`);
    removeAndAutoSwitch(terminalId);
  },
  { onError: (err) => console.error("Exit stream error:", err) },
);
```

`useEvent` returns nothing — there's no `Subscription<T>` because there's no current value to access. Cleanup is signal-driven: by default the subscription dies when the reactive owner disposes (component unmount or `createRoot` dispose); pass `options.signal` for explicit lifecycle control.

When the input accessor returns `null` the subscription is paused; when it changes, the previous subscription tears down and a fresh one starts.

## Health & gating

Each primitive exposes its own `error()` / `pending()`, but a consumer that wants ONE "is this surface healthy" answer used to hand-fold them — and a hand-fold is where a *latch* creeps in (a `?? prev` that freezes the UI on a stale error after the link has already recovered — kolu#1564). `client.health()` graduates that fold into the framework.

```ts
const app = surfaceClient(surface, link);

app.health();
// { live: boolean, subs: [{ name: string, pending: boolean, error: Error | undefined }] }
```

It's a **FACT, not a verdict**: a reactive accessor that enrols every **framework** subscription the client creates — each cell (`"<cell>"`), a collection's keys-stream (`"<coll>.keys"`) and each per-key value sub (`"<coll>[<id>]"`), and every stream (`"<stream>"`). A _raw_ stream (one that owns its own loop) is NOT auto-enrolled — it joins the fact through `client.rawStream`, the structural path below, which makes forgetting impossible rather than merely discouraged. Each sub's error flows through its own *self-clearing* reactive `error()`, so the fact **un-latches by construction** — a transient blip disappears from `health()` the instant the stream re-delivers. `live` is the transport's liveness: the socket transports thread the real signal in (`@kolu/surface-app`'s `connectSurface` passes `{ live: () => status() === "live" }`, so a `down`/`reconnecting` socket reads `live: false` and the gate reads `connecting`, never a confident `ready` over a dead link), while a direct/stdio link — which can't be silently half-open — defaults to a constant `true`.

`<SurfaceGate>` owns the **policy** — it derives `connecting | degraded | ready` from the fact. Its DEFAULT is **stale-while-degraded** (the gentler policy the design judged better): it renders children while ready OR degraded — a transient sub error keeps the last-good UI on screen with a non-blocking notice — and shows the fallback only while `connecting`. HARD-GATING (blank the surface the instant anything errors) is the harsher policy, so it is the explicit OPT-IN via `ready` (see the override below):

```tsx
// `<SurfaceGate>` is JSX, so it ships from its own entry point — the main
// `@kolu/surface/solid` barrel stays JSX-free so consumers that import it only
// for the hooks/registry don't have to solid-transform a component they don't use.
import { SurfaceGate } from "@kolu/surface/solid/SurfaceGate";

<SurfaceGate health={app.health}>
  <Dashboard />
</SurfaceGate>;

// Override `ready` to HARD-GATE — blank the surface the instant anything errors
// (stricter than the stale-while-degraded default). The fact/policy split is real
// in-repo: pulam-web's fleet board hard-gates like this (a stale roster over a
// broken link is worse than a blank one), while drishti renders-while-degraded
// over the SAME `client.health()` fact — one fact, two policies.
<SurfaceGate
  health={app.health}
  ready={(h) => h.live && !h.subs.some((s) => s.error)}
  fallback={(h) => <Connecting error={h().subs.find((s) => s.error)?.error?.message} />}
>
  <Dashboard />
</SurfaceGate>;
```

A raw stream that doesn't fit a Cell/Collection/Stream descriptor (a bulk snapshot feed, a binary attach) owns its own loop, so the framework can't enrol it for you — but it can't silently escape the fact either. Drive it through **`client.rawStream`**, the STRUCTURAL path: it owns the `pending`/`error`, enrols them, runs the consume loop (self-clearing on each frame), aborts on cleanup, and **throws if called outside a reactive owner** (a no-owner enrolment would leak — the same structural guard `createSubscription` raises for `reduce`-without-`initial`). Forgetting to enrol isn't possible, not just discouraged:

```ts
app.rawStream("metricHistory", app.rpc.surface.metricHistory.get, {}, {
  onItem: (msg) => fold(msg),
});
```

For a stream that ALREADY owns its `pending`/`error` — a `createSubscription` over a surface procedure — JOIN it with the lower-level `client.enroll(name, source)` (a `Subscription` *is* a valid source):

```ts
const sub = createSubscription(
  () => unenrolledStreamCall(app.rpc.surface.x.get, {}, { signal }),
  { reduce, initial },
);
app.enroll("x", sub); // auto-disposes with the owner
```

The bare `unenrolledStreamCall` lives at `@kolu/surface/client`, NOT on the `@kolu/surface/solid` barrel: a surface-scoped raw stream must go through `client.rawStream` (so it can't escape `health()`), and a stream that is NOT a surface subscription (a root RPC outside any surface — e.g. a terminal attach with its own in-pane retry UX) reaches for the low-level primitive *deliberately*, a visible "I own this stream's health myself" decision rather than a forgotten enrol.

For a multi-surface app (`surfaceClients`), `surfaceClientsHealth(clients)` folds every sibling client's health into one fact (prefixing each sub's name with its surface key, AND-reducing `live`) that a single `<SurfaceGate health={() => surfaceClientsHealth(clients)}>` gates on — drishti folds its admin + surface-app siblings this way for a control-plane health strip.

## How Kolu uses this framework

Kolu serves **two sibling surfaces** over its one transport (kolu#1197): its own domain surface under `surface.kolu.*` (the descriptors inventoried below) and [`@kolu/surface-app`](../surface-app)'s complete surface under `surface.surfaceApp.*` (the `buildInfo` cell + the `identity.info` restart probe). They're composed by key via `composeSurfaceContracts` / `implementSurfaces` / `surfaceClients` (see [Multiple surfaces over one transport](#multiple-surfaces-over-one-transport)), not merged. On the client the `kolu` bundle is re-exported as `app` (`= clients.kolu`) so existing `app.cells.X` call sites are unchanged, and the surface-app bundle is `surfaceApp`.

Concrete inventory — what every server-pushed reactive surface in the `kolu` sibling maps to today.

### Cells

| Descriptor | Backs | Authority | Mutation | Persistence |
|---|---|---|---|---|
| `preferencesCell` | User preferences (theme, scrollLock, sound, right-panel workspace chrome — collapsed/size/codeTabTreeSize — …) | `local` (instant UI) | `client.preferences.update(patch)` | `confStore("preferences")` |
| `terminalListCell` | Live terminal list — drives the dock, canvas tile set, mobile swipe order | `server` | _server-only_ (via `terminal.create` / `kill` mutations) | `inMemoryStore` (registry is canonical) |
| `activityFeedCell` | Recent repos cd'd into + recent agent CLIs spotted via OSC 633;E | `server` | _server-only_ (via `trackRecentRepo` / `trackRecentAgent`) | `confStore("activityFeed")` |
| `savedSessionCell` | Last-persisted snapshot of terminals + active id (drives session restore) | `server` | _server-only_ (debounced autosave on `terminals:dirty`) | `confStore("session")` |

### Collections

| Descriptor | Backs | Mutation |
|---|---|---|
| `terminalMetadataCollection` | Per-terminal metadata (cwd, git, PR, agent state, foreground process, last-activity timestamp for switcher recency, **right-panel per-terminal state** — activeTab, codeMode, per-mode selected file — and sub-panel state) — each terminal's tile chrome and inspector reads its own key | _server-only_ (providers in `terminalBackend/providers.ts` route writes through `updateServerMetadata` for persisted fields and `updateServerLiveMetadata` for live-only fields — `pr`, `agent`, `foreground` — so the high-frequency agent-stream watcher doesn't fire `terminals:dirty` and trigger no-op session autosaves; the agent provider switches to the persisting variant on each semantic-key transition that bumps `lastActivityAt`) |

### Streams

| Descriptor | Backs |
|---|---|
| `gitStatusStream` | Code-view's Local/Branch mode file list (changed files) |
| `gitDiffStream` | Code-view's unified diff for the selected file |
| `fsListAllStream` | Code-view's All mode tree (full repo path list) |
| `fsReadFileStream` | Code-view's All mode body — discriminated by `kind`: `text` yields the file content for Pierre's syntax-highlighted viewer; `binary` yields a cache-busted URL pointing at `/api/terminals/<id>/file/<path>?v=<mtime>` for the route-served viewer — the iframe-preview viewer (`.html`/`.svg`/`.pdf`) or a plain `<img>` for raster images (`.png`/`.jpg`/`.gif`/`.webp`/`.ico`), a client-side presentation split below the wire boundary. One subscription path; mtime bump on save re-yields a fresh URL so the viewer reloads. |

### Events

| Descriptor | Backs |
|---|---|
| `terminalExitEvent` | Per-terminal one-shot exit notification — drives the exit toast and the active-terminal auto-switch in `useTerminals` |

### Raw oRPC (everything else)

Shapes that don't fit a descriptor stay as plain oRPC procedures.

| Pattern | Procedures | How to consume |
|---|---|---|
| **Bidirectional binary stream** — subscribe-before-yield ordering, custom `onRetry` (xterm buffer reset before re-subscribe's first frame) | `terminal.attach` | `unenrolledStreamCall(client.terminal.attach, { id }, { signal, onRetry })` |
| **One-shot queries** — request/response, no subscription dimension | `server.info`, `terminal.screenState`, `terminal.screenText`, `terminal.exportTranscriptHtml` | `await client.X.Y(input)` |
| **Mutations** — request/response writes | `terminal.create` / `kill` / `killAll` / `resize` / `sendInput` / `setTheme` / `setCanvasLayout` / `setSubPanel` / `setRightPanel` / `setActive` / `setParent` / `pasteImage` / `uploadFile`, `daemon.restart`, `git.worktreeCreate` / `worktreeRemove`, `preferences.update` | `await client.X.Y(input)` (the retry plugin's `retry: 0` default fails them fast) |

`unenrolledStreamCall` applies the same `STREAM_RETRY` context the descriptor hooks thread (and merges in an optional `onRetry` callback) so transport drops re-subscribe transparently — escape hatch for non-descriptor shapes, same retry semantics.

_The shared property of the "raw" rows: there's no temporal sequence of values for a given identity that the client cares to subscribe to. The framework is for typed reactive state pushed from server to client (Cell/Collection/Stream) plus typed point-in-time fires (Event); everything else stays raw._

### Adding a new descriptor — worked example

Surface mode keeps the addition cost at **two files**. To add (say) a new `windowBounds` cell tracking last window position/size:

**1. `packages/common/src/surface.ts`** — declare schema + descriptor entry on the spec:

```ts
export const WindowBoundsSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const surface = defineSurface({
  cells: {
    // ...existing cells...
    windowBounds: {
      schema: WindowBoundsSchema,
      default: { x: 0, y: 0, w: 1280, h: 800 },
      verbs: ["get", "set", "test__set"],
    },
  },
  // ...collections / streams / events / procedures unchanged...
});

export type WindowBounds = Surface["cells"]["windowBounds"]["Value"];
```

**2. `packages/server/src/surface.ts`** — add one wiring entry under `cells`:

```ts
const windowBoundsStore = confStore<WindowBounds>(store, "windowBounds");

implementSurface(surface, {
  channel: ...,
  cells: {
    // ...existing cells...
    windowBounds: { store: windowBoundsStore },
  },
  // ...collections / streams / events / procedures unchanged...
});
```

If the new field needs to seed existing users' on-disk state, bump `SCHEMA_VERSION` in `state.ts` and add a migration — the standard `Conf` ladder, untouched by the framework.

**Client gets it for free.** `app.cells.windowBounds.use({ initial })` reads it; `app.cells.windowBounds.set(next)` writes. No wire-handler to write, no hook to maintain, no oRPC contract entry to edit — `surface.contract` is recomputed from the spec on every build.

Adding a new collection, stream, or event follows the same shape: spec entry in `common/surface.ts` + wiring entry in `server/surface.ts`. _The 2-file invariant is the framework's value proposition — flag it in code review if the count creeps up._

## Surface

`defineSurface({...})` declares the whole reactive surface of an app at one site. The example (`packages/surface/example/`) ships a working surface end-to-end — start there for a runnable reference.

```ts
// common/surface.ts
import { defineSurface } from "@kolu/surface/define";
import { z } from "zod";

export const surface = defineSurface({
  cells: {
    prefs: {
      schema: PrefsSchema,
      default: DEFAULT_PREFS,
      patchSchema: PrefsPatchSchema,
      // `patch` lives on the spec so server and client apply patches via
      // the same merge fn — no helper imported in two places.
      patch: (current, p) => ({ ...current, ...p }),
    },
  },
  collections: {
    notes: { keySchema: z.string(), schema: NoteSchema },
  },
  streams: {
    search: { inputSchema: SearchInputSchema, outputSchema: SearchResultSchema },
  },
  events: {
    autosave: { inputSchema: z.string(), outputSchema: AutosaveSchema },
  },
  // Imperative escape hatch — non-descriptor RPCs share the namespace.
  procedures: {
    notes: { create: { input: NoteCreateSchema, output: NoteSchema } },
  },
});

// Use `surface.contract` at server (`implement(surface.contract)`) and
// client (a link — `websocketLink<typeof surface.contract>(...)`) — no
// separate `contract.ts` re-export needed.
```

### Server

```ts
// server/router.ts
import { implementSurface, publisherChannel } from "@kolu/surface/server";

export const appRouter = implementSurface(surface, {
  channel: <T>(name: string) => publisherChannel<T>(publisher, name),
  cells:       { prefs: { store, patch: patch } },
  collections: { notes: { readAll, upsert, remove } },  // persistence-only; surface wraps publish
  streams:     { search: { source } },
  events:      { autosave: { source } },
  procedures:  {
    notes: {
      // ctx exposes surface-wrapped helpers; cross-descriptor publishes
      // route through the same channels the wire handlers do.
      create: async ({ input, ctx }) => {
        const note = { id: nextId(), ...input };
        ctx.collections.notes.upsert(note.id, note);
        return note;
      },
    },
  },
});
```

The surface derives publish channel names and they are not configurable: cells use `"<key>:changed"`, collections use `"<key>:keys"` + `"<key>:" + String(k)`, events use `"<key>:" + eventChannelKey(input)`. Renaming a surface key thus renames the channel — for cells whose channels back persisted subscriptions, prefer adding a new key and migrating off the old one.

### Client

```ts
// client/wire.ts
import { surfaceClient } from "@kolu/surface/solid";
import type { ContractRouterClient } from "@orpc/contract";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";

export const app = surfaceClient<
  typeof surface.spec,
  ContractRouterClient<typeof surface.contract, ClientRetryPluginContext>
>(surface, { websocket });

// In components:
const prefs = app.cells.prefs.use({ authority: "local", initial: DEFAULT_PREFS, applyPatch });
const notes = app.collections.notes.use({ onError });
//   notes.keys()         — Accessor<K[]>, defaults to the server's keys stream
//   notes.byKey(id)?.()  — Subscription<T> per key
//   notes.upsert(k, v)   — bound mutation (also at app.collections.notes.upsert)
//   notes.delete(k)      — bound mutation (also at app.collections.notes.delete)
// Pass `keys` explicitly only to filter or derive (e.g. from a parent list).
const search = app.streams.search.use(searchInput, { onError });
app.events.autosave.use(selectedId, handler, { onError });

// Lifecycle-free mutation paths — call from anywhere, including
// outside a component:
await app.collections.notes.upsert(id, value);

// Imperative procedures (the escape hatch for verbs the primitives
// can't model — `notes.create` assigns the id server-side) go through
// `app.rpc` under the `surface.*` namespace `defineSurface` wraps
// everything in:
await app.rpc.surface.notes.create({ title: "Untitled" });
```

### Composing with raw oRPC

For RPCs the surface can't model — bidirectional binary streams (`terminal.attach`), custom `onRetry` hooks, or any wire shape outside the cell/collection/stream/event taxonomy — keep them in a sibling `oc.router({...})` and merge:

```ts
export const contract = oc.router({
  ...surface.contract,
  terminal: rawTerminalContract,  // hand-written for terminal.attach + friends
});
```

On the server, `implementSurface(surface, deps)` returns `{ router, ctx }`; spread `router` into the host `t.router({...})` block alongside hand-written handlers, and import `ctx` from domain code for typed mutations (`ctx.cells.X.set(...)`, `ctx.collections.X.upsert(k, v)`, `ctx.events.X.publish(input, payload)`) — the surface owns the apply+publish chain so parallel `store.set + bus.publish` paths don't drift.

### Multiple surfaces over one transport

An app can serve **more than one independent surface** — its own domain surface plus a library's complete surface (e.g. [`@kolu/surface-app`](../surface-app)'s build-identity + restart-probe surface) — multiplexed over one transport, each namespaced under a key. Don't merge them into a single `defineSurface`; serve them as **siblings** (kolu#1197):

```ts
// common — ONE keyed `surfaces` map is the single source of which surfaces exist
// under which keys. It's browser-safe (just Surfaces), so the contract AND the
// client both read it. composeSurfaceContracts lives in @kolu/surface/define.
export const surfaces  = { kolu: koluSurface, surfaceApp: surfaceAppSurface };
export const contract  = composeSurfaceContracts(surfaces);
//   → { surface: { kolu: <koluInner>, surfaceApp: <surfaceAppInner> } }
//   wire paths: surface.kolu.<prim>.<verb>  ·  surface.surfaceApp.<prim>.<verb>

// server — reuse `surfaces`; add only the server-only `deps`, keyed the same way
// (no { surface, deps } wrapper, no re-listing). Per-key deps are typed against
// each surface's own spec. Channels are key-prefixed (`<key>/<name>:changed`) so
// two siblings' `<cell>:changed` can't collide. One router + one keyed ctx.
const { router, ctx } = implementSurfaces(surfaces, { channel }, {
  kolu:       koluDeps,            // = Omit<ImplementSurfaceDeps<koluSpec>, "channel">
  surfaceApp: surfaceAppServer(),  // the library's deps bundle for its surface
});
ctx.kolu.cells.X.set(...)         // ctx is keyed per surface

// client — reuse `surfaces`; one link split into a per-key client bundle,
// each scoped to its surface.<key>.* slice
const clients = surfaceClients(link, surfaces);
clients.kolu.cells.X.use(...)     // e.g. re-export `app = clients.kolu`, `surfaceApp = clients.surfaceApp`
```

`surfaces` is the **single source** across all three calls — `composeSurfaceContracts(surfaces)`, `implementSurfaces(surfaces, …)`, `surfaceClients(link, surfaces)` — so the keys can't drift. Each surface is derived, wired, and typed **independently**; the trio only *keys* them under one `surface` namespace, so `SurfaceSpec` itself never nests. The router-wrapping footgun applies to `implementSurfaces` too: it returns a `{ surface }` fragment, so wrap it with `implement(composeSurfaceContracts(surfaces)).router({...router})` before serving.

A cell whose value arrives **asynchronously at boot** (e.g. a build-identity axis resolved over a link *after* construction) declares an optional **`connect?(cell)`** in its impl deps; the runtime fires it once after wiring to republish the late value through the cell's normal `equals → onWrite → store.set → bus.publish` path — so the app never hand-writes a seed-then-`ctx.cells.X.set` dance.

## Projection (a server that's a client)

The links above move a surface *across* a boundary. `projectSurface` is orthogonal: it derives a **new** surface B whose handlers are implemented by *consuming* an existing surface A through a live client. B is "a server that's a client" — its cells, streams, and events are projections of A's, mapped on the fly. One source of truth (A), N projected faces (B…): a foreign protocol's surface (an MCP server), a public read-only mirror, a narrowed view for a less-trusted peer.

`projectSurface` lives at the **`@kolu/surface/project` subpath** — not the browser-safe root, because it imports the server layer (`implementSurface`, `inMemoryCell`) to wire B's handlers.

The canonical pattern: A is already implemented (`implementSurface` → `{ router }`); B's projection holds an in-process client of A, maps each frame with the `derive*` helpers, then is itself implemented and reached over a `directLink`.

```ts
import { projectSurface, surfaceClientRef, deriveCell, deriveStream } from "@kolu/surface/project";
import { directLink } from "@kolu/surface/links/direct";

// B is declared (not computed from A) — its spec plus a `deps` factory that,
// given a live A-client, returns B's server impl deps. The derive helpers do
// the mapping inside `deps`, each preserving its primitive's wire contract.
const projected = projectSurface(appSurface, {
  spec: { cells: { mirror: { /* … */ } }, streams: { view: { /* … */ } } },
  deps: (a) => ({
    channel: inMemoryChannelByName(),
    cells:   { mirror: deriveCell((o) => a.surface.x.get(undefined, o), map, 0) },
    streams: { view:   deriveStream((i, o) => a.surface.s.get(i, o), map) },
  }),
});

// A is already implemented elsewhere → build an in-process client of it,
// wire B against that client, and reach B over a direct link.
const aClient = surfaceClientRef(appSurface, aRouter);
const { router, ctx } = projected.implement(aClient);
const bClient = directLink<typeof projected.surface.contract>(router);
```

- **`surfaceClientRef(A, router)`** — a surface-typed wrapper over `directLink` that gives B's handlers a live, in-process client of sibling surface A.
- **`deriveCell` / `deriveStream` / `deriveEvent`** — map an upstream A primitive into the matching slot of B's `implementSurface` deps. `deriveCell` tracks A's snapshot-then-deltas and republishes the mapped value through B's cell; `deriveStream` preserves snapshot-then-deltas frame-by-frame; `deriveEvent` is the same wiring typed as an event (no snapshot obligation). Teardown is handled for you: B's abort signal threads into A's call and an abort-time upstream rejection is swallowed, so aborting a B subscription tears down the matching A subscription with no leak.

## Mirror a remote surface into local sinks: `mirrorRemoteSurface`

`projectSurface` *re-serves* A as a new surface B. `mirrorRemoteSurface` does the other thing a consumer of a remote surface needs: it **drives A's primitives into a local handle** — the consume-side **dual of `implementSurface`**. `implementSurface(surface, deps)` walks a spec and wires the *produce* side (server handlers that yield on demand); `mirrorRemoteSurface(surface, client, sink)` walks the *same* spec and wires the *consume* side. It's a **total** dual — it mirrors *every* primitive the producer wires, by kind: **streaming state** (cells/collections/streams/events) is PUSH, subscribed and folded into a caller-supplied **`SurfaceSink`**; a **procedure** is PULL (a local call runs on the remote and returns), so it comes back as a **forwarding stub** on the return alongside `done`. Hence the return is `{ procedures, done }`, not a bare promise:

```ts
import { mirrorRemoteSurface } from "@kolu/surface/mirror";

const { procedures, done } = mirrorRemoteSurface(terminalWorkspaceSurface, client, {
  collections: { awareness: { upsert, remove } },          // keyed map → your store
  streams:     { activity:  { input: {}, onFrame: setLive } }, // a flow → a callback
  // cells:    { version:   (v) => … }, events: { … }       // each streaming kind, one call
}, { signal, log });

await procedures.terminal.kill({ id });  // a procedure → forwarded to the remote, returns its result
await done;                              // resolves when every subscription settles (link closed)
```

> **Breaking change (R7, kolu #1505).** `mirrorRemoteSurface` used to return `Promise<void>` (the #1497 graduation shape) — you would `await mirrorRemoteSurface(...)` to wait for the mirror to settle. It now returns the **plain handle** `{ procedures, done }`. A bare `await mirrorRemoteSurface(...)` therefore **no longer waits** (you'd be awaiting a non-thenable object, which resolves immediately) — the settle is `await mirrorRemoteSurface(...).done`. This is not type-caught when the result is discarded — and a rename wouldn't catch it either, since no TypeScript construct makes `await object` an error — so a stale `await mirrorRemoteSurface(...)` keeps compiling and silently no-ops. That was a **live** hazard: drishti `master` still does `await mirrorRemoteSurface(...)` on its streaming sinks (the #1497 shape it adopted in [drishti PR #70](https://github.com/srid/drishti/pull/70)). The migration is therefore mechanical, not documentary, and now real: the paired [drishti PR #71](https://github.com/srid/drishti/pull/71) — the [surface→drishti merge-gate](../../.claude/rules/surface.md) — audits that call site to `await mirrorRemoteSurface(...).done` and pins drishti's kolu source to this R7 revision; its **full CI is green** against the new `{ procedures, done }` API — all 18 odu nodes (every lane on both `aarch64-darwin` and `x86_64-linux`), exactly the lane set #70 passed for #1497. No back-compat thenable is provided on purpose — the fail-fast rule prefers a deliberate per-site migration over a shim that silently preserves the old await, and the handle's non-thenable contract is pinned in CI by a unit test so the shim can't creep back.

- One call mirrors a **cell, a collection, a stream, an event, AND every procedure** together, instead of a consumer hand-stitching `<coll>.keys`+`<coll>.get`, a separate `<cell>.get` read, a `<stream>.get` loop, and a hand-written procedure relay. The per-key collection bridge that *was* `@kolu/surface-nix-host`'s public `mirrorRemoteCollection` is now the **private** `mirrorCollection` engine inside it — consumers use `mirrorRemoteSurface` only ("you don't sell half a house").
- Each `SurfaceSink<S>` **streaming** entry is **optional** — a primitive is subscribed iff a sink is supplied (the R-2 awareness fold is intended to want only the collection; the fleet board, today, wants the collection + the stream). The sink does **not** re-serve the surface (that's `projectSurface`): a sink can fold frames anywhere — the `pulam-tui` fleet board keys every host's terminals into one `(host, id)` store; kolu's R-2 fold is intended to merge each upsert into its co-owned `terminalMetadata` (a planned/drishti consumer, not yet wired in this repo). Interception is the common case.
- **Procedures are total, not opt-in.** A forwarding stub has no standing cost (it's a typed passthrough to `client.surface.<ns>.<verb>`), so `.procedures` always carries *every* procedure the surface wires — `{}` if it has none. The stubs are bound to the `client` you passed, so a stub is live for that client's lifetime; over a reconnecting transport that hands out a fresh client per spawn, forward through whatever yields the *current* client. A stub matches the **surface client's** verb shape — `(input, { signal? })`, the same as `client.surface.<ns>.<verb>` — *not* `implementSurface`'s handler shape, whose procedures take a single `{ input, ctx, signal }` opts object. So re-serving a mirror wraps each stub in a one-line handler: `double: ({ input, signal }) => procedures.math.double(input, { signal })`. Grafted that way, `serve ∘ mirror ≈ identity` — the location-transparency remote terminals rests on.
- Lives at the **`@kolu/surface/mirror`** subpath (it imports the server layer's abort helpers). The returned `done` settles when every subscription settles — over one shared link, the cue that the link closed.
- **Three failures are distinct, each fail-fast where it matters.** An *upstream* per-primitive error (a remote stream blip) is logged and the subscription settles — one bad stream must not reject the whole mirror. A *sink* failure (your `onFrame`/`upsert`/`remove` throws — a bug in your local fold) is **not** an upstream blip: it **rejects `done`** so the broken fold surfaces, never logged-and-swallowed (the no-fallback rule — a caught error can't collapse to a quietly-resolved mirror). Supplying a sink for a primitive the **client** doesn't expose is a client/surface mismatch — it rejects `done` (fail-fast), where *omitting* a sink is the tolerated "no interest" path. And calling a procedure stub the client doesn't expose **rejects** with the same mismatch error (at call time, never a silent `undefined`).

### See also: `@kolu/surface-mcp`

The sibling package [`@kolu/surface-mcp`](../surface-mcp) re-exposes any surface as an **MCP server** — point it at a live-surface client and a default-deny `expose` allowlist (each cell/stream/event a resource, each procedure a tool) plus optional bespoke `tools`, and `serveSurfaceAsMcp` builds the MCP server: the subscribe/teardown lifecycle, the zod→JSON-Schema bridge, and the resource/tool wiring are the package's. It's built on `projectSurface` for the curation step — shape a narrowed, observer-safe surface in surface-land, then expose *that*. See the package for full docs.

### See also: `@kolu/surface-daemon`

The sibling package [`@kolu/surface-daemon`](../surface-daemon) is the **durable-daemon spine** — both halves of the daemon *binary*. The **serve** half: `acquirePidGate` (the atomic single-instance gate, with `gatePid`/`isHolderLive` single-sourcing the gate's file format) and `daemonMain` (the gate → serve → teardown skeleton, parameterized over scope key, socket path, the surface `router`, and lifetime), built on this package's `serveOverUnixSocket` transport. The **front** half: `frontDaemonOverStdio` — the durable counterpart to this package's `serveOverStdio` (adopt-or-spawn the gate-held daemon and relay an ssh-stdio link onto its socket, so a remote session survives the link) — plus `reExecAsDetachedDaemon`. [kaval](../kaval)'s `bin.ts` (serve) and `--stdio` (front) are thin compositions over it, with `odu serve` the planned second tenant. See the Atlas note `surface-daemon` for the design.

## API reference

### Descriptors (`@kolu/surface`)

```ts
cell({ name, schema, default }): Cell<Name, T>
collection({ name, keySchema, schema }): Collection<Name, K, T>
stream({ name, inputSchema, outputSchema }): Stream<Name, I, T>
event({ name, inputSchema, outputSchema }): Event<Name, I, T>
```

### Surface (`@kolu/surface/define`)

```ts
defineSurface(spec): Surface<S>
  // spec.cells / .collections / .streams / .events / .procedures
  // surface.contract — typed oc.router built from the spec
  // surface.descriptors — underlying primitives keyed by surface path
  // surface.spec — passed-in spec for reflection

composeSurfaceContracts({ <key>: Surface }): { surface: { <key>: <inner> } }
  // key N standalone surfaces under one `surface` namespace (browser-safe — no server import).
  // Spread into the host contract; `typeof` it to type the combined link. Pairs with
  // implementSurfaces (server) / surfaceClients (client).
```

### Server (`@kolu/surface/server`)

```ts
implementSurface(surface, { channel, cells, collections, streams, events, procedures })
  // → oc.router-shape value with all handlers wired
  // a cell dep may carry an optional `connect?(cell)` — the runtime fires it once
  // after wiring to republish a late (async-at-boot) value through the cell's bus

implementSurfaces(surfaces, { channel, onStreamReadError? }, deps)
  // surfaces — the keyed SurfaceMap (the same value passed to composeSurfaceContracts/surfaceClients)
  // deps     — { <key>: Omit<ImplementSurfaceDeps<spec>, "channel"> }, keyed the same as surfaces,
  //            each typed against its surface's spec (no any-spec'd entry map)
  // → { router: { surface: { <key>: … } }, ctx: { <key>: SurfaceCtx } }
  // N standalone surfaces multiplexed over one transport, each namespaced under <key>;
  // channels key-prefixed `<key>/<name>`. Same `{ surface }` fragment + router-wrapping footgun
  // as implementSurface (wrap via implement(composeSurfaceContracts(surfaces)).router(...)).

cellHandlers(cell, { store, bus, patch?, onMutate? }): { get, set, patch, test__set }
collectionHandlers(coll, { readAll, readOne?, upsert, remove, perKeyBus, keysBus }):
  { keys, get, update, delete, test__set }
streamHandlers(stream, { source }): { get }
eventHandlers(event, { source }): { get }

// Storage + bus adapters
inMemoryStore<T>(initial): CellStore<T>
confStore<T>(conf, key): CellStore<T>
publisherChannel<T>(publisher, channelName): Channel<T>
inMemoryChannel<T>(): Channel<T>   // single-process broadcast pub/sub; sibling of publisherChannel for Node-only consumers

interface CellStore<T> { get(): T; set(v: T): void }
interface Channel<T> {
  publish(v: T): void
  subscribe(signal?): AsyncIterable<T>
  consume({ onEvent, onError }): () => void  // subscribe + dispatch + auto-cleanup
}
```

### RPC Origin gate (`@kolu/surface/ws-origin`)

The CSWSH (Cross-Site WebSocket Hijacking) defense for the unauthenticated RPC surface — on **both** transports it travels over. A surface RPC endpoint carries no credentials, so any web page the operator visits could otherwise reach `<host>/rpc/…` and drive the served surface — and **loopback binding does not help**, because the attacker page runs in the operator's own browser. The browser attaches an `Origin` header; these gates verify it. They are the transport-security sibling of surface-app's `gateStaleSocket`.

Gate **both** the `/rpc/ws` upgrade *and* the `/rpc/*` HTTP handler: a WebSocket upgrade is exempt from CORS preflight, and an HTTP RPC call is reachable from a cross-site `multipart/form-data` POST (a CORS-"simple" request that the oRPC codec deserializes straight into procedure input — the attacker can't read the response, but the mutation's side effect already happened). Gating only the socket leaves the HTTP front door open.

```ts
// WebSocket — call in your .on("upgrade") handler, before handleUpgrade:
gateWsOrigin(req, socket, { allowedOrigins, onReject? }): boolean
  // true  → rejected (socket destroyed); the caller returns WITHOUT upgrading
  // false → proceed.

// HTTP — call in your /rpc/* middleware, before RPCHandler.handle:
gateHttpRpcOrigin(req, { allowedOrigins, onReject? }): Response | undefined
  // Response (403) → rejected; the middleware returns it WITHOUT handling
  // undefined      → proceed.

// Both allow: no Origin (non-browser client), same host:port (Origin
// host:port === Host header), or an Origin in allowedOrigins.
isAllowedWsOrigin({ origin, host, allowedOrigins }): boolean  // the shared predicate
parseAllowedOrigins(raw): string[]  // comma-separated env value → trimmed list
```

```ts
// HTTP RPC mount
app.use("/rpc/*", async (c, next) => {
  const rejected = gateHttpRpcOrigin(c.req.raw, { allowedOrigins });
  if (rejected) return rejected; // CSWSH gate (HTTP arm)
  const { matched, response } = await rpcHandler.handle(c.req.raw, { prefix: "/rpc" });
  return matched ? response : next();
});

// WebSocket upgrade
server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/rpc/ws")) {
    if (gateWsOrigin(req, socket, { allowedOrigins })) return; // CSWSH gate (WS arm)
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else socket.destroy();
});
```

`allowedOrigins` is the consumer's deployment policy — `parseAllowedOrigins` of a `*_ALLOWED_ORIGINS` env var — the escape hatch for a reverse-proxy / `tailscale serve` front-end whose browser origin differs from the `Host` it forwards. Empty leaves only the same host:port rule. Both gates share the same value and the same `isAllowedWsOrigin` predicate.

### Projection (`@kolu/surface/project`)

Derive a surface B from a live client of surface A — a server that's a client (imports the server layer, so it's *not* on the browser-safe root). See [Projection](#projection-a-server-thats-a-client) above.

```ts
projectSurface(sourceSurface, { spec, deps }): {
  surface: Surface<B>;                  // B's contract + descriptors — the contract side
  implement: (aClient) => { router, ctx };  // wires B against a live A-client (feeds deps(aClient) to implementSurface)
}
  // deps: (aClient) => ImplementSurfaceDeps<B> — reach for the derive* helpers inside it

surfaceClientRef(sourceSurface, router): SurfaceClientOf<S>
  // an in-process, surface-typed client of a sibling surface from its served router
  // (a thin wrapper over directLink) — what B's handlers consume

deriveCell(upstream, map, initial): DerivedCellDeps<T> & { dispose }   // → cells.<key>
deriveStream(upstream, map): StreamHandlerDeps<I, T>                   // → streams.<key>
deriveEvent(upstream, map): EventHandlerDeps<I, T>                     // → events.<key>
// upstream is a client streaming call ((input, { signal }) => Promise<AsyncIterable<F>>);
// each helper threads B's abort into A's call and swallows the abort-time upstream rejection.
```

### Mirror (`@kolu/surface/mirror`)

The consume-side dual of `implementSurface` — drive a remote surface's primitives into local sinks. See [Mirror a remote surface into local sinks](#mirror-a-remote-surface-into-local-sinks-mirrorremotesurface) above. (Imports the server layer for its abort helpers, so it's *not* on the browser-safe root.)

```ts
mirrorRemoteSurface(sourceSurface, client, sink, { signal?, log? }): MirroredSurface<S>
  // walks sourceSurface.spec. Streaming primitives the sink opts into are subscribed via
  // `client` and pushed to the sink callback; EVERY procedure is returned as a forwarding
  // stub. `client` is any SurfaceClientOf<S> (read structurally).

// MirroredSurface<S> — the total dual of implementSurface's { router, ctx }:
//   procedures   ProcedureForwarders<S> — one stub per <ns>.<verb> (`{}` if none).
//                procedures.<ns>.<verb>(input, { signal? }?) → Promise<output>, forwarded
//                to the remote. Available synchronously; bound to `client`.
//   done         Promise<void> — settles when all subscriptions settle (link closed /
//                aborted). Rejects on a sink throw or a client/surface mismatch.

// SurfaceSink<S> — every STREAMING entry OPTIONAL (mirrored iff a sink is given);
// procedures are NOT in the sink (they're PULL, returned as stubs above):
//   cells:       { <k>: (value) => void }
//   collections: { <k>: { upsert: (key, value) => void; remove: (key) => void } }
//   streams:     { <k>: { input; onFrame: (frame) => void } }
//   events:      { <k>: { input; onFrame: (frame) => void } }
```

### Stdio transport (`@kolu/surface/links/stdio`, `@kolu/surface/loopback`, `@kolu/surface/peer-server`)

Same typed reactive surface, but over an arbitrary `Readable`/`Writable` pair instead of WebSocket. Headline path: a Node parent spawns an `ssh $host $agent --stdio` subprocess and talks to it as if it were local. Used by `packages/surface/example/remote-process-monitor/` to bridge a browser to a `/proc` reader running on another machine; the same shape is what Kolu R-2's `RemoteTerminalBackend` will use for remote terminals.

```ts
// Client (parent process)
stdioLink<C>({ read, write }): ContractRouterClient<C, ClientRetryPluginContext>
new StdioRPCLink<T>({ read, write, ...standardRPCLinkOptions })   // for custom client construction

// Server (agent process)
serveOverStdio({
  router,                          // see "Router wrapping" note below — must be `implement(contract).router({...fragment.router})`
  transport?: { read, write },     // defaults to process.stdin / process.stdout
  handlerOptions?,                 // forwarded to StandardRPCHandler
  onFirstRequest?: () => void,     // lifecycle hook — fires once after the first inbound frame decodes
}): Promise<ServeOverStdioEnd>     // resolves when the read stream ends — NEVER rejects:
                                   // { reason: "end" } on clean EOF, { reason: "error", error } on
                                   // an abrupt transport death (peer reset). Both are ordinary
                                   // peer-lifecycle events; a rejecting serve promise was an
                                   // unhandled-rejection crash footgun for multi-peer hosts.

// In-process loopback (tests / "local backend wrapped in remote client shape")
createLoopbackPair(): {
  client: { read: PassThrough; write: PassThrough };
  server: { read: PassThrough; write: PassThrough };
}
```

**Router wrapping (footgun).** `implementSurface` returns a router *fragment* shaped `{ surface: <namespaces> }`. Passing that fragment straight to `serveOverStdio` or `RPCHandler` produces a double prefix in the matcher tree (`/surface/surface/<key>`), so every client request 404s. Wrap once with `implement(surface.contract).router({...fragment.router})` (re-exported as `implement` from `@kolu/surface/peer-server`) before handing the router to the transport. Pinned by `implementSurface.test.ts`. **`implementSurfaces` returns the same `{ surface }` fragment** — wrap it with `implement(composeSurfaceContracts(entries)).router({...router})` (pinned by `implementSurfaces.test.ts`).

**Stdout is the protocol channel.** When `transport` is unset, `process.stdout` carries base64+newline-framed peer messages — a stray `console.log` or pino write to fd 1 corrupts the next frame and the parent peer dies with `SyntaxError: Unexpected token '«'`. `serveOverStdio` defensively redirects `console.log` to `process.stderr` for the default-transport case; consumers that use other loggers (pino, winston) must route them to fd 2 themselves. The `--broken-stdout-log` variant in the remote-process-monitor agent reproduces this failure mode for the regression test.

**Why base64+newline framing?** ssh stdin/stdout is a raw byte stream with no message boundaries. Base64 produces ASCII bytes that never contain `\n`, then we append a newline per frame — a line-buffered reader decodes back to the original `Uint8Array` the peer codec consumes. No length prefix, no out-of-band escape rules; the framing fits in 20 lines on each side.

`pollOnEvent` is the underlying snapshot+install+re-read helper, exposed for advanced cases. Most poll-shape streams should use the declarative `{ read, install, isEqual }` form on `implementSurface(...).streams.<key>` (above) — the framework synthesizes the `pollOnEvent` call.

### Unix-socket transport (`@kolu/surface/unix-socket`, `@kolu/surface/links/unix-socket`)

The local-IPC member of the link family: a daemon serves its router on a per-user unix socket; short-lived CLI clients dial it. Each accepted connection is pumped through `serveOverStdio` (a connected `net.Socket` is a Duplex, so it IS the `{ read, write }` pair) — same base64+newline framing as the subprocess/ssh path, only the stream pair differs. Kolu's `kaval-tui` ↔ kaval (or kolu-server's pty-host) is the headline consumer.

```ts
// Server (daemon process)
serveOverUnixSocket({
  socketPath,
  router,                          // same "Router wrapping" rule as serveOverStdio
  log?,                            // runtime events only (pino-compatible shape)
}): Promise<UnixSocketListener>    // NEVER rejects — { socketPath, outcome, close() }

// Client (CLI process)
unixSocketLink<C>({ socketPath }): Promise<{ client: ContractRouterClient<C, ClientRetryPluginContext>; dispose(): void }>

// The rendezvous path both processes compute independently
getRuntimeSocketPath({ app, file, override? }): string
  // override verbatim, else $XDG_RUNTIME_DIR/<app>/<file>, else /tmp/<app>-$UID/<file>
```

**Serving is additive by contract.** Every bind-time failure resolves to a no-op listener whose `outcome` says why — `dir-not-private`, `already-served`, `probe-failed`, `not-a-socket`, `bind-failed` — so a host whose socket is a convenience can never be crashed by it. The caller inspects `outcome` and logs app-flavored advice; the module owns only the transport verdicts. Stale-socket recovery is deliberately paranoid: a leftover inode is removed only when a `connect()` probe says nobody's listening **and** `lstat` confirms it's a socket — a probe error (EACCES) or a regular file at the path is refused, never unlinked.

**Why the rendezvous path avoids `os.tmpdir()`:** it honours `$TMPDIR`, which differs by launch context (on macOS a launchd-spawned daemon gets a private `/var/folders/.../T` while a `nix run` CLI gets `/tmp`), so the two processes would compute different paths and never meet. The fallback is a fixed `/tmp/<app>-$UID/` (the tmux convention), created `0700` and verified owner-only before serving.

### Solid client (`@kolu/surface/solid`)

```ts
surfaceClients(link, { <key>: Surface }): { <key>: SurfaceClient }
  // split one combined link into a per-key client bundle; each client is scoped to
  // its `{ surface: link.surface[key] }` slice, so its primitives resolve at surface.<key>.*

surfaceClient<S, Rpc>(surface, { websocket }): SurfaceClient<S, Rpc>
  // client.cells.<K>.use(policy)                  ← drops source/mutate
  // client.collections.<K>.use({ keys?, ... })    ← keys defaults to server stream
  // client.collections.<K>.{upsert, delete}       ← lifecycle-free mutations
  // client.streams.<K>.use(inputFn, opts?)
  // client.events.<K>.use(inputFn, handler, opts?)
  // client.rpc                                    ← typed oRPC client (pass Rpc generic for narrowing)

useCell(cell, { source, mutate?, authority?, applyPatch?, mergeIntoStore?, initial?, onError? })
useCollection(collection, { keys, valueSource, keyToInput?, onError? })
useStream(stream, inputFn, source, { onError? }?)
useEvent(event, inputFn, source, handler, { onError?, signal? }?): void

unenrolledStreamCall(procedure, input, { signal?, onRetry? }?): Promise<AsyncIterable<O>>
// `surfaceClient` builds the underlying RPC client internally; the
// constructor itself lives at `@kolu/surface/client` for non-Solid consumers.

createSubscription(source, options?): Subscription<T>           // leaf primitive
createReactiveSubscription(inputFn, factory, options?): Subscription<T>
```

`source` / `valueSource` accept typed oRPC procedure refs directly (e.g. `client.preferences.get`); the hook threads `STREAM_RETRY` retry context internally. The leaf primitives `createSubscription` / `createReactiveSubscription` are exposed for advanced consumers that need direct AsyncIterable→Accessor lifting outside the cell/collection/stream taxonomy.

## Comparison with Reflex-FRP

The framework's vocabulary takes inspiration from Haskell's [reflex-frp](https://github.com/reflex-frp/reflex), specifically `Reflex.Class.Behavior`, `Event`, `Dynamic`, and `Incremental`. The core mappings:

| Reflex | `@kolu/surface` | Notes |
|---|---|---|
| `Dynamic t a` (with no input) | `Cell<T>` | Same shape: a value over time. Cell's wire is `Incremental t (Replace a)` — every push is a full replacement. |
| `Dynamic t a` (parameterized by input) | `Stream<I,T>` | Reflex models input-dependent dynamics by composing — `Dynamic t I → Dynamic t a` via `joinDyn` / `bind`. We model it as a single primitive because the parameterization is a wire-protocol concern (subscribe with input I) rather than a composition concern. |
| `Incremental t (PatchMap K T)` | `Collection<K,T>` | Same shape: a map snapshot plus per-key add/remove/update patches. `mapArray`-driven per-key reactivity is the equivalent of Reflex's `selectIncremental`. |
| `Event t a` | `Event<I,T>` | Same shape: occurrences without a current value. We parameterize by input I (the subscriber declares interest in occurrences for some entity) where Reflex composes `Event t I → Event t a`. |
| `Behavior t a` | _(none)_ | Pull-only sample-on-demand is rare in our UI path. We use functions instead. |

### What we took

- **The vocabulary.** Naming `Cell` / `Collection` / `Stream` / `Event` borrows from Reflex's lattice: state with current value (Dynamic / Incremental) vs occurrence-without-value (Event). The `Stream` vs `Event` split in particular is the Reflex distinction between "the iterator yields a current snapshot on (re-)subscribe" and "the iterator yields occurrences with no snapshot obligation," translated into oRPC wire shape.
- **Snapshot+deltas as the wire equivalent of `Incremental`.** Reflex's `Incremental t p` is "a Dynamic with patches instead of full replacements." The framework's snapshot-then-deltas wire protocol is the same idea — a fresh snapshot replaces stale state on reconnect, deltas roll forward thereafter. Server-side helpers enforce the snapshot-first invariant in code.
- **`Stream<I,T>` as input-parameterized state.** Reflex consumers think of subscriptions as "a Dynamic that depends on a Dynamic input" (composed via `joinDyn`). `useStream(descriptor, () => input(), source)` is the same idea wired to a wire boundary: the input accessor changing tears down the old subscription and starts a fresh one.

### What we didn't take

- **`Behavior` (pull-only sampling).** Reflex's `Behavior t a` is a function `t -> a` you sample without subscribing. In a Solid client we have closures and `createMemo`; nothing the framework ships needs to model "value at time `t`" as a separate concept. Skipped.
- **`MonadQuery`'s `Group q` / `crop` / `SelectedCount` machinery.** Reflex's cross-network story (used in Obelisk / Focus) is: clients maintain a `Dynamic t Query` of their declarations of interest; the server aggregates clients' queries via a `Group q` instance, runs unified data-source subscriptions, and `crop`s results back per client. This pays off when the cost of "100 clients each watching the same key" is real. Kolu is single-client per session — refcounting, server-side dedup, and `crop` projections solve a problem we don't have. The cost (every value type implementing `Group` / `Commutative` / `Query` / `Monoid`-on-`QueryResult`) would be plumbing without payback. Skipped.
- **Reflex's monadic frame semantics.** Reflex orchestrates frame coherence (every Event firing in a frame is consistent with every Behavior sampled in the same frame). We rely on Solid's reactive scheduler for frame coherence on the client; the wire's snapshot-then-deltas invariant is what's load-bearing on the server. Not modelled.
- **`Dynamic`'s monadic API (`bind` / `joinDyn` / `holdDyn`).** Reflex composes `Dynamic`s into bigger `Dynamic`s monadically. We expose Solid's primitives (`createMemo`, `on`, `derive`) for that — the framework's job stops at the wire boundary.
- **One-primitive-fits-all (`Dynamic` over everything).** Reflex's `Dynamic` is general enough to encode singletons, keyed maps, parameterized views — all by varying the type parameter. We chose to keep four primitives because the type-level distinctions (`Stream` is read-only and never persisted; `Event` has no current value to render; `Cell.default` is one canonical seed shared across consumers) encode domain invariants the type system enforces. Collapsing to a single primitive would move those invariants from compile-time enforcement to runtime convention.

The principle: the framework adopts reflex-FRP's *vocabulary* and *snapshot+deltas-as-Incremental* framing. It doesn't adopt the cross-network query machinery, the pull-side `Behavior`, or the monadic Dynamic composition — those pay off in problems Kolu doesn't have, at a plumbing cost Kolu would have to carry.

## Design notes

- **Snapshot-then-deltas is load-bearing.** The streaming retry plugin re-invokes the source function on every reconnect. The first frame of every stream MUST be a fresh full snapshot, otherwise reconnects silently lose state. Every server-side helper enforces this in code.

- **The reconcile-or-assign branch is shared.** `createSubscription` and `createReactiveSubscription` use identical logic to write a new value into the local store: `reconcile` for objects/arrays (fine-grained reactivity), plain assignment for primitives. This used to be duplicated with a "keep in sync" comment between the two; now it lives in one place.

- **Local authority's "ignore subsequent echoes" is the subtle invariant.** A naive implementation reconciles every server push into the local store. The bug surfaces only when an unrelated event piggybacks on the same channel: an activity-feed tick, say, would stomp a just-made preferences write whose RPC hadn't round-tripped yet. `useCell` with `authority: "local"` reconciles only on the first yield and then ignores the subscription thereafter — the local store is authoritative.

- **`patch` is a cross-runtime contract.** When a cell's spec declares `patch: (current, p) => ...`, that exact function is invoked on **both** sides — the server's `cellHandlers.patch` verb runs it to merge incoming patches before persist+publish, and `surfaceClient` defaults the client's `useCell` `applyPatch` to it for `authority: "local"` cells (`packages/surface/src/solid/surfaceClient.ts:189-200`). The function is shared only because `common/surface.ts` is compiled into both packages — there is no runtime sync. _If server and client are deployed at different versions and `patch` changed between them, server applies new merge logic while the client applies old (or vice versa) and the views drift silently with no error._ Treat any change to `patch` as a wire-format change: server and client must redeploy together. The same applies to schemas referenced from the spec; treat the whole spec as a versioned contract.

- **No second consumer pressure.** This package was extracted to decomplect Kolu's client and server source trees, not to be reused. The boundary is shaped by Kolu's actual ragged edges (terminal.attach's subscribe-before-yield, gitStatus's poll-on-event) rather than speculative ones; no contract auto-derivation, no pluggable backends beyond what Kolu actually has.

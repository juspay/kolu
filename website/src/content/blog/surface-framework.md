---
title: "Announcing @kolu/surface: typed reactive state for SolidJS + oRPC"
description: "I'd written the same dozen lines of subscribe-reconcile-retry code so many times I stopped seeing them. @kolu/surface is what happened when I finally asked what I'd extract before accepting one more copy."
pubDate: 2026-05-04
author: "Sridhar Ratnakumar"
---

For a few weeks I kept writing the same code. Not similar code. The same code. On the client: subscribe to a streaming RPC, lift the stream of values into something [Solid](https://www.solidjs.com/) can react to, fold each new value into a local store, and send the errors to a toast. On the server, the mirror image — yield the current value, then sit in a `for await` loop yielding the changes, and somewhere else, on every mutation, remember to publish the change so that loop has something to yield. I wrote it for the terminal list. Then for preferences. Then for git status. By the fifth time I could type it without thinking, **which is exactly the problem.**

Because here's the thing I was slow to see: none of it was about [Kolu](https://kolu.dev). The schema changed each time. The name of the procedure changed. The pair of channel and payload type changed. And that was all that changed. The order of the frames — full snapshot first, then deltas — was always the same. The retry behavior was the same. The publish-then-subscribe symmetry was the same. The little branch in the store write, reconcile if it's an object and assign if it's a scalar, was the same. I was hand-copying the wiring of a house and changing nothing but which appliance I plugged in.

## Electricity

Juval Löwy has a good way of putting this. In [_Righting Software_](https://www.amazon.com/Righting-Software-Method-Engineering-Architecture/dp/0136524036) he says infrastructure should be like the [electricity](https://www.informit.com/articles/article.aspx?p=2995357&seqNum=2) in a building. You don't run a new wire every time you buy a toaster. The wiring is in the walls, you plug into a socket, and the toaster is the part you swap. His name for the discipline of sorting the wiring from the toaster is _volatility-based decomposition_, which is a mouthful, but the idea under it is plain. Find the parts that don't vary and bury them in the wall. My subscribe-reconcile-retry dance was wiring. I'd been stapling it to the outside of every wall in the house.

There's a test I've started using for whether something should be pulled out. Not "is this snippet clean?" That question has a bottomless number of yeses. The better question is: what would I be willing to extract as a utility before I'd accept one more per-call-site fix? When I asked it here the answer was everything. All of it. And when the answer is all of it, you're not looking at a snippet that needs tidying. You're looking at a snippet at the wrong _altitude_. **The framework is just the same code, moved up to where it stops repeating.**

## Five shapes

So I pulled it out into a package, [`@kolu/surface`](https://github.com/juspay/kolu/tree/master/packages/surface), and the question became how many kinds of thing it had to know about. The answer turned out to be five, and the five are worth naming, because each one bites you at runtime if you pretend it's one of the others.

A `Cell` is a single current value. What's the theme right now? One of them, you can read it, you can set it. A `Collection` is the same idea but keyed: what's the current value for each id? Many of them, you set any one by key. A `Stream` is read-only and derived from something the server doesn't own — git, the filesystem, the network. What's the live output for this input? You can read it. You can't set it. An `Event` has no current value at all. Has the thing happened yet? You don't render it; you handle it when it fires. And a `Procedure` is the boring one: run a side-effect on the server, get an answer back. A plain RPC, living in the same namespace as the rest.

You might reasonably ask why these aren't one primitive with some flags. I tried that first. It collapses badly. The distinction that finally convinced me is the one between a Cell and a Stream, and it's older than this framework — it comes from [reflex-frp](https://github.com/reflex-frp/reflex), where the shapes are called `Dynamic` and `Incremental` and `Event`. A Cell is an identity over time: the same logical thing, whose value evolves, like your preferences. You can set it because you own it. A Stream isn't a thing at all; it's a function being re-run. The list of files that changed in your repo isn't a value Kolu owns — git owns it, and Kolu is watching. You can't `set` that without quietly becoming the cache, and the moment you're the cache you've signed up to be wrong. So a Stream is read-only, and the type system won't let you forget. Each of the five carries an invariant like that. Collapse them and you move the invariant from something the compiler checks to something you have to remember. **And you will not remember.**

Anything that fits none of the five stays raw [oRPC](https://orpc.dev/). There's a one-line escape hatch, `streamCall(client.X.Y, input, opts)`, that threads the same retry context the rest of the framework uses, so dropping to the metal doesn't cost you the plumbing you actually wanted. A bidirectional binary stream isn't a Cell. Don't make it one.

## One spec, three places

The whole thing is declared once and read from three places. You write a spec — the cells, collections, streams, events, and procedures, each with its [Zod](https://zod.dev/) schema. From that one spec the framework derives the typed contract, the server router, and the client hooks. There's no parallel list to keep in sync, which matters, because the parallel list is the thing that always drifts.

Here's the spec for a little notes app:

```ts
import { defineSurface } from "@kolu/surface/define";
import { z } from "zod";

const NoteIdSchema = z.string();
const NoteSchema = z.object({
  id: NoteIdSchema,
  title: z.string(),
  body: z.string(),
  updatedAt: z.number(),
});
const EditorPrefsSchema = z.object({
  fontSize: z.number().int().min(10).max(32),
  theme: z.enum(["light", "dark"]),
});

export const surface = defineSurface({
  cells: {
    prefs: {
      schema: EditorPrefsSchema,
      default: { fontSize: 16, theme: "light" },
      patchSchema: EditorPrefsSchema.partial(),
      patch: (current, p) => ({ ...current, ...p }),
    },
  },
  collections: {
    notes: { keySchema: NoteIdSchema, schema: NoteSchema },
  },
  streams: {
    search: {
      inputSchema: z.object({ query: z.string() }),
      outputSchema: z.object({ matches: z.array(NoteIdSchema) }),
    },
  },
  events: {
    autosave: {
      inputSchema: NoteIdSchema,
      outputSchema: z.object({ noteId: NoteIdSchema, savedAt: z.number() }),
    },
  },
  procedures: {
    notes: {
      // Imperative escape hatch — id minted server-side, so it doesn't
      // fit the collection's `upsert`-with-key shape.
      create: { input: z.object({ title: z.string() }), output: NoteSchema },
    },
  },
});
```

There's no second copy of the types. `surface.contract` is a real oRPC router built from the spec at compile time, and a mapped helper lifts the runtime types straight out, so on both sides you reach into `SF["cells"]["prefs"]["Value"]` instead of maintaining your own `z.infer` aliases. The spec is the only source of truth for the schemas, the defaults, and the types. **One place.**

The server side fills the spec in — how to read all the notes, how to upsert one, how to watch for changes:

```ts
import {
  confStore,
  implementSurface,
  publisherChannel,
} from "@kolu/surface/server";
import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import { surface } from "common/surface";

const publisher = new MemoryPublisher();

export const { router, ctx } = implementSurface(surface, {
  channel: <T>(name: string) => publisherChannel<T>(publisher, name),

  cells: {
    prefs: { store: confStore(conf, "prefs") },
  },
  collections: {
    notes: {
      readAll: () => allNotes(),
      upsert: (id, note) => upsertNote(id, note),
      remove: removeNote,
    },
  },
  streams: {
    // Poll-on-event shape: the framework synthesizes the snapshot +
    // install + re-read + isEqual loop internally.
    search: {
      read: async ({ query }) => ({ matches: searchNotes(query) }),
      install: (_input, cb) => onNotesChange(cb),
      isEqual: (a, b) => a.matches.join(",") === b.matches.join(","),
    },
  },
  events: {
    autosave: {
      // Single-yield-then-close: forward a per-input channel.
      source: (id, signal, { bus }) => bus.subscribe(signal),
    },
  },
  procedures: {
    notes: {
      create: async ({ input, ctx }) => {
        const note = { id: newId(), title: input.title, body: "", updatedAt: Date.now() };
        ctx.collections.notes.upsert(note.id, note);
        return note;
      },
    },
  },
});
```

`implementSurface` hands back `{ router, ctx }`. The `ctx` is the part your domain code writes through — `ctx.cells.prefs.set(next)`, `ctx.collections.notes.upsert(id, value)`. Every mutation goes through one apply-then-publish chain. There's no second path: no place where someone sets the store but forgets to publish, or publishes a value that never made it into the store. That second path was the source of half my reconnect bugs. **Now it doesn't exist.**

Streams come in two shapes and the framework absorbs both. Most of the time you're watching something you don't own — a file, a git ref — and all you get is a "something changed" nudge with no payload. For that you hand over three functions: how to read the current value, how to install a listener, and how to tell whether two values are equal. The framework does the rest, snapshot then deltas, suppressing the no-op changes, re-reading on reconnect. When that shape doesn't fit, you give it a raw `source` that yields, and it gets out of your way.

On the client, each primitive is pre-bound to its wire identity, so the call site never mentions it:

```ts
import { surfaceClient } from "@kolu/surface/solid";
import type { ContractRouterClient } from "@orpc/contract";
import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import { surface } from "common/surface";

const ws = new PartySocket(`wss://${host}/rpc/ws`);

export const app = surfaceClient<
  typeof surface.spec,
  ContractRouterClient<typeof surface.contract, ClientRetryPluginContext>
>(surface, { websocket: ws });

// In components — bound `.use()` hooks drop source/mutate/keyToInput
// from the per-call args; the surface supplies them.
const prefs = app.cells.prefs.use({
  authority: "local",
  initial: DEFAULT_PREFS,
});
const notes = app.collections.notes.use();
//   notes.keys()         — Accessor<NoteId[]>, defaults to the server's keys stream
//   notes.byKey(id)?.()  — Subscription<Note> per key
//   notes.upsert(k, v)   — bound mutation (also at app.collections.notes.upsert)
const search = app.streams.search.use(
  () => ({ query: query() }),
  { onError: (err) => toast.error(`Search failed: ${err.message}`) },
);
app.events.autosave.use(
  selectedId,
  (payload) => flashSavedToast(payload),
  { onError: (err) => console.error(err) },
);

// Imperative procedures go through `app.rpc` under the `surface.*` namespace:
const note = await app.rpc.surface.notes.create({ title: "Untitled" });
```

The bound `.use()` is the part I'm happiest with. Instead of passing a procedure reference at every call site, the client has already wired each primitive to its oRPC entry, dropped the identity arguments, and threaded the retry context inside. The hooks own the snapshot-and-deltas reconcile, the per-key reactive lifecycle, the optimistic local merge for the cells you mark `authority: "local"`, and the resubscribe-on-reconnect cleanup. You ask for `app.cells.prefs.use(...)` and you get a value that's still correct after a dropped connection, without your having typed the word "reconnect."

## What it's worth

Two ways to take the measure of a framework, both more honest than a feature list: count what it removed, and admit what it won't do.

### What it deleted

The easiest way to say what the framework does is to count what it removed. About 800 lines of plumbing across the client and server. But the number that tells the story better is the set of things that now appear zero times in Kolu's code. Zero hand-written `yield current; for await (…) yield ev` loops in the router. Zero `publishSystem("X:changed", value)` calls — every publish goes through a typed channel whose name is derived from the key, so nobody writes the string `"X:changed"` and nobody typos it. Zero hand-threaded retry contexts in client code. Zero `pollOnEvent` wrappers. Zero `AbortController` plumbing in the providers.

And the number I care about most: **adding a new cell to Kolu now touches two files.** The descriptor in one, the wiring in the other. The client gets it for free.

In Kolu itself there are four cells — user preferences, the live terminal list, an activity feed of recent repos and agents, and the session snapshot that drives restore. One collection, for the per-terminal metadata each tile reads off its own key. Four streams behind the code view: the changed-file list, the diff for the selected file, the full repo tree, and the contents of one file. One event, for a terminal exiting, which fires the exit toast and the auto-switch. Everything that doesn't fit a shape stays imperative — terminal create, kill, resize, the git worktree mutations, the bidirectional binary attach stream — and lives in a hand-written router right next to the generated one. The two compose with a single spread:

```ts
export const contract = oc.router({
  ...surface.contract,
  terminal: rawTerminalContract,  // hand-written for terminal.attach + friends
});
```

### What it won't do

Now the part where I tell you what it can't do, which is usually more honest than the feature list. Kolu has one client per session, and the framework is built for exactly that. It doesn't carry the machinery you'd need for a hundred clients watching the same key — no refcounting, no query-cropping, none of the cross-network sharing that reflex-frp grows for that case. That machinery is real and it's good, and Kolu doesn't have the problem it solves, so paying for it would be plumbing with no payback. It also doesn't try to compose primitives into bigger primitives. Solid already has `createMemo` and `on` for that, and the framework's job ends at the wire. I kept wanting to make it cleverer and kept stopping, because every time I looked, **the clever version was solving a problem I didn't have.**

There's a runnable example in the repo — a tiny in-memory notes app, about 500 lines, with all five primitives visible in a single `App.tsx`. `just surface-example` starts it. I built the example before I built any of the framework, and I keep one rule: a change has to land in the example before it touches Kolu. The example is 500 lines and Kolu is a hundred files, and you can see an API mistake in the first long before you'd find it in the second.

## Subtraction

**The work from here is subtraction, not addition.** That sounds like a pose, so here's what's already gone. A consumer escape hatch called `mergeIntoStore`, deleted once the schema shape made it unnecessary. A per-stream `pollOnEvent` wrapper, folded into the three-function declaration. A `consumeChannel` helper, folded into the channel itself. Each one was a thing the framework was half-doing, and the fix in every case was to do it the rest of the way and delete the seam. There's a list of more: some type-oracle helpers that exist only to be `ReturnType`'d and might collapse; a generic parameter that's uglier than it should be because the type checker runs out of patience expanding two big types in one pass; a few schema field names I'd pick differently now and can still change cheaply, because there's exactly one consumer — and the day there are two, the names are frozen.

It's internal-only, by the way. `@kolu/surface` ships inside Kolu, not as its own package, and the API is still moving. Don't reach for it from outside yet.

Five shapes, then. Cell, Collection, Stream, Event, Procedure. One spec, derived three ways, snapshot-and-deltas on the wire, and a domain layer that no longer knows the name of a single channel. The job was never to grow a library. It was to get the wiring back into the walls — and then to keep finding the wires I'd left stapled to the outside.

[`@kolu/surface` source](https://github.com/juspay/kolu/tree/master/packages/surface) · [the runnable example](https://github.com/juspay/kolu/tree/master/packages/surface/example) · [Kolu's surface declaration](https://github.com/juspay/kolu/blob/master/packages/common/src/surface.ts)

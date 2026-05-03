---
title: "Electricity from a diff: extracting Kolu's cells"
description: "A Lowy-style 'electricity' extraction in five turns. The reviewers didn't see the framework; one /talk turn turned three Solid primitives into a four-primitive end-to-end framework."
pubDate: 2026-05-01
author: "Sridhar Ratnakumar"
---

<!--
DEBUG (for future AI sessions iterating on this post — REMOVE before publishing):

The full transcript of the session that produced this post is at:
  /home/srid/.claude/projects/-home-srid-code-kolu--worktrees-older-branch/9ddf81dd-1b86-41bf-a3eb-ca043885aad6.jsonl

When updating this draft, grep that JSONL for verbatim user messages,
agent decisions, and reviewer findings rather than relying on the
post's prose. Cross-reference against the PR (#805) commit history for
the structural beats. Both are authoritative; this draft is a
narrative summary on top of them.

Strip this block (and the closing comment) before publishing.
-->

_Running notes from the session that produced [@kolu/surface](https://github.com/juspay/kolu/tree/master/packages/surface). Not a finish line — a snapshot mid-process. I'll keep updating as the framework evolves._

In [_Righting Software_](https://www.amazon.com/Righting-Software-Method-Engineering-Architecture/dp/0136524036), Juval Löwy argues that infrastructure should feel like the **electricity** in a building: invisible, ubiquitous, plugged into via simple sockets. Domain code is the appliance you swap. The wiring stays put. **Volatility decomposition** is the discipline of deciding which is which.

This post is a session log. Across five conversational turns, a handful of `createSubscription` calls in Kolu's client + a parallel set of hand-rolled `yield X; for await ev of subscribeSystem_(...) yield ev` loops in Kolu's server became `@kolu/surface` — a four-primitive end-to-end framework that owns the entire snapshot+deltas wire protocol on both sides. Domain modules in Kolu shrank by ~190 lines net and stopped knowing about retry contexts, publisher channels, or oRPC plumbing.

A few things surprised me about how it went. **The reviewers didn't see the framework.** I had to ask for it. Then once I had asked, the model designed three primitives — but missed two important shapes that I had to pull out one turn at a time. By the end of the session there were four primitives plus a runnable example, and a clearer sense of where the [hickey](https://github.com/srid/agency/blob/master/skills/hickey/SKILL.md) and [lowy](https://github.com/srid/agency/blob/master/skills/lowy/SKILL.md) reviewer agents are doing their best work — and where they're blind.

## Turn 1: the reviewers don't see it

Kolu had `createSubscription` (an AsyncIterable→Solid `Accessor` lift) and `createReactiveSubscription` (input-parameterized variant) wired into ~12 client call sites. On the server, every "yield current state, then yield deltas" stream handler in `router.ts` was hand-rolled. The pattern was obvious enough that I'd been writing the same shape for months. The accidental discovery was that this whole pattern is **electricity** — universal infrastructure, parametric on the schema and procedure name. There was no Kolu-specific decision in any of it.

I'd been running [hickey](https://github.com/srid/agency/blob/master/skills/hickey/SKILL.md) and [lowy](https://github.com/srid/agency/blob/master/skills/lowy/SKILL.md) on every PR for months. Neither had said "extract this pattern into a framework." They reviewed the diff in front of them. They found local issues — a complecting here, a volatility-axis-misalignment there. **Neither lens, as currently tuned, looks at the negative space — the *absence* of an abstraction that should exist.**

That's a real gap. Hickey's lens catches concepts that are conflated. Lowy's lens catches volatility axes that are mis-encapsulated. Neither asks the meta-question: _is this whole class of code something that shouldn't be here at all_? The pattern across 12 call sites is, by design, _not yet_ a complecting (each call site is locally clean) and not yet a volatility miss (each call site's volatility is correctly local). It's a missing seam. Reviewers tuned for spatial defects + temporal defects don't see seam-shaped negative space.

So I asked. `/talk` mode, pasting in a `createSubscription` call: _"This whole 'infrastructure' is NOT DEPENDENT on Kolu, but is complect'ed right now in client/server kolu code."_ Then: _"Stop thinking in terms of 'helpers' and start being creative about inventing 'framework'."_

That second sentence was load-bearing. Without it the model tried to refactor in place — extract a helper, deduplicate a shared function. Once "framework" was on the table, the design space opened.

## Turn 2: three primitives, hand-spec'd

Across a few back-and-forths in `/talk`, three primitives fell out:

| Primitive | The question it answers | Cardinality |
|-----------|-------------------------|-------------|
| `Cell<T>` | "What's the current X?" | One singleton |
| `Collection<K,T>` | "What's the current X for each key K?" | Many, keyed |
| `Stream<I,T>` | "What's the live output for input I?" | One per input combo |

The cuts came out of a specific question I asked: _"In table form, explain why we need them, and what they are used for in kolu."_ That table format is doing more work than it looks. It forced the model to commit to **what a primitive is for** in one phrase per row, and the asymmetries between rows became immediately visible. `Cell` answers "the current," `Stream` answers "the live output for input I"; one lives over time, the other is a function being re-evaluated. That structural difference would dictate API shape later.

I drove the conversation through the table for a while — _"shouldn't `createReactiveSubscription` fit into this?"_ pinned which of Kolu's 12 call sites belonged to which primitive — and then `/do`'d the design with `--review` so the architect could pause, ask clarifying questions via `AskUserTool`, and confirm the cut before any code was written.

Three rounds of [hickey + lowy](https://kolu.dev/blog/hickey-lowy/) ran across that PR. **Eleven findings landed as separate commits** — extract a reconcile helper, document `mergeIntoStore` invariants, document intended authority on cell descriptors, fix `useCellLocal.value()` hiding the seeded store, collapse `createSubscription` duplication, switch `listSub` to `Accessor<TerminalInfo[]>`, restore comments dropped during migration, pin `publisherChannel`'s microtask-delay invariant to its e2e regression, move `applyPreferencesPatch` next to `preferencesCell`, consolidate `activityFeed` into one Conf key. Each commit is one reviewer finding. The PR's commit history reads as a sequence of structural refinements, not a grab-bag squash.

This is where the reviewers shine: once there's a concrete diff in front of them, they bite. The catch on `useCellLocal.value()` (`/code-police`'s fact-check pass) was particularly load-bearing — the bug let the seeded store be visible-then-hidden as soon as the first server yield arrived, which would have been a real flicker in production. Three reviewers running, three different lenses, and the bug got caught the first time.

## Turn 3: the leak the reviewers DID catch — once asked

After the first PR landed CI-green, I noticed `streaming.md` rule §1 still in the codebase: _"Every async-iterator RPC the client consumes goes through `packages/client/src/rpc/rpc.ts`'s `stream` object, not `client.*` directly."_ A cultural rule whose existence is an admission that the framework is missing a piece. The `stream` namespace was a hand-maintained 11-entry table mapping every streaming RPC to its `STREAM_RETRY` context-threading wrapper.

`/talk` again: _"stream (rpc.ts) is still leaking outside of of packages/cell. Same on server side."_ The same pattern as turn 1: I had to point at the negative space.

This time though, once pointed at, the reviewers earned their keep. The talk-mode design pass (which auto-runs hickey + lowy on the proposal) immediately surfaced two findings I'd missed:

- **Hickey F4 (the sharpest):** the proposed `terminalChannels` registry on the server only covered the **read** side. Write-side `publishForTerminal(...)` calls would still be scattered. The fix had to be symmetric — each entry a `Channel<T>` owning both publish and subscribe.

- **Lowy F7:** before deleting `subscribeForTerminal_`, the callback-form wrapper used by 5 providers had to be audited. The deletion would have stranded those.

Both bites changed the design before any code was written. That's the talk-mode hickey/lowy at its best: a concrete sketch, two lenses on it, the proposal revised in light of what landed. The post-implement review on the actual diff caught a few more — `Cell.name` doc was misleading (it doesn't actually serve as the channel name; channel names are passed explicitly), `createCellsClient` returned `{client}` for no reason (YAGNI wrapper), `consumeChannel` helper extracted from the 5 inlined try/catch blocks.

By the end of this turn the framework owned the entire wire protocol end-to-end. Kolu's `client/` and `server/` lost ~190 lines of generic transport plumbing.

## Turn 4: reflex says you missed one

This is the turn that changed how I think about the framework.

I asked the model to research [reflex-frp](https://github.com/reflex-frp/reflex) — the Haskell FRP library — and explain how its types map to what we'd built. The map came back almost too cleanly:

| Reflex | `@kolu/surface` |
|---|---|
| `Dynamic t a` (no input) | `Cell<T>` |
| `Dynamic t a` (per-input) | `Stream<I,T>` |
| `Incremental t (PatchMap K T)` | `Collection<K,T>` |
| `Event t a` | _(missing)_ |

Reflex's `Event t a` is "a stream of occurrences with no current value" — point-in-time fires, handler-based, no snapshot on (re-)subscribe. Kolu had exactly this shape — `terminal.onExit` — sitting outside the framework as raw oRPC, consumed via a manually-threaded `streamCall(client.terminal.onExit, ...)`. The category-shaped hole was visible the moment the comparison was framed.

I asked for simplifications: could three primitives collapse to two? Could Cell be a Stream with `I = void`? Could Collection be a `Stream<void, Map<K,V>>`? Sketched it. Ran hickey + lowy. **Both reviewers killed the collapse**, and both for the same structural reason:

> The three primitives aren't split along the wire protocol — they're split along type-level enforcement of domain invariants. Streams are never mutable (compile error if you try). Cells have a canonical `default: T` shared across consumers (compile error if two callsites disagree). Collections have per-key reactive lifecycle via `mapArray` (structurally guaranteed, not convention). Collapsing trades type-level enforcement for runtime convention.

I'd been thinking the primitives were a vocabulary choice. The reviewers showed me they were **encoding domain invariants the type system enforces**. That's a Lowy point dressed as a Hickey point, or vice versa. Either way — landed.

What survived was just the additive finding: **add `Event<I,T>` as a fourth primitive.** Both reviewers explicitly endorsed it. Reconnect semantics differ (Streams idempotent re-subscribe with snapshot; Events don't redeliver missed occurrences) — they're not the same shape with different cardinalities.

The implementation hit one nasty bug. `eventHandlers`'s natural shape — `for await (const v of source) yield v` — silently drops the value for single-yield-then-return sources. oRPC's wire delivers an "iterator complete" frame the moment the wrapper's `for await` loops back to read source's `next()`, and that frame races the yielded value's delivery on the consumer side. The consumer's first iteration sees `done: true`, the value is dropped, and the kill.feature regression fires. Fix: forward `deps.source` directly as the handler iterator instead of wrapping. The framework's `eventHandlers` body is now one expression. Pinned in a doc-comment with a citation to the e2e scenario.

## Turn 5: a runnable example, mostly for me

The framework had a thorough README with a side-by-side "How Kolu uses this" inventory, plus a `## Comparison with Reflex-FRP` section laying out what we took (vocabulary, snapshot+deltas-as-Incremental, Stream input-parameterization) and what we didn't (`Behavior`, `MonadQuery`'s `Group`/`crop`/`SelectedCount` cross-network machinery, monadic Dynamic composition, one-primitive-fits-all). Kolu is single-client per session — Reflex's plumbing for `100 clients × shared subscriptions` doesn't pay back its weight at this scale.

The actual reason I asked for the example wasn't reader-facing. **It was so I'd have a smaller surface to review against when iterating on the framework itself.** Kolu has 12 stream consumers across canvas chrome, terminal lifecycle, agent providers, code-tab views, session restore. When I want to ask _"would `useCell` feel right with the mutation arg restructured this way?"_, scrolling through Kolu to see the answer is exhausting — a hundred-file diff per design tweak. A 500-LOC example with one of each primitive is a tractable substrate. The framework's API decisions are visible end-to-end without the domain noise.

The candidate was a notes app:

- `prefsCell` — editor preferences (font size, theme). `authority: "local"` instant-UI mutation, `applyPatch` for partial updates.
- `notesCollection` — notes keyed by id. Sidebar list with per-key reactive lifecycle.
- `searchStream` — full-text search parameterized by query string. `pollOnEvent`-driven re-derivation when notes change.
- `autosaveEvent` — "Saved" flash beside the active note title. Handler-based, no current value.

It came together in ~500 LOC across server + client + common, single-file `App.tsx` so every hook is visible end-to-end. Hono + WebSocket + Vite + Tailwind v4. Self-contained, no Kolu-internal imports — that property matters: when the example imports something from Kolu, the example becomes Kolu, and the substrate is no longer smaller. The discipline is "if a future framework change ripples into this example, the change has to land on this example *first* before I touch Kolu."

## Turn 6: the example, used as designed — and what it found

The example existed to be a smaller substrate for iterating on the framework. It started doing that almost immediately.

**First thing the example revealed: the contract was hand-written twice.** `defineCell` / `defineCollection` etc. produced descriptors. But the oRPC contract router still had to be hand-listed entry-by-entry — schemas duplicated between `cells.ts` and `contract.ts`, with no compile-time link. So I asked: _"Cell and Stream can be merged into a Dynamic, no?"_ — and once that was off the table (reviewers killed the collapse, type-level invariants again), the real question surfaced: _why am I still hand-typing?_

Pushed for an actual framework instead of helpers:

- `defineSurface({ cells, collections, streams, events, procedures })` — one declaration, one file.
- `surface.contract` — derived from the spec, no parallel literal.
- `implementSurface(surface, deps)` — server-side wiring, replaces the `t.X.<verb>.handler(...)` plumbing.
- `surfaceClient(surface, transport)` — bound `.use()` hooks that drop `source` / `mutate` from per-call args.

Built the framework, migrated the example, ran reviewers on the design.

**Reviewer pushback that landed mid-iteration:** the matrix was originally going to wrap each entry in its own top-level namespace (`preferences.*`, `terminalList.*`, …). Hickey + I together arrived at: wrap the whole thing under one `surface.*` key. That makes composition with hand-listed raw oRPC trivial — `oc.router({ ...surface.contract, terminal: rawTerminalRouter })` — and namespace collisions disappear by construction.

**Pushed back on every override field.** The first cut had `channelName` / `storeKey` / `channelNames` / `verbs` / `namespace` per-entry escape hatches, in case Kolu's existing wire shape didn't match the framework's defaults. Two arguments killed those:

- _"I don't care for backwards compatibility in general."_ The framework owns one client; wire renames are free.
- _"The whole point of improving cells is to avoid hand-typing."_ Every override is a place where domain code tells the framework what the framework should already know.

Drops: every channel-name override, every verb-name override. `confStore` keys preserved by **picking surface keys that match existing on-disk slots** (`activityFeed` matches `confStore("activityFeed")` already), no migration ladder needed. The framework derives every channel name strictly from the surface key.

### The duality that survived a refactor and got caught anyway

After Kolu was on `defineSurface` end-to-end with all 10 typed primitives, I noticed `packages/server/src/cells.ts` still existed: a parallel registry of `publisherChannel`s and `confStore`s, used by domain modules to publish *directly* without going through the surface. `activity.ts`'s `trackRecentRepo` was still doing `store.set("activityFeed", …) + cellBus.activityFeed.publish(getActivityFeed())` — a re-implementation of the framework's `applyAndPublish` chain, hand-rolled.

`/talk`: _"Identify all this kind of smell where kolu has BACKDOORS without going through our new library."_

Lowy's review nailed it in one sentence:

> The framework already builds the helpers we need. `cellsCtx[key].set` already does `store.set + bus.publish + onMutate` atomically — for procedure handlers. The gap is that `implementSurface` doesn't return it as a public value alongside the router.

So the fix wasn't a new abstraction. It was **stop hiding what was already there.** Three changes:

- `implementSurface` returns `{ router, ctx }`. ctx covers cells (`get`/`set`/`patch`), collections (`upsert`/`remove`/`readAll`/`readOne`), and events (`publish(input, payload)` to a framework-derived per-input channel).
- Domain modules import `surfaceCtx` and use it directly. `activity.ts:88, 107` becomes one line. `session.ts:24-25` becomes one line.
- `packages/server/src/cells.ts` deletes. `terminalChannels.metadata` and `terminalChannels.exit` delete from `publisher.ts` (framework-owned now). The only channels left in `publisher.ts` are genuinely-internal ones (`data`, `cwd`, `git`, `title`, `commandRun`).

The bonus Lowy named: `onMutate` in `CellHandlerDeps` was **dead code** for any cell whose mutations originated in domain modules — the bypass skipped the framework's hooks. With ctx, every mutation flows through the same chain.

**Net for Kolu:** zero string-typed channel names in any domain module. Rename a surface key and every wire / disk / publish path follows in lockstep. There's exactly one path from "mutate this cell" to "client sees update," and it's named.

## Polish passes: rename, prune, and a feature that didn't ship

After the framework was end-to-end functional, the next several
sessions were polish — names, abstractions, and one feature I built
then deleted.

**The naming consolidation.** With the framework named `@kolu/surface`
(originally `@kolu/cells`, before the realization that Cell is one of
five primitives), every layer needed re-walking. `expose:` →
`verbs:` (every comment already called them verbs). Collection's wire
verb `update` → `upsert` (deps already used `upsert`; one less name
per concept). `ChannelBus<T>` → `Channel<T>` — the suffix was
disambiguator weight that the rest of the codebase no longer needed.
`createCellsClient` retired from the public re-export path; consumers
reach the typed RPC client via `surfaceClient(...).rpc`. None of these
were big diffs; collectively they collapsed the API surface noticeably.
The lesson here is just: **rename early or rename never.** Each Schema
suffix that survived through the first pass (`CellSpec.schema`,
`CollectionSpec.keySchema`) is still leftover in the codebase as I
write this; the cost of fixing them is now proportional to
"every consumer in Kolu." Names get expensive fast.

**The bound collection API: default keys, lifecycle-free mutations.**
The example was reaching for `app.rpc.surface.notes.keys` to wire up
the keys stream that the bound `.use()` should have managed itself —
five layers of `createRoot` + `createSubscription` + `streamCall` +
the procedure ref + a default-empty memo, just to derive a value the
framework already had. The fix: `keys` becomes optional on the bound
`.use()`, defaulting to a framework-managed subscription on
`surface.<key>.keys`. Same for mutations: `notes.upsert` /
`notes.delete` now live both on the `.use()` result (ergonomic
in-component closures) and at the top-level `BoundCollection`
(lifecycle-free call sites). The example's app code dropped 8 lines
of plumbing; the consumer never reaches across the bound layer for
ordinary verbs anymore.

**The package barrel that wasn't.** `packages/common/src/index.ts`
had grown to 460 lines mixing surface schemas, raw-oRPC procedure
schemas, integration re-exports, UI enums, and HTML helpers — six
unrelated jobs. The dismantle: surface-bound schemas + types moved to
`common/surface.ts` (now the single source of truth via
`SurfaceTypes`); raw-oRPC procedure schemas moved alongside the
contract literal in `common/contract.ts`; UI enums folded in next to
their consumer. The barrel deleted entirely. **A code-police rule
landed alongside it:** modules whose entire body is `export … from
"another-package"` shouldn't exist — consumers go to the source.
`integrations.ts` and `pr.ts` were exactly that anti-pattern; both
deleted. The rule is now in `.agency/code-police.md`.

**The feature I built, then didn't ship.** I'd noticed the example's
search stream was ~35 lines of `pollOnEvent` plumbing. Designed a
"derived stream" primitive — `streams.search.compute({ query, notes
}) => …` with `from: { notes: surface.descriptors.collections.notes
}` declaring the dep graph. Built the whole thing: `DescriptorRef`
type, `runComputedStream` reactive runtime, discriminated
`StreamImplDeps`, unit tests, README "Future directions" section.
Workspace typecheck clean.

Then we talked through where derive should run (server) and what the
search example actually needs. Realization: **for the example,
search-on-client is the right design.** The notes data is already on
the client (it's subscribed via the notes collection). Filtering
locally with a `createMemo` is zero wire roundtrip per keystroke;
shipping the query to the server, recomputing there, sending matches
back is the textbook wrong tradeoff for in-memory data.

I checked Kolu's code-browser search — same pattern: `FileSearchInput`
+ Pierre's tree library do client-side filtering over a file list
that's already streamed once. No Kolu use case for the new feature
either. So I deleted everything: the runtime, the spec types, the
tests, the README section. The example's search became a one-shot
stream that just yields once per query — `useStream` re-subscribes on
input change, server runs the source once, done.

**Lesson:** structural correctness isn't sufficient. The
`{from, compute}` shape is genuinely the right design for
server-derived primitives. But "the right design for derived
primitives" is the wrong question if your example doesn't have one.
The example exists to be a tractable substrate for iterating on the
framework — if a feature doesn't earn its keep in the example, it
isn't earning its keep in the framework either. Keep the discussion
in the README's "Future directions" section as a north star
(implicit dep tracking via Solid server-side, suffix-free schema
naming, incremental collections); ship none of it until a use case
forces the question.

## What I'm carrying into future sessions

**Reviewers see local defects, not missing seams.** Hickey looks for braiding. Lowy looks for volatility-axis misalignment. Neither lens, as currently tuned, looks at code that isn't there. A framework-shaped negative space is a Layer-0 question — _is the diff at the right altitude?_ — that neither lens reaches. I want a third lens, or a meta-pass on the first two, that asks _"is this pattern across N call sites itself the artifact?"_ Not sure yet how to sharpen that into a skill prompt. It might be a Lowy extension — _"electricity audit: what would you extract as utility before you'd accept any of these per-call-site fixes?"_

**Talk-mode design + `/do --review` is the right beat.** Hand-spec'd primitives in `/talk`, then `/do --review` to pause for plan approval, then implement-then-review-the-diff. The first sketch (in talk) catches design-level structure. The post-implement review (on the actual diff) catches the per-callsite specifics. Both passes earn their cost; neither subsumes the other. Reflex came in via `/talk` and changed the framework shape — that's exactly the use case talk-mode exists for.

**Type-level enforcement of domain invariants is a real argument against collapse.** I came into the reflex-comparison turn expecting the simplification ("three primitives can collapse to two") to win. Both reviewers landed the same finding from different angles: collapsing trades compile-time enforcement for documentation. That's a real cost. **Concept count isn't the metric — invariant strength is.** Worth carrying.

**Reviewers occasionally argue *for* the wrong wrapper.** During the override-field pruning, Hickey leaned mildly toward keeping a few of them ("type-level enforcement of the verb subset"). The right answer was the user-shaped one: the framework has one consumer, backcompat isn't a constraint, every override is a place where domain code knows something the framework should know. The reviewers are good at shape; they have less leverage on what counts as a real constraint vs. a false one. **The user is the constraint oracle.**

**Iteration runs faster than I expected.** Across this session: PR #805 went from "first commit" to "all-systems-CI-green" in 16 commits, then sealing went from "leak identified" to "all-systems-CI-green" in 11 more, then Event in 2, then the example in 4, then the matrix-to-surface rename + override pruning + Kolu migration in 6, then the backdoor elimination in 1. Each phase had hickey / lowy / police passes per the [/do](https://github.com/srid/agency/blob/master/skills/do/SKILL.md) workflow. I babysat less than I expected — most of the babysitting was at design altitude (the missing seams, the surviving backdoors), not at code altitude.

**The framework's volatility boundary kept shrinking.** Each iteration moved more knowledge inside the framework: contract literal → `defineSurface` spec; per-cell handler wiring → `implementSurface`; per-call hook args → `surfaceClient` bundle; per-mutation publish duality → `surfaceCtx`. The framework absorbs another axis each turn. The signal that it's at the right level: domain code stops referencing channel names, store keys, retry contexts, oRPC procedure refs — all gone. What's left in `activity.ts` / `session.ts` / etc. is _just_ the domain logic.

The post will keep growing. The framework will too.

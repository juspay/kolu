---
title: "Electricity from a diff: extracting Kolu's cells"
description: "A Lowy-style 'electricity' extraction in five turns. The reviewers didn't see the framework; one /talk turn turned three Solid primitives into a four-primitive end-to-end framework."
pubDate: 2026-05-01
author: "Sridhar Ratnakumar"
---

_Running notes from the session that produced [@kolu/cells](https://github.com/juspay/kolu/tree/master/packages/cells). Not a finish line — a snapshot mid-process. I'll keep updating as the framework evolves._

In [_Righting Software_](https://www.amazon.com/Righting-Software-Method-Engineering-Architecture/dp/0136524036), Juval Löwy argues that infrastructure should feel like the **electricity** in a building: invisible, ubiquitous, plugged into via simple sockets. Domain code is the appliance you swap. The wiring stays put. **Volatility decomposition** is the discipline of deciding which is which.

This post is a session log. Across five conversational turns, a handful of `createSubscription` calls in Kolu's client + a parallel set of hand-rolled `yield X; for await ev of subscribeSystem_(...) yield ev` loops in Kolu's server became `@kolu/cells` — a four-primitive end-to-end framework that owns the entire snapshot+deltas wire protocol on both sides. Domain modules in Kolu shrank by ~190 lines net and stopped knowing about retry contexts, publisher channels, or oRPC plumbing.

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

- **Hickey F4 (the sharpest):** the proposed `terminalChannels` registry on the server only covered the **read** side. Write-side `publishForTerminal(...)` calls would still be scattered. The fix had to be symmetric — each entry a `ChannelBus<T>` owning both publish and subscribe.

- **Lowy F7:** before deleting `subscribeForTerminal_`, the callback-form wrapper used by 5 providers had to be audited. The deletion would have stranded those.

Both bites changed the design before any code was written. That's the talk-mode hickey/lowy at its best: a concrete sketch, two lenses on it, the proposal revised in light of what landed. The post-implement review on the actual diff caught a few more — `Cell.name` doc was misleading (it doesn't actually serve as the channel name; channel names are passed explicitly), `createCellsClient` returned `{client}` for no reason (YAGNI wrapper), `consumeChannel` helper extracted from the 5 inlined try/catch blocks.

By the end of this turn the framework owned the entire wire protocol end-to-end. Kolu's `client/` and `server/` lost ~190 lines of generic transport plumbing.

## Turn 4: reflex says you missed one

This is the turn that changed how I think about the framework.

I asked the model to research [reflex-frp](https://github.com/reflex-frp/reflex) — the Haskell FRP library — and explain how its types map to what we'd built. The map came back almost too cleanly:

| Reflex | `@kolu/cells` |
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

## Turn 5: a runnable example

The framework had a thorough README with a side-by-side "How Kolu uses this" inventory, plus a `## Comparison with Reflex-FRP` section laying out what we took (vocabulary, snapshot+deltas-as-Incremental, Stream input-parameterization) and what we didn't (`Behavior`, `MonadQuery`'s `Group`/`crop`/`SelectedCount` cross-network machinery, monadic Dynamic composition, one-primitive-fits-all). Kolu is single-client per session — Reflex's plumbing for `100 clients × shared subscriptions` doesn't pay back its weight at this scale.

But a reader of the framework still couldn't see it run without reading Kolu's source. So I asked for a minimal example that demonstrated all four primitives in one place. The candidate was a notes app:

- `prefsCell` — editor preferences (font size, theme). `authority: "local"` instant-UI mutation, `applyPatch` for partial updates.
- `notesCollection` — notes keyed by id. Sidebar list with per-key reactive lifecycle.
- `searchStream` — full-text search parameterized by query string. `pollOnEvent`-driven re-derivation when notes change.
- `autosaveEvent` — "Saved" flash beside the active note title. Handler-based, no current value.

It came together in ~500 LOC across server + client + common, single-file `App.tsx` so every hook is visible end-to-end. Hono + WebSocket + Vite + Tailwind v4. Self-contained, no Kolu-internal imports.

I forgot to add the example to CI — caught me in the next turn. Fixed: `ci::cells-example-build` step that runs `pnpm --filter @kolu/cells-example build:client` to validate the example's Tailwind config + JSX + production bundle compile through. Fifteen CI contexts now (was fourteen).

## What I'm carrying into future sessions

**Reviewers see local defects, not missing seams.** Hickey looks for braiding. Lowy looks for volatility-axis misalignment. Neither lens, as currently tuned, looks at code that isn't there. A framework-shaped negative space is a Layer-0 question — _is the diff at the right altitude?_ — that neither lens reaches. I want a third lens, or a meta-pass on the first two, that asks _"is this pattern across N call sites itself the artifact?"_ Not sure yet how to sharpen that into a skill prompt. It might be a Lowy extension — _"electricity audit: what would you extract as utility before you'd accept any of these per-call-site fixes?"_

**Talk-mode design + `/do --review` is the right beat.** Hand-spec'd primitives in `/talk`, then `/do --review` to pause for plan approval, then implement-then-review-the-diff. The first sketch (in talk) catches design-level structure. The post-implement review (on the actual diff) catches the per-callsite specifics. Both passes earn their cost; neither subsumes the other. Reflex came in via `/talk` and changed the framework shape — that's exactly the use case talk-mode exists for.

**Type-level enforcement of domain invariants is a real argument against collapse.** I came into the reflex-comparison turn expecting the simplification ("three primitives can collapse to two") to win. Both reviewers landed the same finding from different angles: collapsing trades compile-time enforcement for documentation. That's a real cost. **Concept count isn't the metric — invariant strength is.** Worth carrying.

**Iteration runs faster than I expected.** Across this session: PR #805 went from "first commit" to "all-systems-CI-green" in 16 commits, then sealing went from "leak identified" to "all-systems-CI-green" in 11 more, then Event went in 2 more, then the example in 4 more. Each phase had hickey/lowy/police passes per the [/do](https://github.com/srid/agency/blob/master/skills/do/SKILL.md) workflow. I babysat less than I expected — most of the babysitting was at design altitude (the missing seams), not at code altitude.

The framework is at a stopping point that feels right for now. Not a finish line — a snapshot mid-process. I'll keep iterating. **Next, I think, is a closer look at whether the `cellBus` (in `packages/server/src/cells.ts`) and `terminalChannels` (in `packages/server/src/publisher.ts`) registries should fold into one** — both are typed-channel registries on the same `MemoryPublisher`, the boundary is enforced by convention only. Hickey flagged this as a Layer-3 fragmentation worth tracking but not blocking. The argument for keeping them separate is real (different lifecycle semantics: cells tied to handler subscriptions, terminal channels fire regardless). The argument for unifying is real too (one channel-registry primitive across the server). I'll come back to it.

The post will keep growing.

---
title: "Two lenses, one line"
description: "When Hickey's structural-simplicity lens and Lowy's volatility lens flag the same line of code, trust the finding more than either agent alone."
pubDate: 2026-04-18
author: "Sridhar Ratnakumar"
---

_When Hickey's structural-simplicity lens and Lowy's volatility lens
flag the same line of code, trust the finding more than either agent
alone._

The best refactor signal I've found in code review this year is when
two independent reviewers, aimed at different axes of complexity, flag
the same line. Not the same kind of problem. The same line. When
Rich Hickey's "what's braided together" lens and Juval Lowy's "what
changes at different rates" lens both point at it, you're not looking
at a style issue. You're looking at a missing split.

I'll name it: **binocular agreement.** Two eyes, different angles,
converging on one point. When it happens the fix is almost never a
local polish. It's a concept that was trying to be two concepts. The
evidence that you got the refactor right is that both lenses go quiet
afterward — and the diff shrinks.

I ran both reviewers on [PR #623](https://github.com/juspay/kolu/pull/623)
of [Kolu](https://github.com/juspay/kolu), a canvas-only UX redesign.
They ran twice: [once before I wrote any code](https://github.com/juspay/kolu/pull/623#issuecomment-4272457685),
and [once after I'd iterated for a day on the design](https://github.com/juspay/kolu/pull/623#issuecomment-4274565406).
The second pass is where the story lives — because by then I thought
the code was done.

## What the two lenses are

Rich Hickey's *Simple Made Easy* gives you one question: **is this
complected?** Are two ideas braided together in one thing, so that to
touch one you have to touch the other? A Hickey reviewer reads code
the way a lockpicker reads a tumbler — looking for concepts that
shouldn't be in the same position. The output is always "split these
apart."

Juval Lowy's *Righting Software*, building on [Parnas 1972](https://www.win.tue.nl/~wstomv/edu/2ip30/references/criteria_for_modularization.pdf),
gives you a different question: **what changes at a different rate
than its neighbors?** A Lowy reviewer reads code the way an actuary
reads a portfolio — looking for things coupled to unrelated
schedules. The output is always "draw a boundary that encapsulates
this volatility."

These sound adjacent. They aren't. Hickey is a *timeless structural*
question: the code, right now, has a concept-duplication problem or
it doesn't. Lowy is a *temporal* question: these two things will
drift in the future on clocks you can name, and the code doesn't
know that yet. You can have one without the other. A module can be
perfectly uncomplected and still be a volatility time-bomb — one
clean concept that happens to fuse three things that will rev
independently. A module can be volatility-safe and still be
complected — one cleanly-bounded boundary with two unrelated
concepts braided inside.

Which is why running both is not redundant. It's binocular.

## The `canvasMaximized` case

In PR #623, the Canvas-vs-Focus mode seam went away. Desktop is now
always the 2D canvas; mobile is always the fullscreen-with-swipe.
Inside that, a tile can be *maximized* — one terminal fills the
viewport, double-click to toggle.

The first version I shipped to the branch treated `canvasMaximized`
the way every other user-state signal in Kolu is treated: as a
`Preferences` field, synced through the server via oRPC, persisted
in `SavedSession`, hydrated on mount, with a careful `maxHydrated`
sequencing flag to avoid a first-render flash. `just check` passed.
The e2es passed. I would have merged it.

Then the second Hickey pass said:

> `canvasMaximized` state ownership + hydration sequencing + server
> sync spread across `useViewState`, `useSessionRestore`, and a
> `maxHydrated` ordering flag.

Translation: three concepts — *what's maximized*, *when is the
client caught up to the server*, *how do we avoid a flash on first
paint* — are braided into one propagation chain. You can't touch
any of them without thinking about the other two.

Then the second Lowy pass, running independently on the same diff,
said:

> `canvasMaximized` collapsed three independent volatilities (client
> UI signal + server module-level state + `SavedSession`
> persistence) into one propagation chain — but no consumer needed
> cross-client awareness.

Translation: these three things will change on different clocks.
The UI gesture revs fast (per interaction). The server module revs
slowly (schema changes). `SavedSession` has versioning concerns of
its own. They were strapped together with no consumer requiring
the coupling.

Both reviewers arrived, from different directions, at the same
finding. Both proposed the same fix. [Commit `99c1c44`](https://github.com/juspay/kolu/commit/99c1c44)
deleted the server field, the `SavedSession` entry, the hydration
flag, and the oRPC mutation, and moved the signal to `makePersisted`
on `localStorage`. Across nine files: **14 insertions, 90
deletions.** Net -76 lines. The second Hickey pass said "you
complected three things"; the second Lowy pass said "you mis-scoped
three volatilities"; both said "the fix is to stop propagating it
at all."

That's binocular agreement. You stop arguing with it.

## Why the two passes catch different things

The first-round reviews ran before I wrote any code, against a
design sketch. They caught the obvious structural risks — terminal
identity scattered across `PillTree`, `CanvasTile` and
`CanvasMinimap`; maximize drifting out of sync with active
selection; the mobile-vs-desktop split turning into scattered
conditionals. All three got designed around before the first line
of code.

The second-round reviews ran against the finished diff. They found
a completely different set of issues — the ones that only emerge
after you've tried to build it and taste-decided your way through
twenty design micro-choices. Pre-implementation review is cheap; it
catches categories. Post-implementation review is expensive; it
catches what specific design iterations did to your architecture
while you weren't looking.

The `canvasMaximized` problem didn't exist at design time. I
invented it on the branch, iterating on "maximize should persist
across reloads so if you were zoomed in, you're still zoomed in."
That's a reasonable user-facing instinct. The implementation that
flowed from it — "persist it like every other preference" — was
the accident. No amount of up-front review would have caught it,
because the thing to review didn't exist yet.

If you only run these reviewers once, run them at the end. Not the
beginning.

## The non-binocular catches

The other findings in the second pass weren't binocular. Each hit
on one axis, not both, and they're useful precisely because they
show you what each lens catches alone.

**Hickey-only.** `CanvasTile`'s prop set was spelled out twice —
once in the tiled `<For>` branch, once in the maximized `<Show>`
branch. Every `theme`, `activity`, `renderTitle` prop repeated in
two places. Not a volatility issue: both branches will rev
together, always, by definition. Pure structural duplication.
[Extracted `renderTile(id, maximized)`](https://github.com/juspay/kolu/commit/22e42c9) —
one helper, two call sites. Lowy had nothing to say here and
shouldn't have.

**Lowy-only.** `getDisplayInfo` and `getTileTheme` were being
drilled as props through `App.tsx → ChromeBar → PillTree`.
Structurally, prop-drilling is not complecting — each hop passes a
closure through cleanly. But Kolu has an explicit
`no-preference-prop-drilling` rule precisely because this shape of
data has a different volatility from the component tree:
preferences and store lookups change via the user, the tree changes
via product design. A rule that looks like a style rule is actually
a volatility encapsulation. [Promoted `useTerminalStore` and
`useThemeManager` to `createRoot`-cached singletons](https://github.com/juspay/kolu/commit/22e42c9) —
190 insertions, 233 deletions. Another net negative. Hickey had
nothing to say here and shouldn't have.

Two lenses, each catching the thing the other can't. The reason to
keep running both is not that they overlap. It's that they don't.

## When to trust a single reviewer

Binocular agreement is the strongest signal. The corollary: a
finding from only one reviewer is a weaker signal, and you should
treat it that way.

If only Hickey fires, ask: *is this structural duplication actually
going to hurt, or am I about to DRY up two things that happen to
look alike but rev independently?* The `repoColor` helper duplicated
in `PillTree.tsx` and `MobileChromeSheet.tsx` was a safe DRY — one
semantic concept ("the canonical color for this repo") that happened
to have two call sites. Move it to `pillTreeOrder.ts`, done. But
I've seen Hickey-lens deduplications that collapsed two things that
*should* rev on different clocks, and the subsequent "now I need to
parameterize the helper" spiral is exactly what Lowy was trying to
prevent.

If only Lowy fires, ask: *am I drawing a boundary around a real
volatility, or around something that currently happens to look
bounded?* The `displaySuffix` collision-detection move — from
per-render re-derivation in the display layer to a server-side
concern that publishes into `TerminalMetadata` — was a real Lowy
catch. Collision detection isn't a display concern; it's a
server-side identity concern about the live terminal set. The
display layer was recomputing what the server already knew.
[Commit `5ac5fe2`](https://github.com/juspay/kolu/commit/5ac5fe2)
moved it, and every client's per-render identity logic went away.
But Lowy-lens module splits drawn for volatility that never
actually revs are premature abstractions, and that's its own
failure mode.

Binocular agreement cuts through both of these second-guesses,
because the two reviewers disagree about everything *except*
whether this particular line is wrong. That disagreement is what
gives the agreement its weight.

## How to run it

One practical thing: run them as *independent* reviewers, not as
one pass. If you ask a single reader to "check for structural
simplicity and volatility," you get a blended answer. Blended
answers bias toward whichever axis the reader already cares about.
Separate the passes. Hickey agent reads the diff, writes findings.
Lowy agent reads the same diff, writes findings. You read both,
looking for overlap. The overlap is the signal.

Another: don't expect the reviewers to agree on *fixes*. They
agree on *locations*. Their prescriptions diverge. Hickey wants you
to decouple the concepts. Lowy wants you to encapsulate the
volatilities. Sometimes those are the same edit. Sometimes Hickey
says "split the function" and Lowy says "move the boundary," and
both are right in a way that only the third, synthesizing read —
yours — can land. The fix you ship is rarely either agent's
literal proposal.

Third: when the passes disagree, don't split the difference. Pick
the one whose reasoning held under your own pushback, and drop the
other. Splitting the difference gives you the worst of both —
neither a clean concept nor a clean volatility boundary, just a
compromise that fails both tests six months later.

## The line

*When two independent lenses agree on a location, the fix isn't a
polish — it's a missing split.*

That's the whole essay. Everything else is an existence proof: the
`canvasMaximized` chain, the display-suffix server move, the
singleton promotion. The reviewers disagree about what they're
looking for. They agree only on where the code is wrong. That
agreement is worth more than either finding alone.

PR #623 shipped seven refactor commits past the point I would have
merged on taste. Every one of them made the diff smaller. That's
the other thing binocular agreement does — the fix removes code,
it doesn't add it. If a "simplification" is making your diff
bigger, one of your lenses is broken. Probably both.

Ship it when both agents go quiet. Not before.

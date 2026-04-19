---
title: "The spacetime of code"
description: "Complexity creeps along two axes — space and time. Hickey catches one; Löwy catches the other. A single-lens review only audits half the code."
pubDate: 2026-04-19
author: "Sridhar Ratnakumar"
---

_Complexity creeps along two axes — space and time. Hickey catches
one; Löwy catches the other. A single-lens review only audits half
the code._

Code goes wrong along two axes, not one. The code on the page right
now can be _spatially_ wrong — concepts braided together, names that
mean two things, seams that aren't really seams. The same code can
be _temporally_ wrong — parts that will rev on different clocks,
decisions that will be revisited, volatilities that got bound when
they should have stayed apart. Two different defects. Two different
lenses. Most code review runs one.

I run two. Rich Hickey's structural-simplicity lens catches defects
on the spatial axis. Juval Löwy's volatility-decomposition lens
catches defects on the temporal one. Each lens sees things the
other is blind to. A review that only ran one of them would have
been perfectly satisfied with the diff.

That's the practice this post is arguing for. The framing I'll use
to justify it is that code has a _spacetime_ — two orthogonal axes
of complexity creep, not one. Measure both, or miss half.

<div class="tweet-embed">
<blockquote class="twitter-tweet" data-dnt="true" data-theme="dark"><p lang="en" dir="ltr">I think the biggest productivity boost from AI will come when we can nearly automate the software architect out of existence.<br><br>I&#39;m refining both /hickey and /lowy toward that end — so I don&#39;t have to babysit the AI after every PR.</p>&mdash; Sridhar Ratnakumar (@sridca) <a href="https://twitter.com/sridca/status/2044792589119832082?ref_src=twsrc%5Etfw">April 16, 2026</a></blockquote>
<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
</div>

I posted that two days ago. This post is the practice.

This matters more than it used to. Most of the code I ship is no
longer typed by hand — [Claude Code](https://claude.com/claude-code)
writes it from high-level intent, faster than line-by-line human
review can keep up with. Diff-inspection has quietly stopped being
the highest-leverage human activity during review; structural
review has. And structural review is exactly what two orthogonal
agent reviewers, aimed at a finished diff and run in parallel, are
good at. The human's remaining job is to pick the lenses, read the
findings, and decide.

I ran both reviewers on [PR #623](https://github.com/juspay/kolu/pull/623)[^1]
of [Kolu](https://github.com/juspay/kolu), a canvas-only UX redesign.
I drove the iterations; Claude Code wrote every line piecemeal,
and the two reviewers are themselves Claude Code subagents spawned
from the same session. The reviewers
ran [once before any code was written](https://github.com/juspay/kolu/pull/623#issuecomment-4272457685)
and then [twice against the committed diff](https://github.com/juspay/kolu/pull/623#issuecomment-4274952616)
as revisions went in. Across the post-implementation passes, most
findings hit one axis — with a handful of cases where both lenses
agreed on a piece of code that would have shipped otherwise. The
one-axis findings are the story this post is built around.

## What the two lenses are

Rich Hickey's _Simple Made Easy_ gives you one question: **is this
complected?** Are two ideas braided together in one thing, so that
to touch one you have to touch the other? Hickey is literal about
the word:

> Okay. So there's this really cool word called _complect_. I found
> it. I love it. It means to interleave or entwine or braid. Okay?
> I want to start talking about what we do to our software that
> makes it bad.
>
> — Rich Hickey, [_Simple Made Easy_](https://www.infoq.com/presentations/Simple-Made-Easy/) (Strange Loop, 2011)

A [Hickey reviewer](https://github.com/srid/agency/blob/master/.apm/skills/hickey/SKILL.md)
reads code the way a lockpicker reads a tumbler — looking for
concepts that shouldn't be in the same position. The output is
always "split these apart."

Juval Löwy's _Righting Software_ (2019) gives you a different
question: **what changes at a different rate than its neighbors?**
Löwy builds on David Parnas, who had the rule fifty-four years
ago:

> We propose instead that one begins with a list of difficult design
> decisions or design decisions which are likely to change. Each
> module is then designed to hide such a decision from the others.
>
> — David Parnas, [_On the Criteria To Be Used in Decomposing
> Systems into Modules_](https://www.win.tue.nl/~wstomv/edu/2ip30/references/criteria_for_modularization.pdf) (1972)

A [Löwy reviewer](https://github.com/srid/agency/blob/master/.apm/skills/lowy/SKILL.md)
reads code the way an actuary reads a portfolio — looking for
things coupled to unrelated schedules. The output is always "draw
a boundary that encapsulates this volatility."

These sound adjacent. They aren't. Hickey is a _spatial_ question:
the code, right now, in the snapshot on the page, has a
concept-duplication problem or it doesn't. Löwy is a _temporal_
question: these two things will drift in the future on clocks you
can name, and the code doesn't know that yet. Defects live on one
axis, the other, or — rarely — both. A module can be perfectly
uncomplected and still be a volatility time-bomb. A module can be
volatility-safe and still be complected. The lenses don't overlap.
They aren't meant to.

## The spacetime of code

In physics, space and time are not independent. They're two
projections of one four-dimensional manifold — different observers,
depending on how they're moving, measure different mixes of the
two. What looks like pure space from one frame is a blend of space
_and_ time from another. But the interval between events is the
same in every frame. The structure is real, prior to any observer's
view of it.

Code has a spacetime too. A module's current shape (what's braided
with what, what shares a name, what occupies the same scope) is
one projection. Its evolution (what will rev on what clock, which
decisions will be revisited, how fast each part drifts) is
another. A defect can live in one projection without registering
in the other — and usually does.

Hickey's lens is a space-like observer. It reads the code as a
snapshot: what's tangled right now? Löwy's lens is a time-like
observer. It reads the same code as a world-line: what will pull
apart, and when? They are measuring different axes. Each is blind
to what lives only in the other.

Löwy says as much himself, in an appendix on complexity:

> Functional decomposition is as diverse as the required
> functionality across all customers and points in time. The
> resulting huge diversity in the architecture leads directly to
> out-of-control complexity.
>
> — Juval Löwy, _Righting Software_ (Appendix B)

The complexity Löwy warns about is temporal in origin — _diversity
across customers and points in time_ — but spatial in eventual
manifestation. Mis-scoped volatilities eventually become complected
code. Still, the two usually arrive out of phase. The spatial
defect shows up now; the temporal defect only reveals itself later,
when the clock it rides changes. That's why a review that runs one
lens is blind to roughly half of what's actually wrong.

## A spatial defect: `borderClass`

The Kolu canvas has a pill tree — one pill per terminal, grouped
by repo. Each pill's border carries two concerns: _activity_ (is
an agent thinking, using tools, waiting?) and _focus_ (is this the
active terminal?). The first implementation fused them into one
Cartesian `ts-pattern` match:

```ts
const borderClass = () =>
  match([active(), agentState()] as const)
    .with([P._, P.union("thinking", "tool_use")], ([a]) =>
      a
        ? "pill-border pill-border-spin pill-glow-inner"
        : "pill-border pill-border-spin",
    )
    .with([P._, "waiting"], ([a]) =>
      a
        ? "pill-border pill-border-waiting pill-glow-inner"
        : "pill-border pill-border-waiting",
    )
    .with([true, undefined], () => "pill-border pill-border-active")
    // ... etc
    .exhaustive();
```

The comment above it, in the committed code, said: _"Single border
channel: encodes BOTH active-ness and agent state."_ The code was
honest about what it was doing. It was a single pattern match
returning a single class string, with two concepts braided into
every arm.

The Hickey pass flagged it. Two concepts — _what the agent is
doing_ and _whether this terminal is focused_ — were in the same
pattern match, sharing arms, concatenated into one string. Adding a
new agent variant (say, `streaming`) forced you to write both an
active-and-streaming arm and an inactive-and-streaming arm. The
`active` dimension intruded into every change that had nothing to
do with focus.

[Commit `fd6f802`](https://github.com/juspay/kolu/commit/fd6f802)
split them:

```ts
const agentBorderClass = () =>
  match(agentState())
    .with(P.union("thinking", "tool_use"), () => "pill-border pill-border-spin")
    .with("waiting", () => "pill-border pill-border-waiting")
    .otherwise(() => "pill-border pill-border-active");

// at the call site:
<div
  class={agentBorderClass()}
  classList={{ "pill-glow-inner": active() }}
/>
```

Two composers, two concerns. Agent state drives the animation;
`classList` composes the active glow on top. Adding `streaming` now
touches exactly the agent-state match. The new comment reads:
_"Two orthogonal border concerns, composed via classList."_ The
code's own vocabulary flipped from _BOTH_ to _orthogonal_.

Löwy had nothing to say here. Active-ness and agent state rev on
the same clock — they're both user-driven UI state that changes at
interaction speed. No temporal mis-scope, no volatility boundary
to draw. The defect was purely spatial: two concepts in one match,
splittable by rewriting, end of story.

Every codebase has a `borderClass`. It's the kind of code that
gets merged because it works. The Löwy lens is blind to it.
Without Hickey in rotation, it stays.

## A temporal defect: `displaySuffix`

Two terminals can land on the same identity — same git
`repoName + branch`, or same `cwd` for non-git terminals. The UI
has to disambiguate them. Kolu does it with a short
collision-suffix on the label: `main #a3f2`. Cute problem; obvious
solution.

The first implementation computed the suffix client-side, in
`terminalDisplay.ts`. Every render, every pill-tree redraw, every
tile chrome update, the client walked the terminal list, built an
identity map, counted collisions, and emitted the suffix for any
id whose identity had duplicates. It worked. Tests passed. The
suffix showed up.

The Hickey pass had nothing to say. Structurally, the logic was
cleanly encapsulated in one file, read by two or three consumers,
using well-named helpers (`identityKey`, `idSuffix`,
`identityCounts`). Nothing was braided. The snapshot looked fine.

The Löwy pass said:

> Identity-collision is a business rule about the live terminal
> set, not a per-render display preference. The volatility — "which
> terminals collide _right now_" — lives on the server, where the
> terminal set lives. The display layer is recomputing what the
> server already knows.

That's a volatility argument, not a structural one. The collision
set changes on a specific clock: terminal lifecycle events (create,
kill, cwd change, git metadata update). Not on render. Not on
display preferences. Not on anything else. Putting the derivation
in the display layer means every client, every tab, every render
independently re-derives what is, in fact, a global property of a
single set owned by a single service.

[Commit `5ac5fe2`](https://github.com/juspay/kolu/commit/5ac5fe2)
moved it. `recomputeDisplaySuffixes()` runs in
`packages/server/src/terminals.ts` on every metadata mutation:

```ts
export function recomputeDisplaySuffixes(): TerminalId[] {
  const counts = new Map<string, number>();
  for (const entry of terminals.values()) {
    const k = identityKey(entry.info.meta);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const changed: TerminalId[] = [];
  for (const [id, entry] of terminals.entries()) {
    const m = entry.info.meta;
    const next =
      (counts.get(identityKey(m)) ?? 0) > 1 ? `#${id.slice(0, 4)}` : undefined;
    if (m.displaySuffix !== next) {
      m.displaySuffix = next;
      changed.push(id);
    }
  }
  return changed;
}
```

O(N) sweep, delta gate, fan-out republish for the sibling whose
collision status flipped. `TerminalMetadata` carries
`displaySuffix?: string` directly. Clients render `meta.displaySuffix`
and delete the identity-tracking module entirely.

Hickey had nothing to say. Structurally, the before-and-after
diffs look equivalent — a function in one file either way. What
changed was _where the volatility lives_: with the concern that
causes it. The Löwy lens is the only one that could see it.

Every codebase has a `displaySuffix`. Something derived in the
wrong layer, because the wrong layer is the easiest place to write
it. Without Löwy in rotation, it stays — and every future change
to collision rules has to walk the client layer to find it.

## When both lenses fire: an aside

The one case in PR #623 where the two lenses converged on the same
line was `canvasMaximized` — a piece of state tracking "which tile,
if any, is currently filling the viewport." The first
implementation treated it the way every other user preference is
treated in Kolu: a `Preferences` field, synced through the server,
persisted in `SavedSession`, hydrated on mount with a careful
`maxHydrated` sequencing flag to avoid a first-render flash.

Hickey's pass flagged it as three concepts braided into one
propagation chain: _what's maximized_, _when is the client caught
up to the server_, _how do we avoid a flash on first paint_. Löwy's
pass, running independently, flagged it as three volatilities with
no shared consumer: a client UI signal that revs at interaction
speed, a server module field that revs on schema changes, and a
`SavedSession` entry with its own versioning concerns.

Different diagnoses. Same line. Same fix. [Commit `99c1c44`](https://github.com/juspay/kolu/commit/99c1c44)
deleted the server field, the `SavedSession` entry, the hydration
flag, and the oRPC mutation, and moved the signal to
`makePersisted` on `localStorage`. Across nine files: 14 insertions,
90 deletions.

When both lenses fire at the same coordinate, it's because the
defect registers in both projections of the invariant — the
factoring is wrong at a level that shows up both spatially (right
now, in the propagation chain) and temporally (in the mismatched
clocks the fields were bound to). Call it **binocular agreement**.
It's a particularly sharp signal when it happens. It's also the
minority. In PR #623, binocular findings were outnumbered several-
to-one by single-axis ones across three review passes — and the
binocular cases that did surface tended to come from later passes,
because revisions keep introducing the defects both lenses catch
together. Most findings, including the two centerpieces of this
post, were single-axis. That's the common shape.

## Why the two passes catch different things

The pre-implementation reviews ran before any code was written,
against a design sketch. They caught the obvious structural risks
— terminal identity scattered across `PillTree`, `CanvasTile` and
`CanvasMinimap`; the mobile-vs-desktop split turning into scattered
conditionals. All of them got designed around before the first
line of code.

The post-implementation reviews ran against the committed diff,
then again after revisions. They found a completely different set
of issues — the ones that only emerge after implementation has
taste-decided its way through twenty design micro-choices. Pre-implementation review is cheap; it
catches categories. Post-implementation review is expensive; it
catches what specific design iterations did to the architecture
while nobody was looking. Both the `borderClass` braid and the
`displaySuffix` mis-location emerged during implementation.
Neither existed in the design sketch.

If you only run these reviewers once, run them at the end. Not the
beginning.

## When to trust a single-lens finding

Most findings are single-lens. The practical question is how to
evaluate them.

If only Hickey fires, ask: _is this structural duplication actually
going to hurt, or am I about to DRY up two things that happen to
look alike but rev independently?_ The `repoColor` helper
duplicated in `PillTree.tsx` and `MobileChromeSheet.tsx` was a safe
DRY — one semantic concept ("the canonical color for this repo")
that happened to have two call sites. Move it to `pillTreeOrder.ts`,
done. But I've seen Hickey-lens deduplications that collapsed two
things that _should_ rev on different clocks, and the subsequent
"now I need to parameterize the helper" spiral is exactly what
Löwy exists to prevent.

If only Löwy fires, ask: _am I drawing a boundary around a real
volatility, or around something that currently happens to look
bounded?_ `displaySuffix` was a real Löwy catch — collision
detection genuinely revs on terminal lifecycle, not display
preferences. But Löwy-lens module splits drawn for volatility that
never actually revs are premature abstractions, and that's its own
failure mode.

The Hickey failure mode is over-merging: collapsing things that
should be separate. The Löwy failure mode is over-splitting:
carving up things that don't need boundaries. Each lens has its
own way of being wrong. Running the other lens as a counterweight
helps, but only if you let it — not as a veto, as a second
opinion.

## How to run them

Run them as _independent_ reviewers, not as one pass. If you ask a
single reader to "check for structural simplicity and volatility,"
you get a blended answer. Blended answers bias toward whichever
axis the reader already cares about. Separate the passes. Hickey
agent reads the diff, writes findings. Löwy agent reads the same
diff, writes findings. You read both. (Both agents ship in
[srid/agency](https://github.com/srid/agency) as subagents your
main Claude Code session can spawn in parallel.)

Don't expect the reviewers to agree on _fixes_. They agree on
_locations_, occasionally — and on those occasions, they're
rarely prescribing the same edit. Hickey wants you to decouple
the concepts. Löwy wants you to encapsulate the volatilities.
Sometimes those are the same edit. Sometimes Hickey says "split
the function" and Löwy says "move the boundary," and both are
right in a way that only the third, synthesizing read — yours —
can land. The fix you ship is rarely either agent's literal
proposal.

When the passes disagree, don't split the difference. Pick the
one whose reasoning held under your own pushback, and drop the
other. Splitting the difference gives you the worst of both —
neither a clean concept nor a clean volatility boundary, just a
compromise that fails both tests six months later.

## The line

_A single-lens review is a half-review. Code has a spacetime;
complexity creeps along both axes._

That's the whole essay. Everything else is existence proof: the
`borderClass` braid that Löwy couldn't see, the `displaySuffix`
mis-location that Hickey couldn't see, the `canvasMaximized` chain
where both lenses happened to land on the same line. Most findings
on one axis. A handful on both. A team that had run only Hickey
would have shipped with `displaySuffix` recomputed per render on
every client forever. A team that had run only Löwy would have
shipped with a `borderClass` pattern match that intruded on every
future agent-state variant.

PR #623 shipped seven refactor commits past the point I would have
merged on taste. Every one of them made the diff smaller. That's
the other thing this practice does — the fix removes code, it
doesn't add it. If a "simplification" is making your diff bigger,
one of your lenses is broken. Probably both.

Ship when both lenses go quiet. Not before.

## Further reading

- [**srid/agency**](https://github.com/srid/agency) — my
  near-autonomous workflow for coding agents, packaged as an APM
  package. Includes both reviewers; your main session spawns them
  in parallel and collates findings.
- [**hickey/SKILL.md**](https://github.com/srid/agency/blob/master/.apm/skills/hickey/SKILL.md)
  — the structural-simplicity reviewer. What "complected" means in
  practice, the four axes the agent grades on, worked examples of
  findings.
- [**lowy/SKILL.md**](https://github.com/srid/agency/blob/master/.apm/skills/lowy/SKILL.md)
  — the volatility-decomposition reviewer. The Parnas-1972 lineage,
  the "encapsulate what changes" discipline, how to tell a real
  volatility from a cosmetic one.
- [**PR #623 Hickey/Löwy analysis (pre-impl)**](https://github.com/juspay/kolu/pull/623#issuecomment-4272457685)
  — the first pass, against a design sketch.
- [**PR #623 Hickey/Löwy analysis (post-impl)**](https://github.com/juspay/kolu/pull/623#issuecomment-4274565406)
  — the second pass, against the finished diff. `borderClass`,
  `displaySuffix`, and `canvasMaximized` are all here.
- **The source texts.** Rich Hickey, [_Simple Made Easy_](https://www.infoq.com/presentations/Simple-Made-Easy/)
  (2011 talk). Juval Löwy, _Righting Software_ (2019). David
  Parnas, [_On the Criteria To Be Used in Decomposing Systems into
  Modules_](https://www.win.tue.nl/~wstomv/edu/2ip30/references/criteria_for_modularization.pdf)
  (1972) — still the clearest six pages on why the Löwy lens works.

[^1]: PR #623 is an outlier in my normal workflow — a "kitchen sink"
      PR landing a full UX redesign in one branch. I usually ship
      smaller, single-purpose PRs. The scale is part of why the
      third review pass caught things the earlier passes missed:
      a big diff has room for defects that a small one doesn't.

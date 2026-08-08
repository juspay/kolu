# Why the gauntlet is shaped this way

Background for anyone *editing* `SKILL.md`. A run doesn't need this file — the
procedure in `SKILL.md` is self-contained.

## Why serial, not parallel

Collisions are an *edit* problem: two reviewers writing the same worktree at once
see torn, half-edited state. Running serially makes that impossible without any
snapshot machinery — when a step starts, the previous step has already committed,
so every reviewer reads a clean, settled tree and applies its own fixes directly.

The cost is wall-clock: `checks + lens + debate + simplify + police`, slower than
the old parallel form. What it buys is no snapshot, no change-request handoff,
and no separate apply pass — every step is its own editor and commits its own
work. `/simplify` in particular could not run as itself against the old
read-only snapshot; now it can.

## Why comments wait for the push

A comment that names a commit SHA must never be posted while that SHA is
local-only — if a later step failed or the run were interrupted, the PR would
advertise commits that were never pushed.

## Why architecture-first-principles runs first

Architecture-level findings (wrong library, wrong layer, dead API surface) get
fixed *before* the structural and code passes polish details that were about to
change shape.

Its skip rule is narrower than it looks. A diff is **not** trivially-local when
its correctness leans on a happens-before: P3 (state-and-time) is the only lens
that interrogates an ordering claim, so a leaf-module race-fix that skips it is
exactly how an untrue "race-safe / structural" comment ships past a green
gauntlet.

## Incidents these rules came from

- **`repoPath` silently degrading to `.`** — a cross-repo run had the lens stage
  re-review the *cwd* repo and commit five fixes onto the wrong repo. Same-repo
  runs had only ever "worked" by cwd coincidence. Hence: thread `repoPath` into
  every step, absolute paths, `git -C "$repoPath"`.
- **Babysitting a stage that was simply running** — a prior run wired 4-minute
  `ScheduleWakeup` polls *and* a 5-minute `/loop` to nudge a gauntlet that was
  mid-review. Pure churn. Hence: act only on real signals.
- **Unformatted trees reaching CI** — the reviewers edit and commit code but none
  guarantees formatting, and `just check` is tsc + biome *lint*, never the
  formatter. A hand-edit sails through a green `check` and reds `ci::fmt` in §5,
  burning a whole CI cycle. It has happened more than once. Hence: `just fmt`
  before any push.
- **`--no-elegance` for code-police** — its elegance pass re-invokes `/simplify`,
  which the simplify track already ran over the same tree: a full skill
  invocation to re-derive a near-guaranteed no-op.
- **Three false claims in one branch, each caught by a different track — by
  accident** — [#2117](https://github.com/juspay/kolu/pull/2117) shipped prose
  asserting behaviour the code did not have, three separate times, and no test
  could fail on any of it. architecture-first-principles found a docs page and a
  changelog entry promising that a failed `lifecycle_create` "really did not
  create a terminal, and retrying it is safe" — false, because padi commits the
  terminal *before* it writes the reply, so the reply can be lost after the work
  is done (`2f36cfe4e`). lowy found **six** sites asserting the ssh `--host`
  transport "cannot observe its own close", when `sshConnector` fires exactly once
  on its child's `exit`/`error`; what is actually missing is a field on
  `AgentDial` to carry it — and the false *reason* was load-bearing for the new
  receptacle's contract, i.e. the lie was steering the design (`984504409`).
  code-police's fact-check found an electricity-ledger row counting odu's
  `redialingAClient` among four hand-rolled `holdOneLink`s, when it opens a fresh
  socket per call and holds nothing — the *opposite* of the pattern, and evidence
  against the row it was cited for (`3f3bb7892`). A fourth, same class: afp's
  C6 found the comment on the #2082 fix itself claiming a born-dead connection
  "has no slot to invalidate" when the code returned it anyway. All four were
  written *during* that run — two by the implementing agent, one by the lens
  reconcile pass that was reviewing it. The tests never had a chance: both suites
  and all 48 CI contexts went green with the false prose in the tree, and the
  `atlas-sync` gate checks `dist/` freshness, not claim truth. Each track happened
  to read the prose while looking for something else, none was charged with it,
  and the last one surfaced only because the author had by then explicitly told
  code-police to hunt for more of the same — three catches, three tracks, zero
  repeatability. Hence: prose is a claim under review in every step, by standing
  rule rather than by the author remembering to ask.

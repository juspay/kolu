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
- **Two suites racing for the same sockets** (#1985) — the coordinator ran
  `@kolu/acp`'s vitest suite while code-police was running it too. That package
  (like `padi`, `port-forward`, `kaval`) sets `fileParallelism: false` *because*
  its tests bind real unix sockets and spawn real adapter processes; the flag
  serializes files within one run and says nothing about a second run on the
  same machine. The result read as 13 genuine failures, then a wedged run, then
  18 orphaned workers killed by PID. Hence: sole editor means sole test-runner.
- **A subagent's scratch file shipping in the nix closure** (#1985) — a lens
  agent wrote `packages/acp/cwdprobe.mjs` while reproducing a finding, and the
  coordinator's next `git add -A` committed it. `nix/workspace.nix` adds
  `../packages/acp` wholesale, so it rode into the build source closure as a
  fourth hand-rolled ACP client and outlived three review passes. Hence: stage
  by path, and read `git status --short` first.

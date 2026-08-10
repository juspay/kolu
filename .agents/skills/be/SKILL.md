---
name: be
description: Modern, interactive alternative to `/do` — clarify intent up front, then take a task end-to-end with a serial AI review gauntlet (lens review (lowy ∥ hickey) → agent debate → simplify → code-police, each editing the branch in turn) → CI → evidence. ONLY invoke when the user explicitly types `/be` or `$be`; never auto-select from a natural-language request.
argument-hint: "[--skip-gauntlet] <issue-url | prompt>"
---

# Be

Take a task to a shipped, reviewed PR. `/be` **opens with a short interview** —
then is **fully autonomous** from §1 onward: no further questions, no stopping
between steps, sensible defaults throughout. The only sanctioned pause after §0
is the plan-review handoff in §1 (when "plan first" was chosen). Concise by
design — mechanics live in the skills it calls. Why the rules below exist:
[`RATIONALE.md`](RATIONALE.md) — read when editing this skill, not running it.

**An interruption is a detour, not an exit.** A user interjection, a field bug,
a limit, a `/compact` — each suspends the phase machine. Handle it, then name
the phase you were in and resume it **in the same turn**, unasked. A step that
was in flight did **not** run — restart it; never count it done. Never close a
turn on "let me know if you want me to continue".

**Propagate autonomy to subagents.** Every delegation brief says *execute now;
don't wait for confirmation* — a subagent that returns a plan with no tool uses
gets resumed with "execute now", not surfaced to the user.

## Arguments

Parse `$ARGUMENTS` for flags; the remainder is the issue URL or task prompt.
`--skip-gauntlet` skips §4 entirely — an **explicit human opt-out** `/be` may
never invent mid-run.

## 0. Interview

One batched **`AskUserQuestion`** call before any work — your only chance to
ask, so surface every material unknown now. Don't pad; honor anything already
pinned in the prompt.

- **Plan first?** — Atlas-note plan for review before implementing, or
  implement straight (default straight unless large/ambiguous; an existing plan
  note in the prompt is the plan of record — skip the question).
- **Task kind** — bug fix · feature · refactor/chore (sets §2's test strategy).
- **Debate peer** — `claude`, `codex`, or `grok` for `/agent-debate`. No
  default: honor a peer named in the prompt, else ask.

**Coordinator exception:** when a delegating brief routes questions to its
channel (e.g. via `/kolu`), that channel replaces `AskUserQuestion` for the
**whole run** — write the questions to a file, send a one-line pointer, block on
the reply. This includes anything surfacing later: a falsified premise, a scope
fork, a design call. Never open a question dialog in your own PTY under a
coordinator, and never message the human directly.

## 1. Set up

- `git fetch origin`; branch off `origin/<default>`. Never commit to master.
- Read `.agency/do.md` for the project's check / fmt / test / ci commands and
  its `## PR evidence` section; reuse them throughout.
- **If planning first:** author the plan as an Atlas note via **`/atlas`**
  (`status: proposed`). Keep it high-level — what changes and the structural
  shape, with a UI mockup if anything renders — but **ground every load-bearing
  low-level fact against the installed code** (lockfile versions, a library's
  emitted markup, a framework's runtime behavior): verify empirically, don't
  recall from training. Self-check (high-level ✓ prototype-if-visual ✓
  facts-grounded ✓ renders clean ✓), push, hand over the preview links, and
  wait for the user's go — the one sanctioned pause. The plan ships in the PR.

## 2. Implement

**Honor the design philosophy first** (`conventions.md` → Design philosophy:
fail-fast · electricity boundaries · reuse the source of truth) and state in
the plan or PR body how the change honors each. A violation is a defect to fix
now, not a review finding to wait for.

**A new dependency is a load-bearing fact — ground it before you build on it.**
Before adding one, check what the workspace already resolves: a capability often
ships inside an installed package under a name you didn't grep for (its exports
map and any bundled docs are the check). Registry metadata for one package name
is not evidence the capability is absent.

- **Bug:** reproduce before you theorize — and treat an *inherited* diagnosis
  (an issue's trace, a prior session's sketch, a hand-off) as a hypothesis to
  falsify, never a fact to extend; the more authoritative it reads, the more it
  needs a from-scratch repro. Pin the one observable fact the bug produces,
  build a reproduction that exhibits it and is **red on current code** (an e2e
  test via `/test` when it can express the bug, else a scripted repro), then
  fix until it flips green. A repro that passes is a broken repro — fix the
  repro, never conclude "no bug". The fix makes the feature *work*, not
  disappear: disabling, defaulting off, or degrading a platform is a mitigation
  to reject, not a fix. **Venue:** building and running repros is heavy work —
  whenever `systemctl --user is-active kolu` is `active`, it runs on an
  ephemeral pu box, never locally; load `/dev-server` §0 first, and never
  `pkill -f` by substring (resolve PIDs by remembered port, or let the box go).
- **Feature:** write the covering test before or alongside the change.
- **Refactor/chore:** rely on existing coverage.

These branches key to the change in hand, not the phase you're in: a bug that
surfaces mid-gauntlet or from CI re-enters the Bug branch **from the top**, red
repro included, before any fix commit. A fresh diff is when a guess feels most
like knowledge.

**Sync the docs.** `.agency/do.md` → `## Documentation` is a principle, not a
checklist: **grep every doc surface for the term you touched** — `README.md`,
every `packages/*/README.md`, `website/` (hand-listed commands and roadmap
prose go stale), `docs/atlas/` — and for each hit either edit it or note why
it's still accurate. Skip only when genuinely doc-neutral.

**Sweep the callers the same way** when the change breaks an existing contract —
a renamed flag, a verb that used to be the default, a changed signature.
Discover them, don't recall them: grep the **whole repo** for every spelling the
thing is reached by, not the directories you expect hits in — `.nix`, `.sh`,
`justfile`, and test harnesses launch things too. The sweep is done when
re-running that grep shows only sites you changed, not when the list you
enumerated runs out.

**Changelog.** Any user-facing change appends one `<Change kind="…">` line to
`website/src/content/changelog/unreleased.mdx` under its product-area heading,
written as prose a user reads. PR link is backfilled in §3. The file is
`merge=union`, so appends never conflict.

Run **check** and **fmt**, commit (conventional message), push. Two traps a
green `just check` does not cover: **(a)** a changed bundler/server entrypoint
that imports a workspace package can typecheck yet fail the real build — run
`vite build` / `nix run .#<pkg>` on a pu box now, don't leave it for CI;
**(b)** any `package.json`/`pnpm-lock.yaml` change stales the `fetchPnpmDeps`
hash (kolu: `nix/workspace.nix`) and reds every linux nix lane — load
`/nix-typescript` and refresh the hash **in the background immediately** so it
rides this commit.

## 3. Open the PR

Before any review, so findings land on a real PR: load **`/forge-pr`** and
`gh pr create --draft` with a genuine title/body. Backfill the changelog
entry's `pr={<n>}` and push. If there's a plan note, finalize it via `/atlas`
(`status: implemented`, `<PrLink pr={<n>} />`) so it rides this PR.

## 4. Review gauntlet

With `--skip-gauntlet`: skip this section, note the skip in Done. Otherwise run
**`/be-review`** — it owns the serial order, tracks, and push-then-comment
discipline. Pass the interview's **`--agent`**, the `base`, a **`rationale`**
(so lenses don't flag deliberate decisions), and **`context`** (task intent and
key decisions, so reviewers inherit what you know).

**Non-negotiable.** Context or budget pressure never justifies skipping a
reviewer, trimming the set, or substituting a hand-rolled review — autonomy
means *don't ask permission per step*, not *decide which steps matter*. If a
mandatory step is genuinely infeasible, stop and ask the user then and there.
Adjudicate any unresolved lens finding yourself before moving on.

**Performance pass.** If the diff touches a perf-sensitive surface (SolidJS
reactivity, the surface wire, terminal/canvas rendering, timers/listeners, the
client bundle, kaval), review it against
`docs/atlas/src/content/atlas/performance.mdx` — don't regress a banked win or
add a catalogued anti-pattern; update the note via `/atlas` when the change
banks or surfaces one (measured, not guessed).

## 5. Ship — CI and evidence in parallel

Heavy work stays on pu boxes (see §2's venue rule). `/ci` and `/evidence` are
independent — run them **concurrently**.

**Sync master first:** `git fetch origin` and merge `origin/<default>` unless
it's already an ancestor — a long gauntlet leaves CI testing a stale base. A
real conflict is yours to resolve now. Don't merge while a gauntlet round is
still committing; let it settle first.

1. **`/ci`, backgrounded.** `.agency/do.md`'s CI section is the source of
   truth and supersedes anything here. Two-platform by construction; react to
   red nodes the instant they land; confirm the settled run carried both
   platforms before reporting green.
2. **`/evidence`, concurrently**, per `.agency/do.md` → `## PR evidence`. For
   bug fixes, demonstrate the fixed behavior even without a visual diff.
3. **Join before Done:** CI green on the final `HEAD` *and* evidence posted; if
   a late fix changed visible behavior, re-capture. Teardown of any daemon you
   spawned follows `/dev-server` §5 — kill the PID you captured at spawn, never
   `pgrep`/`pkill` by substring.

## Done

Report the PR URL, gauntlet outcome (fixes applied, adjudications, peer +
consensus, police findings — or that `--skip-gauntlet` skipped §4), and CI
status. **Never merge** — the human does.

Then close the loop: run **`/self-improve`** (forked), passing this run's
`$CLAUDE_CODE_SESSION_ID`. It ships any durable lesson as its own draft PR and
produces nothing on a clean run.

ARGUMENTS: $ARGUMENTS

---
name: codex-debate
description: 'Run an automated codex⇄Claude debate to consensus — no round cap, no deadlock exit. Two explicit subcommands. `review` (also the bare/back-compat default) — codex (reviewer) critiques the current diff and Claude (author) fixes/disputes, looping until they agree. `answer` — Claude and codex each answer a freeform prompt, then cross-check until they agree, and a unified answer is returned. The debate runs over a LIVE codex session in a split terminal beside you (driven with `kaval-tui`/`padi-tui`), not a headless workflow. Use when the user types `/codex-debate`, asks to "have codex review this", "run the codex debate", "review this PR with codex", "argue this with codex until you agree", or passes a question to "have Claude and codex debate/answer until they agree".'
argument-hint: "review [<pr-number>] [--base <branch>] [--no-commit] [--no-comment] [--rationale <note>] [--context <note>]  |  answer \"<prompt>\""
---

# Codex ⇄ Claude debate

This skill runs an automated debate between **codex** and **Claude** that loops to
consensus with no round cap and no deadlock exit. It has **two modes**, selected by
an **explicit leading subcommand** — never by guessing from the argument's shape:

- **`review`** — codex reviews the current diff, Claude (the author) fixes/disputes,
  round after round until they agree, and the trail is **committed + posted to the
  PR** (a mutating, outward-facing mode). This is everything from
  [Review mode](#review-mode) down.
- **`answer`** — Claude and codex **each answer a freeform prompt**, then
  **cross-check each other** until both agree, and a **unified answer** is returned
  to you (read-only; plus a saved transcript). See [Answer mode](#answer-mode).

The two modes have **different side-effect contracts** (review mutates + writes to
the PR; answer is read-only), so the mode is chosen **explicitly**, not inferred
from whether the argument looks like a PR number or like prose. Inferring a
mutating action from prose shape is exactly the coupling this design avoids.

## The engine — a live codex in a split terminal beside you

The debate does **not** run as a headless workflow. **You**, the agent running this
skill, drive it directly from your own turn: you spawn a **live codex session as a
split terminal next to yourself**, and you and that codex **take turns**, handing
off to each other until you agree. There is no `Workflow` tool, no `codex exec`, no
subagent — you *are* one debater, and the codex in the split *is* the other. This
means the skill runs under **any agent inside a kolu terminal** (it needs
`$KAVAL_TERMINAL_ID` and the `kaval-tui`/`padi-tui` CLIs); outside a kolu PTY it is
inert — say so and stop.

The whole loop is built on the **[/kolu skill](../kolu/SKILL.md)** — read it; it is
the engine you are adopting (spawn, the three-step send, the `kaval-tui wait`
done-signal, the large-paste file rule, teardown). What follows layers the debate
protocol on top of that drive loop.

### The core loop is a SYMMETRIC, event-driven handoff — to consensus

The two sides drive each other by **pinging**, not polling. **Every turn on either
side ends by pinging the other terminal, then ending its own turn.** The incoming
ping is what wakes you for your next turn — the exact reverse of the loop you use to
drive codex. There is **no polling loop in either direction.**

```
you  → prompt codex (write ask file, send short pointer, Enter) → END YOUR TURN
codex→ review, write verdict + section files, print on-screen marker → PING you → end its turn
you  → (woken by the ping) read verdict, fix/dispute, write section, commit → PING codex → END YOUR TURN
codex→ close out findings, rewrite verdict → PING you → end its turn
 …   repeat until consensus (codex's verdict is `approved: true`)
```

You end your turn after each hand-off and codex's ping wakes you; codex ends its
turn after each hand-off and your ping wakes it. **The loop terminates ONLY on
consensus** (the preserved contract: no round cap, no deadlock exit — see
[Runs to consensus](#runs-to-consensus)).

**The ping, both directions, is the three-step submit from /kolu** — text, observe
the settle, Enter — targeting the *other* terminal's id:

```sh
kaval-tui send "$OTHER_ID" --socket "$KAVAL_SOCKET" "VERDICT-WRITTEN <path>"
kaval-tui wait "$OTHER_ID" --socket "$KAVAL_SOCKET" --until idle:300 --timeout 4000 || true  # busy = ok, Enter still lands
kaval-tui send "$OTHER_ID" --socket "$KAVAL_SOCKET" --key Enter
```

You give codex **your** id (`$KAVAL_TERMINAL_ID`) and the socket in its prompt so it
can ping you back; you keep the split's id (recorded at spawn) to ping it. codex can
run these `kaval-tui` commands itself because it runs under `--yolo` (it has a
shell).

### The verdict is a FILE, announced by a ping — never scraped off the screen

A TUI **cannot** be forced to emit schema-valid JSON, and its rendered output is
lossy: the codex TUI **swallows the ```` ``` ```` fence markers and the code-block
language label** when it renders, and a long, many-finding verdict **wraps and
scrolls off the viewport** — so scraping a verdict off a snapshot silently truncates
the published record. Instead, **codex writes its verdict to a file** and only
*announces* it on screen. Every review round, codex does **all three, in order**:

1. **writes** `.codex-debate/verdict-NNN.json` (the full structured verdict — schema
   below) and `.codex-debate/section-NNN-1-codex.md` (its human-readable review);
2. **prints** a one-line on-screen marker `VERDICT-WRITTEN .codex-debate/verdict-NNN.json`;
3. **pings your terminal** with that same marker line (the three-step send above).

**Your primary done-signal is the incoming ping.** You end your turn; the ping wakes
you; you then **read the file** — byte-exact, complete, no truncation. Because codex
writes the file and prints the marker *before* it pings, **a flubbed ping can never
hang or corrupt the debate**: the file and the on-screen marker are the source of
truth, and the ping is only the low-latency waker.

**Fallback for a flubbed ping (bounded — never a hang).** If you are woken with no
fresh ping, or you want insurance before trusting the hand-off, run **one bounded**
observe + read on codex's terminal:

```sh
kaval-tui wait "$CODEX_ID" --socket "$KAVAL_SOCKET" --until match:'VERDICT-WRITTEN' --timeout 600000
kaval-tui snapshot "$CODEX_ID" --socket "$KAVAL_SOCKET" --viewport   # confirm the marker
```

A met wait (or the marker already on screen) → read the file. A timeout → codex is
still working or wedged: re-check, and if it produced nothing, **re-ask** (below).
This wait is bounded by `--timeout`, so the fallback path itself can never hang.

**Re-ask, never guess.** If `verdict-NNN.json` is missing, unreadable, or not
valid against the schema, do **not** infer a verdict — send codex a short prompt to
**rewrite just that file** and re-announce it, and wait for the fresh marker. Guessing
a verdict (e.g. assuming consensus) is banned; the debate only advances on a verdict
codex actually wrote.

### The codex verdict schema (what codex writes to `verdict-NNN.json`)

```json
{
  "approved": false,
  "summary": "one-paragraph assessment of the change as it stands this round",
  "findings": [
    { "id": "F1", "severity": "blocking|major|minor|nit",
      "location": "file:line", "issue": "what's wrong and why it matters",
      "suggestion": "concrete fix or direction", "status": "open|resolved" }
  ],
  "responseToRebuttal": "address each of the author's disputes individually; empty on round 1"
}
```

`approved` is `true` **only** when every finding is `resolved`, at every severity
(minor and nit included) — that is the consensus test. `id`s are **stable across
rounds** (`F1`, `F2`, …) so a finding tracks through the debate.

### Spawning and tearing down the split

Spawn codex as a split tile beside you, in the same worktree, and **record the id**:

```sh
CODEX_ID=$(padi-tui create --parent "$KAVAL_TERMINAL_ID" --json \
  -- codex --yolo --cd "$REPO" -c model_reasoning_effort="xhigh" | jq -r .id)
```

- `--yolo` runs codex unattended (no approval dialogs would wedge the driven loop)
  and gives it the shell it needs to write files and ping you. `-c
  model_reasoning_effort="xhigh"` is the review depth (surfaced in the comment
  header). `--cd "$REPO"` pins its working root to this worktree so `git diff <base>`
  sees the right tree.
- **`create` returning ≠ codex is ready.** Snapshot until its input box is drawn and
  the footer reads `YOLO mode`; clear any one-time onboarding/trust dialog with its
  own `send --key Enter` (per /kolu). Only then dispatch round 1.
- **Warm session is NATIVE.** The split is **one persistent codex session** — it
  carries its own prior review and reasoning across rounds by itself. There is no
  `codex exec resume` and no session-id file: round 1 sends the full cold review
  prompt; every later round sends a lean follow-up ("you still have your review in
  context — close out the findings"), and codex genuinely does.
- **Done-signal is raw quiescence.** codex is driven with `kaval-tui wait --until
  idle:<ms>` / `--until match:…` (raw output), **not** `padi-tui wait` agent-state —
  padi does not reliably track a codex session's agent state, so key on output bytes
  per /kolu.
- **Teardown kills only the split you spawned, by its recorded id:**

  ```sh
  kaval-tui kill "$CODEX_ID" --socket "$KAVAL_SOCKET"
  ```

  **Teardown law:** teardown kills only the exact id(s) recorded at spawn. **Pattern
  kills are banned** — `pkill -f`, `pgrep`, `ps | grep | kill`, and any
  marker/substring/socket-path matching are one banned class. If you notice a stray
  codex you did **not** spawn, **report it** (pid + args) — never hunt it.

### Delivering prompts to codex — file-pointer, always (fold-safe)

A multi-line prompt pasted into a TUI **does not reliably submit** (the /kolu
large-paste limitation: Claude Code / codex fold a paste past a handful of lines into
a placeholder, well under 1 KB). So **every** round's instructions go in a file and
you send codex a **short one-line pointer**:

```sh
kaval-tui send "$CODEX_ID" --socket "$KAVAL_SOCKET" "read .codex-debate/ask-NNN.md and carry it out"
kaval-tui wait "$CODEX_ID" --socket "$KAVAL_SOCKET" --until idle:300 --timeout 8000 || true
kaval-tui send "$CODEX_ID" --socket "$KAVAL_SOCKET" --key Enter
```

You never paste the diff or the rebuttal into the terminal: codex reads the tree
itself (`git diff`, `git status`) and reads the author's disposition file itself —
both named in `ask-NNN.md`.

## Mode detection (do this first)

Look at the **first whitespace-delimited token** of `$ARGUMENTS`:

- **`answer`** → **answer mode**. The prompt is everything after the `answer`
  token. Jump to [Answer mode](#answer-mode); the review-mode steps do not apply.
- **`review`** → **review mode**. The remaining args are the review grammar
  (`[<pr-number>] [--base …] [--no-commit] [--no-comment] [--rationale <note>]
  [--context <note>]`). Continue with [Review mode](#review-mode).
- **No args, OR the first token is a number (a PR number) or a `--flag`** →
  **review mode** (the backward-compatible bare alias for the original
  `/codex-debate [<pr>] [flags]`, so existing callers like `/be-review` keep
  working). Continue with [Review mode](#review-mode).
- **Anything else** (freeform prose with no recognized subcommand) → **ambiguous**.
  Do **not** guess — ask the user to pick an explicit mode and stop, e.g.: "Did you
  mean `/codex-debate answer \"<your prompt>\"` (read-only) or `/codex-debate review
  [<pr>] [flags]` (mutating)?" Only the safe, backward-compatible review grammar
  auto-routes; prose never silently triggers a mode.

Both modes require running **inside a kolu terminal** (they spawn and drive a split);
if `$KAVAL_TERMINAL_ID` is unset, the skill is inert — say so and stop.

<a id="review-mode"></a>
# Review mode — Codex ⇄ Claude review debate

Automate the back-and-forth you'd otherwise courier by hand: **codex** (the
reviewer) critiques the current change, **you** (the author) fix what you agree with
and dispute what you don't, codex re-reviews, and so on — round after round, **until
you reach consensus**. codex reviews from its **own warm session** (the persistent
split — it keeps its prior review in context natively), so when you dispute a
finding it argues from its original rationale rather than reconstructing it. There is
no round cap and no "deadlock" surrender: a debate that quits without agreement
defeats the purpose, so the two sides keep arguing until one concedes. You stay out
of your own way by committing each round as its own commit whose message carries the
debate context (codex's findings + your dispositions) so the PR history reads as the
debate, and the summary is **posted to the PR** as a comment at the end.

## Why this shape

The two sides are asymmetric only in *role*, not in *plumbing*:

- **codex** runs as a live TUI in the split, driven by `kaval-tui`; under `--yolo` it
  inspects the tree, writes its verdict to a file, and pings you.
- **You** are the author — you already have edit/commit tools in your own turn, so you
  fix and dispute directly. No subagent, no `agent()`, no headless `claude -p`.

The old engine (a `Workflow` script couriering schema-forced JSON between an
`agent()` Claude and a `codex exec` reviewer) is gone. **Honest change of promise:**
because a live TUI can't be schema-forced, consensus is no longer detected on
guaranteed-valid JSON — it is detected on the verdict **file codex writes**, which you
**parse and re-ask on if malformed** ([above](#the-verdict-is-a-file-announced-by-a-ping--never-scraped-off-the-screen)). And because codex now runs
`--yolo` (so the driven loop never wedges on an approval dialog), it is **no longer
kernel-sandboxed read-only** — its read-only behavior is now **instructed**, not
enforced. See [Safety](#safety--notes-review-mode) for what that costs and how to
harden if it matters.

## Arguments

A leading `review` subcommand token, if present, is consumed by mode detection;
what remains is `[<pr-number>] [--base <branch>] [--no-commit] [--no-comment]
[--rationale <note>] [--context <note>]` (the bare alias passes the whole argument
string through unchanged). Parse:

- **`<pr-number>`** (optional): a PR to debate. If given, `gh pr checkout <n>`
  first and default the base to that PR's base branch. If omitted, debate the
  **current branch's** working-tree diff.
- **`--base <branch>`**: ref to diff against. Always a **remote-tracking ref**, never
  a stale local branch. Default: `origin/<PR base>` when a PR number is given, else
  the repo default branch as `git symbolic-ref --short refs/remotes/origin/HEAD`
  (e.g. `origin/master`) — used **as-is**, NOT stripped to local `master` (which
  can lag the remote). Fallback `origin/master`. Step 1 runs `git fetch origin`
  first so the ref is current. You then resolve this to the **merge-base** of `base`
  and HEAD and diff against that, so commits `base` gained since the branch forked
  aren't reviewed as part of this change.
- **`--no-commit`**: don't commit per round — leave all agreed changes uncommitted in
  the working tree for the user to commit. Default is to **commit each round**.
- **`--no-comment`**: don't post the debate summary to the PR. By **default**, when a
  PR exists, the summary IS posted as a PR comment (step 4). Pass this to suppress the
  outward-facing write and report in chat only.
- **`--rationale <note>`** (optional): the author's note on **deliberate** design
  decisions. Threaded into **both** sides — codex's round-1 review prompt (so it
  doesn't flag intentional choices as defects; its warm session carries the note
  across later rounds) and your own reasoning **every round** (so you *dispute*,
  rather than "fix", a finding that contradicts a deliberate choice). Mirrors
  `/lens-debate`'s `rationale`. Pull it from the PR/issue description, or the caller
  (`/be-review`) passes the change rationale straight through.
- **`--context <note>`** (optional): the **main-agent context** — what this change is
  FOR (its task/intent and key decisions). You already hold it (you are the author),
  so use it to judge findings against the change's purpose. Given to **you only**, not
  codex — codex stays an independent reviewer of the code, not the author's narrative.

## Steps

### 1. Resolve context

- Determine `$REPO` (the worktree root, normally the cwd). Confirm `$KAVAL_TERMINAL_ID`
  is set (else the skill is inert — stop and say so).
- **`git fetch origin`** so remote-tracking refs are current — the base is an
  `origin/...` ref, and a stale one would diff against the wrong tree.
- Resolve `base` per the rules above (a remote-tracking ref like `origin/master`).
- If a PR number was given, `gh pr checkout <n>` and confirm the branch.
- **Merge-base guard.** Run `git merge-base <base> HEAD`. If it **fails**
  (missing/typoed/stale base, or unrelated history), the diff scope can't be trusted —
  **abort up front**, before spawning codex: tell the user which base failed and how
  to fix it (e.g. `git fetch`, fix a typo'd/stale ref) and stop. Do not review the
  base branch's drift as if this change made it.
- Confirm there is a non-empty diff: `git diff --stat <merge-base>`. If empty, tell
  the user there's nothing to review and stop.
- **Preflight codex**: `codex login status`. If not logged in, stop and tell the user
  to run `codex login` (suggest the `!` prefix to do it in-session).
- `mkdir -p "$REPO/.codex-debate"` (gitignored, per-worktree scratch — so parallel
  debates in different worktrees never collide and the scratch never shows up in the
  diff codex reviews).

### 2. Spawn the split codex

Spawn per [Spawning the split](#spawning-and-tearing-down-the-split) and record
`$CODEX_ID`. Snapshot until its input box is drawn and it reads `YOLO mode`; clear any
one-time dialog. Keep `$CODEX_ID` for the whole debate (and for teardown in step 4).

### 3. The debate loop (symmetric pings, to consensus)

Run the [core loop](#the-core-loop-is-a-symmetric-event-driven-handoff--to-consensus).
Concretely, per round `N`:

**Your hand-off to codex.** Write `.codex-debate/ask-NNN.md` with the round's
instructions, then send codex the short pointer + three-step submit, then **end your
turn**. The ask file instructs codex to:

- Inspect the change **read-only** (do not modify/create/delete anything; run no git
  write — add/commit/push/stash/checkout): `git diff <merge-base>` (committed +
  unstaged) and `git status --short` (untracked files — read those too). Ignore the
  `.codex-debate/` scratch dir if it appears.
- **Round 1 (cold):** give ALL feedback in this pass — every issue worth raising, at
  EVERY severity (blocking, major, minor, nit): correctness bugs, logic errors,
  silently swallowed errors, unjustified fallbacks, security problems, clear
  simplicity/efficiency issues. Cite `file:line`. Approving with no findings is fine
  if the change is genuinely clean, but never stay quiet about a real issue to seem
  agreeable. If `--rationale` was given, include it: "the author flagged these as
  DELIBERATE decisions — do NOT raise them unless the reasoning itself is wrong."
- **Round N>1 (follow-up):** you still have your prior review in context. Read the
  author's dispositions at `.codex-debate/section-NNN₋₁-2-claude.md` and re-inspect
  the current tree. **Close out the findings already on the table** — do NOT re-scan
  the diff for new pre-existing issues you didn't raise before (that prevents
  convergence). For each existing finding (reuse its stable id): verify the fix and
  mark it `resolved`, or address the dispute — concede (mark `resolved`) or hold firm
  with specific technical reasoning in `responseToRebuttal`. Raise a NEW finding ONLY
  if this round's changes introduced it (a regression).
- **Write, mark, ping (all three):** write `.codex-debate/verdict-NNN.json` (the
  schema above) and `.codex-debate/section-NNN-1-codex.md` (a readable render of the
  same verdict — summary, then each finding's id/severity/location/issue/suggestion/
  status, then `responseToRebuttal`); print `VERDICT-WRITTEN
  .codex-debate/verdict-NNN.json`; then **ping your terminal** (`$KAVAL_TERMINAL_ID`,
  socket `$KAVAL_SOCKET` — both given in the ask file) with that marker line via the
  three-step send.

**codex's hand-off back** wakes you. Read `.codex-debate/verdict-NNN.json` (re-ask on
missing/malformed; fallback to the bounded wait+snapshot if the ping never came).
Then, as the author:

- For each **open** finding: **fix** it (edit the tree) if you agree, or **dispute**
  it with specific reasoning if you don't. Weigh findings against `--context`/
  `--rationale` — dispute, don't dutifully "fix", a finding that contradicts a
  deliberate choice.
- **Resolved-and-deferred carve-out (NOT a deadlock exit).** A finding that is *not a
  code edit for this worktree* but a downstream / ship-phase / process gate (a
  companion repo pinning this repo's final post-review HEAD, a CI/release step, a
  cross-repo PR) cannot be satisfied mid-review. When you show codex a finding is such
  a gate, ask it to mark the finding **resolved** — acknowledged and deferred to the
  ship phase — instead of holding it open forever. This is narrow: a genuine code
  defect you simply dislike is still argued to consensus, no exit.
- **Write your disposition file** `.codex-debate/section-NNN-2-claude.md`: one entry
  per finding with its stable id and a clear **fixed / disputed / partial** marker and
  reasoning. This file does triple duty — it's your cross-round memory, the **rebuttal
  codex reads next round**, and part of the **published comment** (step 4). Leave no
  finding without an entry.
- **Commit the round** (unless `--no-commit`): stage exactly this round's changed
  files and commit with a message embedding the round's codex findings and your
  dispositions (conventional-commit style). One commit per round; never push or merge.
- **Consensus test:** if codex's latest verdict is `approved: true` (every finding
  `resolved`), the debate has **converged** — go to step 4. Otherwise write
  `ask-(N+1).md`, **ping codex**, and **end your turn**.

Repeat until consensus. **No round cap, no deadlock exit** — see
[Runs to consensus](#runs-to-consensus).

**Reviewer-error (the one abnormal terminus).** If codex cannot produce a readable,
schema-valid verdict even after you re-ask (its session is broken/unavailable/wedged),
do **not** treat it as consensus. Tear down the split, report it as an
**infrastructure failure** (surface what you saw on codex's terminal), tell the user
to fix codex (e.g. `codex login`, check the CLI) and re-run, and stop. There is no
agreement to report.

### 4. Present the result & post the comment

Tear down the split (`kaval-tui kill "$CODEX_ID" --socket "$KAVAL_SOCKET"`). Then,
**on consensus** (do **not** push or merge — the per-round commits sit on the local
branch for the human):

- The outcome — **consensus** — and how many rounds it took.
- **The reviewer's reasoning effort** — `xhigh` (the `-c model_reasoning_effort` you
  launched codex with). State it so the depth of the review is on the record, and put
  it in the comment header.
- `git log --oneline <merge-base>..HEAD` (the per-round debate commits) and
  `git diff --stat <merge-base>` so the user sees what the debate changed.
- A compact per-round summary — read it straight from the section files
  (`cat .codex-debate/section-*.md`: each round's codex verdict, then your
  dispositions and commit SHA).
- The agreed changes are committed per round on the local branch (or, under
  `--no-commit`, uncommitted in the working tree). The user reviews, then pushes /
  merges (or runs `/do --from post-implement`) when satisfied.
- **Post the debate summary to the PR (default).** When a PR exists and `--no-comment`
  was NOT passed, **assemble** the comment deterministically — a small header, then
  the per-round section files `cat`-ed in glob order — and post it:

  ```sh
  workDir="$REPO/.codex-debate"
  {
    printf '## Codex ⇄ Claude debate\n\n'
    printf '✅ Consensus in %s round(s) · reviewer effort: xhigh · base: %s\n' "$ROUNDS" "$BASE"
    for f in "$workDir"/section-*.md; do printf '\n'; cat "$f"; printf '\n'; done
  } > "$workDir/comment.md"
  gh pr comment <pr> -F "$workDir/comment.md"
  ```

  The section files zero-pad `NNN` so the `section-*.md` glob sorts chronologically;
  the `for`-loop guarantees a blank line between sections regardless of trailing
  newlines. The comment is a **deterministic** `cat` of the **same** section files you
  read as memory and codex read as the rebuttal — never an LLM-improvised table,
  nothing weak retyping a large blob. This is an outward-facing write, on by default
  because the whole point is to leave the review trail on the PR; `--no-comment`
  suppresses it.

## Safety & notes (review mode)

- **codex is instructed read-only — NOT kernel-enforced (a downgrade, stated
  plainly).** The old engine ran codex under `--sandbox read-only`, so the kernel
  blocked writes even if a prompt-injected diff tried to make it write. The live TUI
  runs under **`--yolo`** (so the driven loop never wedges on an approval dialog),
  which means codex is **no longer sandboxed** — its read-only behavior now rests on
  the instruction in `ask-NNN.md`, not a kernel guard. codex reviews arbitrary diffs
  and *could* in principle be prompt-injected into a write. The only intended writes to
  the tree are your author edits. **If hard read-only matters for a given change, run
  the debate in a disposable worktree.** Treat codex's read-only as **best-effort, not
  enforced.**
- **Warm reviewer session — native, no resume.** The split is one persistent codex
  session; it retains its own prior review across rounds with no `codex exec resume`
  and no session-id file. Round 1 is the full review; later rounds are lean follow-ups
  it answers from its own context.
- **Warm author (context, not session).** You are the author across all rounds in one
  continuous turn-driven presence, so you keep your own memory. On top of that, each
  round you read your prior `section-*.md` files (your dispositions and codex's
  findings), and when the caller passes `--context`/`--rationale` you reason from the
  change's purpose and deliberate decisions in **every** round — so you dispute a
  finding that contradicts a deliberate choice instead of dutifully "fixing" it.
- **Files are the payload; the screen carries only signals.** Verdicts, sections,
  rebuttals, and prompts all move as **files** (`.codex-debate/`); the terminal
  carries only short **signals** — the one-line `VERDICT-WRITTEN` marker and the ping.
  This is the /kolu large-paste rule applied in both directions, and it makes silent
  truncation of the published record **inexpressible**: nothing a debater relies on is
  ever scraped off a lossy, scrolling screen.
- **Commits, but never pushes or merges.** Each round is committed locally (unless
  `--no-commit`) so the PR history reads as the debate, but the skill never pushes or
  merges. Consensus means "both AIs agree on the committed code," not "ship it."
- **Parallel-safe.** All scratch lives under the gitignored, per-worktree
  `$REPO/.codex-debate/`, so debates on many worktrees run at once without clobbering
  each other — no shared `/tmp` paths.
- **Posts to the PR by default** (unless `--no-comment`) — the point is to leave the
  review trail on the PR.
- <a id="runs-to-consensus"></a>**Runs to consensus — no cap, no deadlock exit.** The
  loop ends only when codex's verdict is `approved: true`; it does not bail at a round
  cap or declare a "deadlock," because a debate that quits without agreement is
  pointless. The two sides keep arguing until one concedes. The **one carve-out is
  *not* a deadlock exit:** the [resolved-and-deferred](#3-the-debate-loop-symmetric-pings-to-consensus)
  handling of a genuine downstream / ship-phase / process gate (which no mid-review
  edit can satisfy) — a genuine code defect you simply dislike is still argued to
  consensus. (This is the loop that once spun until a human killed it on a
  `@kolu/surface` cross-repo run.) If you ever need to stop a debate by hand, interrupt
  the turn and `kaval-tui kill "$CODEX_ID"`.

<a id="answer-mode"></a>
# Answer mode — Codex ⇄ Claude answer debate

When the subcommand is `answer`, the skill generalizes the same live-terminal debate
from *reviewing a diff* to *answering a question*. The shape is **symmetric**, not
author⇄reviewer: **you and codex are two equal peers**. You each answer the prompt
**independently**, then **cross-check each other's answer** round after round —
conceding where the other is right, holding firm (with evidence) where it isn't —
**until both agree**. A final pass **synthesizes the two converged answers into one
unified reply**, which you present to the user along with a saved transcript.

Both peers are **codebase-aware but read-only**: each may read this repo (`git
diff/log`, read files, grep) to ground its answer, but neither edits anything. This
mode makes **no** commits and **no** PR writes. The same symmetric ping loop and the
same file-transport apply — answers move as files, the terminal carries only the ping.

## Steps

### A1. Resolve context

- Determine `$REPO` (the worktree root). Confirm `$KAVAL_TERMINAL_ID` is set (else
  inert — stop and say so). `mkdir -p "$REPO/.codex-debate"`.
- Capture the **prompt**: everything **after the `answer` subcommand token** (strip
  surrounding quotes). If empty, ask the user what they want answered and stop.
- **Preflight codex**: `codex login status`. If not logged in, stop and tell the user
  to run `codex login`.
- No `git fetch` / base resolution / `gh pr checkout` — answer mode doesn't diff a
  branch.

### A2. Spawn the split codex and run the cross-check loop

Spawn the split ([Spawning](#spawning-and-tearing-down-the-split)) and record
`$CODEX_ID`. Because answer mode never needs codex to write the tree, its read-only
behavior is **instructed** (the same `--yolo` engine; not kernel-enforced — see
[safety](#answer-mode-safety--notes)); the ask file tells codex it may read the repo
but must not modify it.

- **Round 1 — independent answers.** You write your own answer to
  `.codex-debate/answer-claude-1.md` (grounded in the repo where relevant). In
  parallel, hand codex `ask-answer-1.md`: answer the prompt independently, ground it
  in the repo, write `.codex-debate/answer-codex-1.md` **and** the machine record
  `.codex-debate/answer-verdict-1.json` (schema below), print the `VERDICT-WRITTEN`
  marker, and ping you. Neither peer has seen the other's answer yet.
- **Rounds 2+ — cross-check.** Each peer reads the other's latest answer file and
  either concedes (revises its own answer, recording what changed) or objects (holds
  firm with specific reasons — cite `file:line` when the prompt is about this repo).
  You write your updated `answer-claude-N.md`; codex writes `answer-codex-N.md` +
  `answer-verdict-N.json` + pings. Same symmetric ping loop, to agreement.
- **Convergence is candidate-confirmed, not just two agreeing booleans.** Because the
  two answers evolve independently, a round where both report "I agree with the other"
  can still be a **swap false positive** (each adopted the other's prior answer; both
  say "agree" but their current texts differ). The sound test is to make both judge
  **one shared text**. So when a round shows mutual agreement (both verdicts
  `agreesWithOther: true` with no open objection), **you synthesize a single candidate
  answer** from the two, write it to `.codex-debate/candidate.md`, and run a
  **confirmation round**: both peers review that *identical* candidate (without
  rewriting their own answer) and either approve it or object. If **both approve**,
  that candidate is the converged answer. If either objects, drop the candidate and
  resume the cross-check loop with the objection folded in. **No round cap, no deadlock
  exit.**

Answer-verdict schema (`answer-verdict-N.json`):

```json
{
  "answer": "codex's complete, self-contained answer this round (revised on cross-check rounds)",
  "keyPoints": ["core claims the answer rests on — what the other side must agree with"],
  "agreesWithOther": false,
  "objections": [ { "point": "the specific claim/gap you disagree with", "reason": "why — cite file:line for repo prompts" } ],
  "changedMind": "what you revised this round because the other convinced you; empty on round 1 or if nothing changed"
}
```

`agreesWithOther` counts as agreement **only** when it is `true` AND `objections` is
empty — a stray objection can't be papered over by an over-eager boolean.

### A3. Present the result

Tear down the split (`kaval-tui kill "$CODEX_ID" --socket "$KAVAL_SOCKET"`). Then:

- **On consensus** (both approved the candidate): present the **candidate** as the
  unified answer — already signed off by both debaters. State **how many rounds** it
  took and that **codex answered at `xhigh`**. Save the full transcript to
  `.codex-debate/answer-<slug>.md` (the round-by-round answers, cross-checks, and the
  confirmed candidate) and point the user at it. This mode makes **no** outward-facing
  writes — no PR comment, no commits.
- **On failure** (codex couldn't produce a readable/valid verdict after re-asks, or
  synthesis/confirmation never converged): report it as a **failure**, not an answer —
  surface what broke and how to fix it (e.g. `codex login`), and re-run. Do **not**
  present a half-debate as an agreed answer.

## Answer-mode safety & notes

- **Both peers read-only — instructed, not enforced.** Under the `--yolo` engine
  neither peer is kernel-sandboxed; both rest on instruction. (The old engine
  kernel-enforced read-only for codex specifically — that asymmetric hard guarantee is
  **gone** under the TUI engine; this is the same honest downgrade as review mode.) A
  prompt-injected or mistaken peer *could* in principle write. If that risk matters for
  a given prompt, run the debate in a disposable/read-only worktree.
- **Warm codex session — native.** The split keeps codex's own prior answer across
  rounds; no `codex exec resume`.
- **Files are the payload; the screen carries only the ping.** Answers, verdicts, the
  candidate, and the transcript are all files under `.codex-debate/`; the terminal
  carries only the `VERDICT-WRITTEN` marker and the ping — same as review mode.
- **Chat + saved transcript, no outward writes.** The unified answer is presented in
  chat and the transcript saved to the gitignored `.codex-debate/answer-<slug>.md`.
  Unlike review mode, answer mode never commits or posts to a PR.

## Files

There are **no** workflow or `codex exec` scripts — the engine is this prose plus the
`kaval-tui`/`padi-tui` CLIs and the [/kolu skill](../kolu/SKILL.md). All debate state
is ephemeral, under the gitignored per-worktree `$REPO/.codex-debate/`:

- `ask-NNN.md` / `ask-answer-N.md` — the round's instructions you write and point
  codex at (fold-safe file-pointer prompts).
- `verdict-NNN.json` / `answer-verdict-N.json` — codex's structured verdict/answer
  (the machine record you parse; re-ask on malformed).
- `section-NNN-1-codex.md` — codex's readable review render (part of the PR comment).
- `section-NNN-2-claude.md` — your per-finding dispositions (your memory, codex's
  rebuttal, part of the PR comment).
- `answer-claude-N.md` / `answer-codex-N.md` / `candidate.md` / `answer-<slug>.md` —
  answer-mode answers, the confirmed candidate, and the saved transcript.

This skill is generated from `agents/.apm/skills/codex-debate/`; edit the source there
and keep the generated `.claude/skills/` and `.agents/skills/` copies identical in the
same commit (see `.claude/rules/apm-workflow.md`).

ARGUMENTS: $ARGUMENTS

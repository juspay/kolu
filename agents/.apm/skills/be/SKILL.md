---
name: be
description: Modern, interactive alternative to `/do` — clarify intent up front, then take a task end-to-end with a serial AI review gauntlet (lens debate (lowy ⇄ hickey) → agent debate → simplify → code-police, each editing the branch in turn) → CI → evidence. ONLY invoke when the user explicitly types `/be` or `$be`; never auto-select from a natural-language request.
argument-hint: "[--skip-gauntlet] <issue-url | prompt>"
---

# Be

Take a task to a shipped, reviewed PR. Unlike `/do` (autonomous start to finish), `/be` **opens with a short interview** — and is then **fully autonomous**, exactly like `/do`, from §1 onward. The interview is the *only* place `/be` asks the user anything; after it, make sensible defaults and keep moving — no further `AskUserQuestion`, no stopping between steps. The single exception is the optional plan-review pause in §1, and only when "plan first" was chosen. Concise by design — defer mechanics to the skills it calls.

**Autonomy doesn't inherit — propagate it to every subagent you delegate to.** When you hand work to a fresh subagent (a §2 package build, a §5 "finish the ship" CI+gate+cleanup pass), its prompt must say *execute now; do not wait for confirmation, do not ask me to "say go"* — a subagent starts without your interview's "no stopping between steps" contract, so a prompt that merely lays out a plan gets a plan **back** (zero tool uses) instead of done work, and you're the one who has to type "go." Bake the directive into the delegation, and if a subagent still returns a plan-and-waits with no tool uses, resume it with "execute now" rather than surfacing the stall to the user.

Requires a runtime that can invoke the named skills and the Workflow-backed
lens review.

## Arguments

Parse `$ARGUMENTS` for flags first; the remainder is the issue URL or task prompt.

| Flag | Effect |
| --- | --- |
| `--skip-gauntlet` | Skip §4 entirely — do **not** run `/be-review`. Proceed from the draft PR straight to §5 (CI + evidence). |

The flag is an **explicit human opt-out**, not something `/be` may invent mid-run. Without it, §4 remains mandatory.

Examples: `/be --skip-gauntlet fix the toast race`, `/be --skip-gauntlet https://github.com/…/issues/123`.

## 0. Interview (the differentiator)

Before any work, ask the user via **`AskUserQuestion`** (one call, batched) — **unless a delegating brief routes questions elsewhere.** When you run under a coordinator whose brief says questions go to its terminal (e.g. via `/kolu`, blocking on the reply), that channel *replaces* `AskUserQuestion` for the **whole run — not just this interview**: write the batch to a file, send a one-line pointer, and block — never open a question dialog in your own PTY, where it hangs unseen until a human happens to look. The brief's route wins even when it only *routes* without naming the tool: reaching for `AskUserQuestion` here is `/be`'s built-in reflex, so treat "a coordinator is driving me" as itself the ban. **The ban does not lapse when §0 ends.** Any question the run surfaces *later* — a falsified brief premise, a scope fork the brief didn't settle, a design decision that needs the coordinator's call — routes the **same** way: file + one-line pointer + block on the coordinator, **never** `AskUserQuestion` and **never** a message to the human. A mid-run scope question is not a "sensible default" you may skip the coordinator on; it is exactly what the coordinator channel is for.

- **Plan first?** — write the plan as an **Atlas note** (`docs/atlas/src/content/atlas/<slug>.mdx`) for review *before* implementing, or implement straight. Default: straight, unless the task is large/ambiguous. *(If the prompt already points at an existing Atlas note or legacy `docs/plans/*.html`, skip this question — that file is the plan of record; reuse it.)*
- **Task kind** — bug fix · feature/new behavior · refactor/chore. This sets the test strategy (see §2).
- **Debate peer** — when the gauntlet is enabled, choose `claude`, `codex`, or
  `grok` for `/agent-debate`. There is no default: honor a peer already named in
  the prompt; otherwise ask here and carry the answer through §4.

Add a question only when something material is genuinely unclear — don't pad. Honor anything the user already pinned in the prompt instead of re-asking. **This single `AskUserQuestion` call is your one and only chance to ask** — surface every clarification you need now, because everything after this is autonomous.

## 1. Set up

- `git fetch origin`; branch off `origin/<default>` (`git symbolic-ref --short refs/remotes/origin/HEAD`). Feature branches only — never commit to master.
- Read `.agency/do.md` for the project's **check / fmt / test / ci** commands and its **`## PR evidence`** section. Reuse them throughout.
- **If "plan first" (or working off an existing plan):** the plan of record is an **Atlas note** (`docs/atlas/src/content/atlas/<slug>.mdx`). **Load `/atlas` (Skill tool)** for the note mechanics — frontmatter, the component kit, `just atlas::build` + staging `dist/`, and the Code-tab + htmlpreview share links. Set `kind:` to match the §0 task (`bug`/`feature`; else `analysis`/`reference`) and `status: proposed`. The plan itself must: **(a)** stay **high-level** — user- and architecture-focused (what changes + the *shape*: seam, data flow, trade-offs and alternatives), with **no implementation dump** (no line-level code, file-by-file lists, or signatures; the *how* is §2's job); **(b)** carry a **UI prototype** (`<AtlasMockup>` or inline JSX) if the change has any on-screen surface, so the user judges look-and-feel before code; **(c)** **ground every load-bearing low-level fact against the installed code before asserting it** — staying high-level (a) does not license *guessing*. A pinned **dependency version** (read the lockfile, not the `^range`), a third-party library's **emitted markup / attribute / API shape**, a **test-environment strategy** (a unit env or a needed dep), a **framework runtime behavior** (e.g. *does a coarse SolidJS store reader coalesce same-shape deltas, or does Solid flush every write?* — a load-bearing reactivity/coalescing fact you **reproduce empirically against the installed source**, never deduce from first principles) — each is a fact the *how* in §2 will be built on, so verify the few the plan leans on the same way §2 gets ground truth (read the lockfile / the package's `vitest.config.ts` / the actual emitted DOM / a throwaway repro of the reactive path), don't recall it from training. A plan that asserts `marked-footnote@1.2.4 emits class="footnote-ref", test it under happy-dom` when the lockfile says `1.4.0`, the marker is a bare `data-footnote-ref`, and the package keeps a deliberate node-only env with no happy-dom is *wrong*, not merely detailed — it forces an implementation-time reconciliation and ships a false published note. **Self-check before presenting** — rework until all hold; don't make the user be the linter: high-level ✓, prototype-if-visual ✓, facts-grounded ✓, renders clean ✓. Then **push the branch** and **hand it over** for review via the Code tab *and* the htmlpreview link — do *not* use plan mode; wait for the user's reply, incorporate feedback (rebuild + push each round), and resume only on their go. This is the one sanctioned pause. **The plan ships in the PR.** *(A legacy `docs/plans/*.html` plan stays HTML — edit it in place.)*

## 2. Implement

**Honor the design philosophy first.** Before writing code, re-read `.claude/rules/conventions.md` → **Design philosophy** (fail-fast / no-fallbacks · electricity boundaries · reuse the existing source of truth) and state in the plan or PR body how this change honors each. A fallback path, a new override knob, a domain-agnostic helper folded into an app module, or a hand-rolled mechanism that duplicates an existing one (`.gitignore`, an extension/MIME table, a library) is a defect to fix now — not a follow-up the review gauntlet should have to catch.

- **Bug:** reproduce *before* you theorize or fix — start from facts, not a story about the bug — **and an *inherited* diagnosis is the most seductive story of all**: an issue's "conviction trace", a prior session's already-sketched fix, a PR's known-issue note, a hand-off that says "READ IT FIRST". The more forensic and authoritative it reads, the harder it must be reproduced *from scratch before any fix code* — treat every inherited root-cause claim as a hypothesis to falsify, never a fact to extend (a detailed frame-trace once talked a run into writing ~400 lines of client-side fix against a mechanism the box repro then disproved: the trace came from a deleted session instrumenting a *replica*, not the real browser). **Where it runs: pu box, not locally** — building, running the repro (`just test-quick`/`just dev-auto`/a scripted repro), and any "let me SEE it" check are **heavy work**, and reproduction is the §5 venue gate fired early. Whenever `systemctl --user is-active kolu` is `active` (the normal case) that work belongs on an ephemeral pu box, never on the user's machine: a pile-up of local builds + e2e runs OOM-killed production `kolu.service` once, and a broad `pkill -f <substring>` to clean up OOM'd processes killed it again — its nix-store process matched the substring. **Load `/dev-server` §0 before launching/building/repro-ing anything**, and never `pkill -f` by any command substring — resolve PIDs by remembered port, or just let the pu box go. **(1)** Get ground truth from the running system; observe the real symptom, don't trust a description of it. **(2)** Pin the one hard, observable fact the bug produces — a wrong value, an error, a state that can't legally happen (e.g. "the client SHA stays `7deb397` across reloads"). **(3)** Build a reproduction that exhibits *that exact fact* and is **red on the current code** — a **failing e2e test** via the `/test` harness when it can express the bug, otherwise a scripted repro. A repro that *passes / converges / "works"* is **not** a reproduction: if it doesn't show the symptom the **repro** is wrong — fix the repro, never conclude "no bug" from it. **(4)** Only now fix, until that same repro flips green. No fix without a reproduction that was first red for the real reason. The fix must make the feature *work*, not disappear: disabling it, defaulting it off, or routing the affected platform onto a degraded path is the no-fallbacks violation from §2's design-philosophy clause wearing a bug-fix hat — a *mitigation*, not a fix, and a defect to reject now, never to ship or post as "verified." If the only remedy you can find removes or degrades the behavior, you haven't understood the bug yet — keep digging (fork the upstream dependency if that's what a real fix needs) before you settle.
- **Feature / new behavior:** write the covering test (e2e/integration/unit as fits) before or alongside the change.
- **Refactor/chore:** no test-first requirement; rely on existing coverage.

**Sync the docs.** Read `.agency/do.md` for its **`## Documentation`** section — a *principle* (discover the stale docs, don't recall a checklist), **not** a fixed file list. Updating the README + Atlas and stopping there is the exact pattern-match-a-couple-and-skip-the-rest trap it warns against. So **grep every doc surface for the term you touched** — the command, flag, type, or word — across `README.md`, every `packages/*/README.md`, **`website/`** (the kolu.dev marketing pages, e.g. `src/pages/*.astro`, which hand-list commands and carry "next up is X" prose that goes false), and `docs/atlas/`. For **each** hit, either edit it or record why it's still accurate — "I updated the README" is not a doc-sync until the changed package's README and every user-facing marketing surface were each *grepped and resolved*. The docs commit rides the same review gauntlet as the code. Skip only when the change is genuinely doc-neutral.

**Add a changelog entry.** For any **user-facing** change, append one line to `website/src/content/changelog/unreleased.mdx` under the matching product-area `###` heading, whose label links to the same docs page this change updates; create the heading if it is absent. Put the editorial type on the entry itself: `<Change kind="added" …>`, `changed`, `fixed`, or `heads-up` (the disruptive/migration type). Write it as prose a *user* reads, not a commit subject — no PR link yet (the PR doesn't exist until §3; you backfill the link there). Skip only when the change has no user-visible effect (pure refactor/chore/internal). The file is `merge=union`, so a plain append (or a new heading) never conflicts.

Run **check** and **fmt**, then commit (conventional message) and push the feature branch. **`just check` (tsc + biome) green is not proof the shipped artifact *builds*** — when the change adds or edits a bundler/server entrypoint (a `vite.config.ts`, a `nix run` server wrapper, any module the real build loads) that **imports a workspace package**, tsc resolves extensionless imports that native ESM / the bundler will *reject*, so a clean typecheck can sit on top of a `vite build` / `nix run .#<pkg>` that doesn't build at all. For that kind of change the §5 venue gate fires early: actually run the real build on a pu box (`nix run .#<pkg>` / `vite build`), don't infer it from the typecheck. Leaving it for CI/evidence to surface is how a non-building entrypoint reaches the gauntlet. **The same is true of a dependency change**: the moment the change touches `package.json` / `pnpm-lock.yaml` (a `pnpm add`/`remove`/`update`), the recorded `fetchPnpmDeps` FOD hash in `nix/modules/typescript.nix` goes stale and **every** linux nix-build CI lane (`ci::pnpm-hash-fresh`, `ci::nix`, `ci::smoke`, …) reds at once — a guaranteed wasted CI cycle if it's left for §5 to surface. **Load `/nix-typescript` (Skill tool) and refresh the hash the instant the lockfile changes**, in the **background** (`nix build` takes minutes — kick it off and keep coding, per that skill), so the corrected hash rides this same commit. `just check` never catches this; only a real `nix build` does.

## 3. Open the PR

**Before any review** — so every reviewer's findings land as comments on a real PR. Load **`/forge-pr`** (Skill tool) and `gh pr create --draft` with a genuine title/body covering the scope so far. The PR exists for the rest of the run; later steps push commits and post comments to it.

**Backfill the changelog PR link.** If §2 added a changelog entry, fill in its PR now that the number exists — set the **`pr={<n>}`** prop on the entry's `<Change kind="…" title="…" pr={<n>}>…</Change>` (auto-injected into changelog MDX, so no import; it renders the GitHub-style PR chip). Then commit and push so the link rides this PR. Skip if §2 added no entry.

**If there's a plan of record, finalize it now.** Once the PR URL exists, **finalize the Atlas note via `/atlas`**: set `status: implemented`, link the PR with `<PrLink pr={<n>} />`, rebuild + stage `dist/`, commit (`docs(atlas): link PR #<n>`) and push so it's part of this PR. *(A legacy `docs/plans/*.html` plan stays HTML — edit its status/PR link in place.)*

## 4. Review gauntlet

**If `$ARGUMENTS` contains `--skip-gauntlet`:** skip this entire section — do
**not** run `/be-review`, do not run individual reviewers, do not post gauntlet
PR comments. Note the skip in the Done report. Continue to §5.

Otherwise run **`/be-review`** (Skill tool) — it runs four reviewers **serially**,
each the sole editor while it runs: `/lens-debate` applying the agreed fixes, then
`/agent-debate` (its per-round commits are the debate), then `/simplify`, then
code-police. Each step reads a clean tree (the previous step has committed) and
applies its own fixes directly — no snapshot, no apply pass. be-review pushes once
at the end and *then* posts the PR comments (lens, agent-debate, and a code-police
summary), so no comment advertises a local-only commit.

**Unless `--skip-gauntlet` was passed, this phase is non-negotiable.** The
Workflow-backed lens step runs off-context and notifies you when it settles;
`/agent-debate` runs inline against a live split peer, while later passes follow
their own skill contracts. Context or budget concern is **never** grounds to
skip a reviewer, run fewer than all four, or
substitute a hand-rolled review for the real gauntlet — that excuse doesn't
survive ten seconds of scrutiny, and dropping a step you were told to run is the
single worst gauntlet failure. `/be`'s autonomy means *don't ask permission for
each step*, NOT *decide which steps matter*. The only sanctioned skip is the
explicit `--skip-gauntlet` flag above. If a mandatory step is genuinely
infeasible, **STOP and ask the user** at that moment — never silently substitute
and disclose it later in the wrap-up.

- Pass the interview's explicit **`--agent`** selection, `base`, the change **`rationale`** (so the lenses don't flag deliberate
  decisions), and **`context`** — the task intent and key decisions you hold from
  this run, so the author **inherits what you know instead of re-deriving it
  from the diff**. Preflight is a non-empty diff plus the selected peer's auth check.
- Lens-debate commits its agreed fixes; agent-debate's author rounds commit `fix(…)`; simplify
  and code-police commit `refactor:` / `fix(police):`. Confirm the post-push PR
  comments landed: lens, agent-debate, and — when the police track ran — the code-police
  summary.
- On an **unresolved** lens finding, adjudicate it yourself before moving on.

**Performance pass.** If the diff touches a perf-sensitive surface (SolidJS
reactivity, the surface wire, the terminal/canvas render loop, timers/listeners,
the client bundle, or kaval), review it against the performance map —
`docs/atlas/src/content/atlas/performance.mdx`
([published](https://kolu.dev/atlas/performance.html)): don't regress a *banked*
win, and don't add a catalogued anti-pattern (an unstable memo reference or
coarse reactive dep, a visibility-blind timer, a full-set wire broadcast, an
eager heavy import). When the change **banks** an opportunity or **surfaces** a
new one, update that note via `/atlas` so the map stays current — measured, not
guessed (a faithfully-reproduced negative counts too).

## 5. Ship — CI and evidence in parallel

**Heavy work runs on a pu box, never locally — production kolu lives on this
machine.** Builds, the dev server, and evidence capture all go on an ephemeral pu
box whenever `systemctl --user is-active kolu` is `active` (the normal case). A
prior run piled local `just dev-auto` + nix builds beside a live production kolu
and the **OOM-killer `SIGKILL`ed production**; random ports dodged its *ports* but
not its *RAM*. Load **`/dev-server`** §0 for the local-vs-pu venue gate before
launching the app for *any* reason — including an interactive "let me SEE it"
check during §2. `/ci` and `/evidence` already run on pu; keep it that way.

`/ci` and `/evidence` are independent — one exercises the build/test pipeline, the
other captures on-screen behavior — so **run them concurrently**; don't wait for
green before capturing.

**First, sync master — don't make the user ask.** The branch was cut from
`origin/master` back in §2, and a long gauntlet lets master move on, so a naive CI
run tests a **stale base** and the PR's merge-base drifts — this is the single most
repeated human interjection into an otherwise-autonomous run ("merge latest master
before CI"). Pre-empt it: **before** kicking off `/ci`, `git fetch origin` and merge
`origin/<default>` into the branch so CI and the final `HEAD` sit on current master
(the changelog is `merge=union` so it never conflicts; a *real* conflict is yours to
resolve now, never to defer or paper over). **One ordering caveat** — never `git
merge` while a background gauntlet step (an agent-debate/lens round) is still committing
per-round: it races the git index. If one is in flight, wait for it to settle, *then*
merge, *then* start CI. Grep-check master isn't already an ancestor first — skip the
merge only when `git merge-base --is-ancestor origin/<default> HEAD` is already true.

1. **Kick off `/ci` first, backgrounded** — start the pipeline so it churns while
   you capture evidence. **`.agency/do.md`'s CI section is the source of truth for
   the run, and it supersedes anything here** — read it and follow it. The shape:
   drive odu through the MCP face (`run` → `wait_for_settle` fail-fast → read the
   red node's log → `node_rerun`), pin **both** lanes so the run is two-platform by
   construction (the linux lane on a leased pool box, the darwin lane on rasam),
   react to `failed`/`errored` nodes the instant they land (fix→fmt→commit→retry),
   and **confirm the settled run actually carried both platforms before reporting
   green** — a platform you didn't pin silently drops, and a single-platform green
   is a false green. For a companion repo's lane (e.g. a `surface.md` drishti PR)
   use `--host`, never inline `$ODU_HOSTS` — all of this lives in do.md.
2. **Concurrently, run `/evidence`** while CI runs — follow the **`## PR
   evidence`** section of `.agency/do.md` for the capture procedure, then post the
   result under `## Evidence`. For bug fixes, demonstrate the now-fixed behavior
   even when there's no visual diff. Skip only if that section says to (or is
   absent).
3. **Join before Done** — confirm CI is green on the final `HEAD` **and** evidence
   is posted. If a CI fix-commit changed visible behavior *after* capture,
   re-capture so the evidence matches what actually merges. **Tearing down any
   daemon you spawned for capture (a local kaval / padi-tui dialer, an ssh tunnel) is
   governed by `/dev-server` §5** — kill the PID you captured at spawn (`$!`),
   **never** `pgrep -f`/`pkill -f` a socket-path/port substring: it matches the
   production kaval/kolu daemon, not your dialer. Cheaper still: leave the ephemeral
   test daemon for the user / OS rather than guess a PID.

## Done

Report the PR URL, the gauntlet outcome (lens-debate consensus + fixes applied,
the selected agent-debate peer and its consensus or reviewer-error, police
findings actioned — **or** that `--skip-gauntlet` was used and §4 was skipped),
and CI status. Never merge — the human reviews the commits and merges when satisfied.

**Then close the loop — run `/self-improve` (Skill tool), passing this run's `$CLAUDE_CODE_SESSION_ID`** so it can mine this session for recurring friction and turn it into a sharper skill-set. It runs **forked** (`context: fork`) so the whole analysis stays off your context — hence the explicit session id. It produces nothing unless a lesson durably recurs, ships any fix on its own draft PR (never this branch, never merged), and restores this branch — a clean, no-PR run is the common outcome.

ARGUMENTS: $ARGUMENTS

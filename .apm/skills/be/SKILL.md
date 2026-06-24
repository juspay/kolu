---
name: be
description: Modern, interactive alternative to `/do` — clarify intent up front, then take a task end-to-end with a serial AI review gauntlet (lens debate (lowy ⇄ hickey) → codex debate → simplify → code-police, each editing the branch in turn) → CI → evidence. ONLY invoke when the user explicitly types `/be` or `$be`; never auto-select from a natural-language request.
argument-hint: "<issue-url | prompt>"
---

# Be

Take a task to a shipped, reviewed PR. Unlike `/do` (autonomous start to finish), `/be` **opens with a short interview** — and is then **fully autonomous**, exactly like `/do`, from §1 onward. The interview is the *only* place `/be` asks the user anything; after it, make sensible defaults and keep moving — no further `AskUserQuestion`, no stopping between steps. The single exception is the optional plan-review pause in §1, and only when "plan first" was chosen. Concise by design — defer mechanics to the skills it calls.

**Autonomy doesn't inherit — propagate it to every subagent you delegate to.** When you hand work to a fresh subagent (a §2 package build, a §5 "finish the ship" CI+gate+cleanup pass), its prompt must say *execute now; do not wait for confirmation, do not ask me to "say go"* — a subagent starts without your interview's "no stopping between steps" contract, so a prompt that merely lays out a plan gets a plan **back** (zero tool uses) instead of done work, and you're the one who has to type "go." Bake the directive into the delegation, and if a subagent still returns a plan-and-waits with no tool uses, resume it with "execute now" rather than surfacing the stall to the user.

**Requires Claude Code's `Skill` tool** (the debate reviewers it calls are `Workflow`-backed).

**Foreign repo? Detect it once, up front, and adapt — don't improvise the same swaps four times.** The moment the task targets a repo other than kolu (a different clone, an issue URL pointing elsewhere), the kolu-specific machinery this skill names does **not** exist there, and probing for it (`.agency/do.md`, `docs/atlas/`, `systemctl is-active kolu`, the `mcp__odu__*` face, pu boxes) just confirms its absence. So decide *foreign vs. kolu* before §1 and apply these substitutions wherever the section below assumes kolu — fail-fast still holds, you're swapping the *source of truth*, not lowering the bar: **(1)** the project's commands come from **its own** manifest (`package.json` scripts, `justfile`, `Makefile`, a `CONTRIBUTING.md`), not `.agency/do.md`. **(2)** Its toolchain may not be on `PATH` — resolve it through the repo's own pin (`nix shell nixpkgs#<tool>` / `nix develop` / the flake) rather than assuming a global binary; and a JS install that leaves a phantom transitive import unresolved usually wants the **hoisted** node-linker (`bun install --linker hoisted`, pnpm's default), not the isolated default. **(3)** The §4 gauntlet keys off the **cwd's** diff — point its reviewer agents at the foreign repo's path explicitly, since the cwd (kolu) is clean. **(4)** §5's pu-box venue gate is a *kolu*-production safeguard; off-kolu there's no `kolu.service` to OOM, so run that repo's own CI/build directly, and map its real CI lanes (a green typecheck = the typecheck lane, an untouched lockfile = the dep-sync lane) instead of skipping. **(5)** Atlas/odu/changelog/website steps are kolu surfaces — skip them; substitute the foreign repo's own docs + PR conventions. One more cross-repo gotcha: **prefer `rg` over `grep`** for any non-trivial search — GNU `grep` can silently return nothing on a large (10k-line) file where `rg` works, so a quiet empty `grep` is never proof of absence.

## 0. Interview (the differentiator)

Before any work, ask the user via **`AskUserQuestion`** (one call, batched):

- **Plan first?** — write the plan as an **Atlas note** (`docs/atlas/src/content/atlas/<slug>.mdx`) for review *before* implementing, or implement straight. Default: straight, unless the task is large/ambiguous. *(If the prompt already points at an existing Atlas note or legacy `docs/plans/*.html`, skip this question — that file is the plan of record; reuse it.)*
- **Task kind** — bug fix · feature/new behavior · refactor/chore. This sets the test strategy (see §2).
- **Ultracode?** — include this question *only when no system-reminder says ultracode is on*. Remind the user that `/be` runs richer with ultracode (deeper review fan-out, adversarial verification of each finding) and ask whether to proceed on the standard pass or pause so they can enable it. Options: *Proceed (standard pass)* / *I'll enable ultracode first*. If they pick the latter, stop and let them turn it on, then re-run.

Add a question only when something material is genuinely unclear — don't pad. Honor anything the user already pinned in the prompt instead of re-asking. **This single `AskUserQuestion` call is your one and only chance to ask** — surface every clarification you need now (including the ultracode check above), because everything after this is autonomous.

## 1. Set up

- `git fetch origin`; branch off `origin/<default>` (`git symbolic-ref --short refs/remotes/origin/HEAD`). Feature branches only — never commit to master.
- Read `.agency/do.md` for the project's **check / fmt / test / ci** commands and its **`## PR evidence`** section. Reuse them throughout. *(Foreign repo with no `.agency/do.md`? Use its own manifest per the foreign-repo clause above.)*
- **If "plan first" (or working off an existing plan):** the plan of record is an **Atlas note** (`docs/atlas/src/content/atlas/<slug>.mdx`). **Load `/atlas` (Skill tool)** for the note mechanics — frontmatter, the component kit, `just atlas::build` + staging `dist/`, and the Code-tab + htmlpreview share links. Set `kind:` to match the §0 task (`bug`/`feature`; else `analysis`/`reference`) and `status: proposed`. The plan itself must: **(a)** stay **high-level** — user- and architecture-focused (what changes + the *shape*: seam, data flow, trade-offs and alternatives), with **no implementation dump** (no line-level code, file-by-file lists, or signatures; the *how* is §2's job); **(b)** carry a **UI prototype** (`<AtlasMockup>` or inline JSX) if the change has any on-screen surface, so the user judges look-and-feel before code; **(c)** **ground every load-bearing low-level fact against the installed code before asserting it** — staying high-level (a) does not license *guessing*. A pinned **dependency version** (read the lockfile, not the `^range`), a third-party library's **emitted markup / attribute / API shape**, a **test-environment strategy** (a unit env or a needed dep), a **framework runtime behavior** (e.g. *does a coarse SolidJS store reader coalesce same-shape deltas, or does Solid flush every write?* — a load-bearing reactivity/coalescing fact you **reproduce empirically against the installed source**, never deduce from first principles) — each is a fact the *how* in §2 will be built on, so verify the few the plan leans on the same way §2 gets ground truth (read the lockfile / the package's `vitest.config.ts` / the actual emitted DOM / a throwaway repro of the reactive path), don't recall it from training. A plan that asserts `marked-footnote@1.2.4 emits class="footnote-ref", test it under happy-dom` when the lockfile says `1.4.0`, the marker is a bare `data-footnote-ref`, and the package keeps a deliberate node-only env with no happy-dom is *wrong*, not merely detailed — it forces an implementation-time reconciliation and ships a false published note. **Self-check before presenting** — rework until all hold; don't make the user be the linter: high-level ✓, prototype-if-visual ✓, facts-grounded ✓, renders clean ✓. Then **push the branch** and **hand it over** for review via the Code tab *and* the htmlpreview link — do *not* use plan mode; wait for the user's reply, incorporate feedback (rebuild + push each round), and resume only on their go. This is the one sanctioned pause. **The plan ships in the PR.** *(A legacy `docs/plans/*.html` plan stays HTML — edit it in place.)*

## 2. Implement

**Honor the design philosophy first.** Before writing code, re-read `.claude/rules/conventions.md` → **Design philosophy** (fail-fast / no-fallbacks · electricity boundaries · reuse the existing source of truth) and state in the plan or PR body how this change honors each. A fallback path, a new override knob, a domain-agnostic helper folded into an app module, or a hand-rolled mechanism that duplicates an existing one (`.gitignore`, an extension/MIME table, a library) is a defect to fix now — not a follow-up the review gauntlet should have to catch.

- **Bug:** reproduce *before* you theorize or fix — start from facts, not a story about the bug. **Where it runs: pu box, not locally** — building, running the repro (`just test-quick`/`just dev-auto`/a scripted repro), and any "let me SEE it" check are **heavy work**, and reproduction is the §5 venue gate fired early. Whenever `systemctl --user is-active kolu` is `active` (the normal case) that work belongs on an ephemeral pu box, never on the user's machine: a pile-up of local builds + e2e runs OOM-killed production `kolu.service` once, and a broad `pkill -f <substring>` to clean up OOM'd processes killed it again — its nix-store process matched the substring. **Load `/dev-server` §0 before launching/building/repro-ing anything**, and never `pkill -f` by any command substring — resolve PIDs by remembered port, or just let the pu box go. **(1)** Get ground truth from the running system; observe the real symptom, don't trust a description of it. **(2)** Pin the one hard, observable fact the bug produces — a wrong value, an error, a state that can't legally happen (e.g. "the client SHA stays `7deb397` across reloads"). **(3)** Build a reproduction that exhibits *that exact fact* and is **red on the current code** — a **failing e2e test** via the `/test` harness when it can express the bug, otherwise a scripted repro. A repro that *passes / converges / "works"* is **not** a reproduction: if it doesn't show the symptom the **repro** is wrong — fix the repro, never conclude "no bug" from it. **(4)** Only now fix, until that same repro flips green. No fix without a reproduction that was first red for the real reason. The fix must make the feature *work*, not disappear: disabling it, defaulting it off, or routing the affected platform onto a degraded path is the no-fallbacks violation from §2's design-philosophy clause wearing a bug-fix hat — a *mitigation*, not a fix, and a defect to reject now, never to ship or post as "verified." If the only remedy you can find removes or degrades the behavior, you haven't understood the bug yet — keep digging (fork the upstream dependency if that's what a real fix needs) before you settle.
- **Feature / new behavior:** write the covering test (e2e/integration/unit as fits) before or alongside the change.
- **Refactor/chore:** no test-first requirement; rely on existing coverage.

**Sync the docs.** Read `.agency/do.md` for its **`## Documentation`** section — a *principle* (discover the stale docs, don't recall a checklist), **not** a fixed file list. Updating the README + Atlas and stopping there is the exact pattern-match-a-couple-and-skip-the-rest trap it warns against. So **grep every doc surface for the term you touched** — the command, flag, type, or word — across `README.md`, every `packages/*/README.md`, **`website/`** (the kolu.dev marketing pages, e.g. `src/pages/*.astro`, which hand-list commands and carry "next up is X" prose that goes false), and `docs/atlas/`. For **each** hit, either edit it or record why it's still accurate — "I updated the README" is not a doc-sync until the changed package's README and every user-facing marketing surface were each *grepped and resolved*. The docs commit rides the same review gauntlet as the code. Skip only when the change is genuinely doc-neutral.

**Add a changelog entry.** For any **user-facing** change, append one line to `website/src/content/changelog/unreleased.mdx` under the right `###` heading — `Added` / `Fixed` / `Changed` / `Heads-up` (the editorial home for disruptive changes: a removed feature, a changed default, a migration). Create the heading if a freshly-reset section doesn't have it yet. Write it as prose a *user* reads, not a commit subject — no PR link yet (the PR doesn't exist until §3; you backfill the link there). Skip only when the change has no user-visible effect (pure refactor/chore/internal). The file is `merge=union`, so a plain append (or a new heading) never conflicts.

Run **check** and **fmt**, then commit (conventional message) and push the feature branch. **`just check` (tsc + biome) green is not proof the shipped artifact *builds*** — when the change adds or edits a bundler/server entrypoint (a `vite.config.ts`, a `nix run` server wrapper, any module the real build loads) that **imports a workspace package**, tsc resolves extensionless imports that native ESM / the bundler will *reject*, so a clean typecheck can sit on top of a `vite build` / `nix run .#<pkg>` that doesn't build at all. For that kind of change the §5 venue gate fires early: actually run the real build on a pu box (`nix run .#<pkg>` / `vite build`), don't infer it from the typecheck. Leaving it for CI/evidence to surface is how a non-building entrypoint reaches the gauntlet. **The same is true of a dependency change**: the moment the change touches `package.json` / `pnpm-lock.yaml` (a `pnpm add`/`remove`/`update`), the recorded `fetchPnpmDeps` FOD hash in `nix/modules/typescript.nix` goes stale and **every** linux nix-build CI lane (`ci::pnpm-hash-fresh`, `ci::nix`, `ci::smoke`, …) reds at once — a guaranteed wasted CI cycle if it's left for §5 to surface. **Load `/nix-typescript` (Skill tool) and refresh the hash the instant the lockfile changes**, in the **background** (`nix build` takes minutes — kick it off and keep coding, per that skill), so the corrected hash rides this same commit. `just check` never catches this; only a real `nix build` does.

## 3. Open the PR

**Before any review** — so every reviewer's findings land as comments on a real PR. Load **`/forge-pr`** (Skill tool) and `gh pr create --draft` with a genuine title/body covering the scope so far. The PR exists for the rest of the run; later steps push commits and post comments to it.

**Backfill the changelog PR link.** If §2 added a changelog entry, fill in its PR now that the number exists — set the **`pr={<n>}`** prop on the entry's `<Change title="…" pr={<n>}>…</Change>` (auto-injected into changelog MDX, so no import; it renders the GitHub-style PR chip). Then commit and push so the link rides this PR. Skip if §2 added no entry.

**If there's a plan of record, finalize it now.** Once the PR URL exists, **finalize the Atlas note via `/atlas`**: set `status: implemented`, link the PR with `<PrLink pr={<n>} />`, rebuild + stage `dist/`, commit (`docs(atlas): link PR #<n>`) and push so it's part of this PR. *(A legacy `docs/plans/*.html` plan stays HTML — edit its status/PR link in place.)*

## 4. Review gauntlet

Run **`/be-review`** (Skill tool) — it runs four reviewers **serially**, each the
sole editor while it runs: `/lens-debate` applying the agreed fixes, then
`/codex-debate` (its per-round commits are the debate), then `/simplify`, then
code-police. Each step reads a clean tree (the previous step has committed) and
applies its own fixes directly — no snapshot, no apply pass. be-review pushes once
at the end and *then* posts the PR comments (lens, codex, and a code-police
summary), so no comment advertises a local-only commit.

- Pass `base`, the change **`rationale`** (so the lenses don't flag deliberate
  decisions), and **`context`** — the task intent and key decisions you hold from
  this run, so the codex author **inherits what you know instead of re-deriving it
  from the diff**. Preflight is a non-empty diff and (since codex runs) `codex login
  status`.
- Lens-debate commits its agreed fixes; codex's rounds commit `fix(…)`; simplify
  and code-police commit `refactor:` / `fix(police):`. Confirm the post-push PR
  comments landed: lens, codex, and — when the police track ran — the code-police
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

1. **Kick off `/ci` first, backgrounded** — start the pipeline so it churns while
   you capture evidence. **Drive it through the odu MCP face, not a shelled-out
   `nix run .#odu`:** when an odu MCP server is wired (the `mcp__odu__*` tools —
   check before shelling out), every run *and every status/log check* goes through
   it — `run` → `wait_for_settle` (fail-fast) → read the red node's log via
   `ReadMcpResourceTool` on `surface://collections/logs/{id}` → `node_rerun`, per
   the `/ci` skill. Reaching for `nix run .#odu -- run/status` while that server is
   present is the fallback path, not the default. React to `failed`/`errored` nodes
   the moment they land: fix→fmt→commit→retry on real failures, confirm green on
   the final `HEAD`.
   - **macOS (`aarch64-darwin`) CI host — pick by availability, in this order:
     `rasam`, then `sincereintent`.** Both are Apple-Silicon darwin builders;
     `rasam` is the primary and `sincereintent` the fallback. Before pinning the
     darwin lane, probe them **in that order** — `tailscale status` (skip a host
     shown `offline` / `last seen Nh ago`) plus a quick `ssh -o ConnectTimeout=8
     <user>@<host> true` — and pin the **first that answers** in `mcp__odu__run
     hosts=["aarch64-darwin=<user>@<host>", …]`, noting in the report which host
     served the lane. An unreachable host is an infra fault, never a lane to park
     or call green: if `rasam` is down, fall through to `sincereintent` and run the
     lane yourself; only if **neither** answers is the darwin lane genuinely
     blocked (report it as blocked — never silently drop the platform or report
     green on a lane that never ran; an unreachable host is the no-fallbacks rule's
     "a caught error must surface"). This live availability order is what to apply
     even where `.agency/do.md`'s steady-state note still reads "rasam, not
     sincereintent / sincereintent retired": that line is the default pin, this
     ordering supersedes it the moment the primary is dark.
     - **The same `rasam → sincereintent` order governs *every* darwin lane this
       run starts — including a downstream/companion repo's CI** (e.g. the drishti
       PR a `@kolu/surface` change requires per `surface.md`). A consuming repo's
       own `hosts.json` may name a *different*, possibly-dark darwin host (drishti's
       `zest`); when it's offline you fall through to the **same** working
       fallback. But that repo's CI is the shelled-out `nix run … odu -- run`
       path, not `mcp__odu__run`, so pin the override with **`--host
       aarch64-darwin=srid@sincereintent`** (per the `/ci` skill) — **never** by
       exporting inline JSON into `$ODU_HOSTS`, which odu reads as a *file path*,
       not a value: an inline `$ODU_HOSTS='{…}'` is **silently ignored**, the lane
       falls back to the repo's on-disk `zest`, and you burn a full CI run on the
       dead host. If you must set `$ODU_HOSTS`, write a real hosts *file* and point
       at it; otherwise reach for `--host`.
2. **Concurrently, run `/evidence`** while CI runs — follow the **`## PR
   evidence`** section of `.agency/do.md` for the capture procedure, then post the
   result under `## Evidence`. For bug fixes, demonstrate the now-fixed behavior
   even when there's no visual diff. Skip only if that section says to (or is
   absent).
3. **Join before Done** — confirm CI is green on the final `HEAD` **and** evidence
   is posted. If a CI fix-commit changed visible behavior *after* capture,
   re-capture so the evidence matches what actually merges. **Tearing down any
   daemon you spawned for capture (a local kaval / pulam dialer, an ssh tunnel) is
   governed by `/dev-server` §5** — kill the PID you captured at spawn (`$!`),
   **never** `pgrep -f`/`pkill -f` a socket-path/port substring: it matches the
   production kaval/kolu daemon, not your dialer. Cheaper still: leave the ephemeral
   test daemon for the user / OS rather than guess a PID.

## Done

Report the PR URL, the gauntlet outcome (lens-debate consensus + fixes applied, codex consensus or reviewer-error, police findings actioned), and CI status. Never merge — the human reviews the commits and merges when satisfied.

**Then close the loop — run `/self-improve` (Skill tool), passing this run's `$CLAUDE_CODE_SESSION_ID`** so it can mine this session for recurring friction and turn it into a sharper skill-set. It runs **forked** (`context: fork`) so the whole analysis stays off your context — hence the explicit session id. It produces nothing unless a lesson durably recurs, ships any fix on its own draft PR (never this branch, never merged), and restores this branch — a clean, no-PR run is the common outcome.

ARGUMENTS: $ARGUMENTS

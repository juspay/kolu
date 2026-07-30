# /do config

`/do` reads this file at the steps that need a project-defined command (check, fmt, test, ci, docs) and at the evidence step.

## Check command

`just check` — fast static-correctness gate. Runs `pnpm typecheck` plus `biome lint` across the workspace. CI's `ci::typecheck` runs the typecheck half and `ci::biome` runs the lint half. `just lint` is a standalone recipe that mirrors `ci::biome`.

## Format command

`just fmt` — runs `biome format --write` over the workspace plus `nixpkgs-fmt` over `.nix` files. Biome v2 is now the sole JS/TS/JSON/CSS formatter (Prettier was retired in [#710](https://github.com/juspay/kolu/issues/710)). Config lives in `biome.jsonc` at the repo root.

## Test command

Invoke the `/test` skill. It owns **both** lanes: the unit lane (`just test-unit`, or a `--filter`ed `test:unit` / `vitest run` narrowed to the packages the diff touches) and the e2e lane (relevant `.feature` files selected from the git diff, run via `just test-quick`). Its "Unit lane" table is the source of truth for the vitest invocations — read it instead of grepping the `justfile` or a `package.json` for them.

## CI command

Invoke the **`/ci` skill** — it owns the full CI procedure for this repo: the odu MCP front door, the banned opt-out flags (`--no-post` / `--no-strict` / `--no-snapshot`), mandatory two-platform (`x86_64-linux` + `aarch64-darwin`) coverage, odu-native venue-pool leasing across both platforms, live fail-fast surfacing, the `pu`-misbehaviour #1204 log, the flake-is-a-defect rule, and the green-gate (`odu protect`). The `/do` CI step is exactly "run the `/ci` skill." Runner mechanics (subcommands, flags, modes, the socket surface) are the `/odu` skill it layers on top of.

## Documentation

**Keep the docs in lockstep with the code, in the same PR — so the doc changes ride the same review as the code.** This is a principle, not a fixed checklist (a hardcoded file list goes stale and trains you to pattern-match a couple of entries and skip the rest). For any user-facing or architectural change, find every doc the change makes *stale* and update it. **Discover them, don't recall them:**

- **Grep the doc surfaces for what you changed** — the feature, command, flag, type, or term you touched — across `README.md`, every `packages/*/README.md`, `website/`, and `docs/atlas/`. A hit that describes the old behaviour is a doc to fix; judging a hit still-accurate is a *conscious decision to record*, not a silent skip.
- **Update the home of the change.** The doc nearest to what moved, e.g.: the changed package's **own `README.md`** (the most-overlooked one — a CLI/behaviour change lives there first); the shared-framework contract inventory in **`packages/surface/README.md`** when a descriptor is added/retired/reclassified; the per-host **daemon** READMEs — **`packages/padi/README.md`** for the workspace daemon (session · awareness · restore · kaval ownership) and **`packages/kaval/README.md`** for PTY ownership — when the daemon topology moves; the top-level **`README.md`** architecture prose/diagram (see `.claude/rules/architecture.md`); the **`website/`** marketing page (e.g. `src/pages/index.astro`) when a *browser* surface changes shape — drive the running app via the `dev-server` skill for a reference screenshot, never `just dev`; the **Atlas** plan-of-record in `docs/atlas/` (advance its status / PR link — `/be` §1/§3).

Default to **over-checking**: enumerate the candidate docs and, for each, either edit it or state why it's untouched. "I updated the README and changelog" is not a doc-sync until the changed package's README, the framework inventory, and any user-facing marketing surface were each *considered* (and the skip, if any, justified).

**The changelog is in scope for every user-facing change** — `website/src/content/changelog/unreleased.mdx`. A `<Change>` is written **for the reader upgrading from the LAST RELEASE**, not for someone who watched yesterday's commits — so two rules govern it:

- **Release-relative, not commit-relative.** Describe what changed **since the last release**, in the reader's terms. Never narrate internal iteration ("fixes the regression the previous fix introduced"), and never leak internal phase/campaign vocabulary (SR8, W5) into the entry text — the PR refs carry that archaeology.
- **Iterating on an unreleased feature/fix EDITS its existing entry — it does not append.** If the change you're shipping already has an unreleased `<Change>`, rewrite that entry so its prose stays net-true and **add your PR to its refs** — `prs={[1832, 1835]}` renders a chip per PR. Only a change with **no** existing unreleased entry appends a new one. Otherwise one release's worth of iteration leaves N entries where the reader needs ONE.

Mechanically: add or edit one **Markdown list item** under the matching product-area `###` heading, whose label links to the same docs page this change updates. Create that product-area heading if it is absent. Put the editorial type on the entry itself: `- <Change kind="added" title="…" pr={n}>…</Change>` for a single PR, or use `kind="fixed"`, `kind="changed"`, or `kind="heads-up"` (the disruptive/migration type) and `prs={[…]}` for several PRs. Keep the **whole entry on ONE line** (no wrapping) so concurrent notes merge cleanly. `title` is the scannable, product-language headline; the children are the supporting prose. `<Change>` / `<PR>` are **auto-injected** (`changelog.astro`'s `components` prop) — no import line. The PR chip lands during doc-sync and its number is backfilled right after the PR is created (the step that also finalizes the Atlas note). Skip only a genuinely user-invisible change (pure refactor / internal).

## PR evidence

Post a `## Evidence` PR comment when **any** of these holds — the trigger is "is there behavior worth proving?", not "does a pixel change?":

1. **Visible UI impact** — capture screenshots, or **video** when the change is about motion (an animation, a transition, a multi-step interaction a still can't convey). Use judgment — server-only diffs sometimes ripple into rendering.
2. **Behavioral / round-trip changes** — the diff touches a persistence, restore, session, autosave, debounce/coalesce, or reconnect path, and the proof is *"state survives an interaction or a restart,"* not a pixel change. Capture the before→after **behavior** — often with **zero visual diff** (e.g. resize → stop kolu → start → restore session → the panel returns at the resized width). A video of the round-trip is the proof the fix didn't break recoverability.
3. **Bug fixes generally** — the default for a fix is *"demonstrate the fixed behavior."* The bug was often a storm, a lost write, or a hang, so a before/after or survives-restart clip is the evidence **even when nothing looks different**. Don't skip evidence just because a fix has no visual diff; skip only when the behavior genuinely can't be observed (e.g. a pure internal refactor with no externally visible effect).

**Cover mobile/touch, not just desktop.** Kolu runs on phones and tablets, and these are **two orthogonal axes** — never conflate them (see `useMobile.ts`): viewport **size** (`isMobile`, the bottom-**drawer** layout) and input **modality** (`isTouch()`, `(pointer: coarse)`, which drives roomier hit targets that must clear the WCAG 2.2 **24px** floor). A desktop browser resized to 390×844 exercises the small-viewport layout but **leaves `(pointer: coarse)` false**, so it does *not* verify touch sizing. So for **any** visible UI change, a desktop-only capture is **not enough**, and you must cover the right axis for what changed:

- **Small-viewport / drawer layout** — drive a phone-width viewport (e.g. `resize_page` to ~390×844 in the chrome-devtools path, or the mobile drawer) and confirm the change is reachable, **not clipped**, and tappable.
- **Coarse-pointer hit targets** — when sizing is gated on `isTouch()` / `(pointer: coarse)` (touch-roomier rows, the Code-tab toolbar, the segmented control), a width resize alone proves nothing. Actually emulate a coarse pointer: a Playwright mobile context / device profile with `hasTouch`, or assert `matchMedia('(pointer: coarse)').matches` in the captured state. Verify each target measures ≥24px there.

Desktop-only evidence has already shipped a touch regression (20px segmented-control targets a desktop screenshot looked fine at — and a *width-only* resize would have missed it just the same). When the desktop and mobile layouts differ, post **both**; when they're identical, one line confirming the mobile/coarse-pointer rendering was checked suffices. Skip only for changes with no on-screen surface at all.

**Capture by recording an e2e scenario — the [`evidence`](../.apm/skills/evidence/SKILL.md) skill owns the procedure** (it builds on the [`pu`](../.apm/skills/pu/SKILL.md) skill; everything runs on an ephemeral `pu` box, off-machine, the way CI runs e2e). Kolu's e2e suite (`@cucumber/cucumber` + Playwright) already drives every UI surface through a maintained step library, so you capture a clip by *recording a scenario* — selected **by name**, with no edit to the feature file — never a hand-rolled Playwright script. Pick the scenario that exercises the change (or author a tiny one reusing existing steps); on the box the skill runs it with `KOLU_EVIDENCE=1`, which makes `packages/tests/support/hooks.ts` record the `.webm` (recordVideo + slowMo, animations left on), then transcodes (ffmpeg → GIF/mp4), uploads to the `evidence-assets` release, and links the shared Pages player.

```sh
KOLU_EVIDENCE=1 just test-quick features/<file>.feature --name "<scenario name>"
# → packages/tests/reports/videos/<scenario>.webm
```

Rationale + the ecosystem survey: [`docs/atlas/src/content/atlas/video-evidence.mdx`](../docs/atlas/src/content/atlas/video-evidence.mdx).

**Capturing a state no scenario reaches (live chrome-devtools path).** When the evidence skill's "drive the state live" step (§A2) runs on *your machine* rather than a `pu` box, launch kolu with the `dev-server` skill — it boots on two random free ports via `just dev-auto`, remembers them for the session, and hands chrome-devtools the right client URL. This is mandatory: an agent that ran a bare `just dev` for evidence on [#1109](https://github.com/juspay/kolu/issues/1109) bound production's fixed ports and disrupted the live `kolu.service`. Never run the app for evidence any other way; never touch the systemd unit.

### Agent-state scenarios

When the change touches the Dock, terminal, or any UI surface that reflects agent activity, the capture has to show real states — a blank Dock proves nothing. Kolu's opencode integration is first-class: have the scenario you're recording open a terminal and run opencode in it (an `I run "…"` step); the preexec hook surfaces state in the Dock within ~300ms (states: `thinking`, `tool_use`, `awaiting_user`, `waiting`; bucketed in the Dock as `working ▸`, `awaiting ⏵`, `idle ☾`).

```sh
# Inside a Kolu terminal on the box — no global install needed
nix run github:juspay/AI#opencode
```

Drive distinct states by prompt:

- **thinking / tool_use** (`working ▸`, pulsing border) — send a reasoning- or tool-heavy prompt (`explain the architecture of this repo`, `list every file in src/`); capture during the spinner.
- **awaiting_user** (`awaiting ⏵`, breathing border) — request an action that needs confirmation (e.g. an edit opencode wants to apply).
- **waiting / idle** (`idle ☾`) — let the reply finish; the row drops to the idle bucket.

For PRs whose changes affect one state, a single representative capture is fine; capture each when the change spans multiple. The default evidence for any Dock-touching change is **a screenshot of the Dock showing an agent state with a visible opencode reply** — that single frame proves the pipeline (terminal → provider → Dock) is alive end-to-end.

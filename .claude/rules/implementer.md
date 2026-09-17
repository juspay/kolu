---
paths:
  - "**"
---

## Implementer playbook

The project-defined commands a task needs (check · fmt · test · ci) and the
evidence step. Written for whoever implements — an agent driving a task to a PR
(a `/waterfall` implementer, say) or a human doing the same by hand.

## Check command

`just check` — fast static-correctness gate. Runs `pnpm typecheck` plus `biome lint` across the workspace. CI's `ci::typecheck` runs the typecheck half and `ci::biome` runs the lint half. `just lint` is a standalone recipe that mirrors `ci::biome`.

## Format command

`just fmt` — runs `biome format --write` over the workspace plus `nixpkgs-fmt` over `.nix` files. Biome v2 is now the sole JS/TS/JSON/CSS formatter (Prettier was retired in [#710](https://github.com/juspay/kolu/issues/710)). Config lives in `biome.jsonc` at the repo root.

## Test command

Invoke the `/test` skill. It owns **both** lanes: the unit lane (`just test-unit`, or a `--filter`ed `test:unit` / `vitest run` narrowed to the packages the diff touches) and the e2e lane (relevant `.feature` files selected from the git diff, run via `just test-quick`). Its "Unit lane" table is the source of truth for the vitest invocations — read it instead of grepping the `justfile` or a `package.json` for them.

## CI command

Invoke the **`/ci` skill** — it owns the full CI procedure for this repo: the odu MCP front door, the banned opt-out flags (`--no-post` / `--no-strict` / `--no-snapshot`), mandatory two-platform (`x86_64-linux` + `aarch64-darwin`) coverage, odu-native venue-pool leasing across both platforms, live fail-fast surfacing, the `pu`-misbehaviour #1204 log, and the green-gate (`odu protect`). Running CI is exactly "run the `/ci` skill." Runner mechanics (subcommands, flags, modes, the socket surface) are the `/odu` skill it layers on top of.

## Documentation

**Keep the docs in lockstep with the code, in the same PR — so the doc changes ride the same review as the code.** This is a principle, not a fixed checklist (a hardcoded file list goes stale and trains you to pattern-match a couple of entries and skip the rest). For any user-facing or architectural change, find every doc the change makes *stale* and update it. **Discover them, don't recall them:**

- **Grep the doc surfaces for what you changed** — the feature, command, flag, type, or term you touched — across `README.md`, every `packages/*/README.md`, `website/`, and `docs/atlas/`. A hit that describes the old behaviour is a doc to fix; judging a hit still-accurate is a *conscious decision to record*, not a silent skip.
- **Update the home of the change.** The doc nearest to what moved, e.g.: the changed package's **own `README.md`** (the most-overlooked one — a CLI/behaviour change lives there first); the shared-framework contract inventory in **`packages/surface/README.md`** when a descriptor is added/retired/reclassified; the per-host **daemon** READMEs — **`packages/padi/README.md`** for the workspace daemon (session · awareness · restore · kaval ownership) and **`packages/kaval/README.md`** for PTY ownership — when the daemon topology moves; the top-level **`README.md`** architecture prose/diagram (see `architecture.instructions.md`); the **`website/`** marketing page (e.g. `src/pages/index.astro`) when a *browser* surface changes shape — drive the running app via the `dev-server` skill for a reference screenshot, never `just dev`; the **Atlas** plan-of-record in `docs/atlas/` (advance its status / PR link — `/be` §1/§3).

Default to **over-checking**: enumerate the candidate docs and, for each, either edit it or state why it's untouched. "I updated the README and changelog" is not a doc-sync until the changed package's README, the framework inventory, and any user-facing marketing surface were each *considered* (and the skip, if any, justified).

**The changelog is in scope for every user-facing change** — `website/src/content/changelog/unreleased.mdx`. A `<Change>` is written **for the reader upgrading from the LAST RELEASE**, not for someone who watched yesterday's commits — so two rules govern it:

- **Release-relative, not commit-relative.** Describe what changed **since the last release**, in the reader's terms. Never narrate internal iteration ("fixes the regression the previous fix introduced"), and never leak internal phase/campaign vocabulary (SR8, W5) into the entry text — the PR refs carry that archaeology.
- **Iterating on an unreleased feature/fix EDITS its existing entry — it does not append.** If the change you're shipping already has an unreleased `<Change>`, rewrite that entry so its prose stays net-true and **add your PR to its refs** — `prs={[1832, 1835]}` renders a chip per PR. Only a change with **no** existing unreleased entry appends a new one. Otherwise one release's worth of iteration leaves N entries where the reader needs ONE.

Mechanically: add or edit one **Markdown list item** under the matching product-area `###` heading, whose label links to the same docs page this change updates. Create that product-area heading if it is absent. Put the editorial type on the entry itself: `- <Change kind="added" title="…" pr={n}>…</Change>` for a single PR, or use `kind="fixed"`, `kind="changed"`, or `kind="heads-up"` (the disruptive/migration type) and `prs={[…]}` for several PRs. Keep the **whole entry on ONE line** (no wrapping) so concurrent notes merge cleanly. `title` is the scannable, product-language headline; the children are the supporting prose. `<Change>` / `<PR>` are **auto-injected** (`changelog.astro`'s `components` prop) — no import line. The PR chip lands during doc-sync and its number is backfilled right after the PR is created (the step that also finalizes the Atlas note). Skip only a genuinely user-invisible change (pure refactor / internal).

## PR evidence

- **Produce:** write the throwaway section at `.saatchi/evidence.ts`, then
  `nix run github:juspay/saatchi` — it starts the app, drives it, and lands one
  shot per `shot()` call in `.saatchi/shots/`.
- **Publish:** `nix run github:juspay/saatchi#publish` prints a paste-ready
  markdown block (videos handled); paste it on the PR.
- The full contract — the `serve` adapter, sections, video, exit codes:
  [saatchi's README](https://github.com/juspay/saatchi).

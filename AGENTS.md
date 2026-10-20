# AGENTS.md

kolu's project-wide agent conventions. Task-specific runbooks live in the
repository's `dev/` plugin (`dev/skills/<name>/SKILL.md`), composed with the
repo profile; read the matching one before a task in its area.

## Communication

- **Answer in plain words.** When the user asks you to explain, summarize, or reason about something (not write code), reach for everyday language first and keep it short. Introduce a piece of jargon, a symbol-heavy phrasing, or an internal codename only when it carries weight the plain word can't — then gloss it once. This is the default for *every* turn, not a per-request favor: the user should never have to ask twice.

## Workflow

- Run `just fmt` (formatting) before declaring done.
- **Prefer external libraries over hand-rolled code**: Use well-maintained SolidJS-native libraries (Corvu, solid-sonner, @solid-primitives, etc.) to reduce custom code surface area. Less code to maintain = fewer bugs.

## Design philosophy

Three principles the codebase is built on. Honor them **by default** when writing code — a violation is a defect to fix now, not a style preference or a follow-up.

- **Fail fast — no fallbacks, no backward-compat, no override knobs.** An override / knob / graceful-degradation path is a defect, not a feature ("being able to *override* is never a feature"). Bake required values in (e.g. via Nix) and **crash loudly** if one is absent rather than silently degrading. A caught error must surface, never collapse to an empty or default state.
- **Volatility boundaries ("electricity").** A domain-agnostic capability that hides a *hard* volatility (transport, reconnect, persistence, GPU-context loss) is its own `@kolu/*` workspace package, with the dependency arrow pointing **out** — never folded into an app / browse / terminal module, however generic the code reads (location *is* structure). Apply the three tests in `docs/atlas/src/content/atlas/electricity.mdx` before extracting; a tidy generic helper that hides only a bounded algorithm is a *leaf*, not a receptacle.
- **Reuse the existing source of truth.** Prefer the repo's canonical mechanism or an existing code path over a parallel hand-rolled one — `.gitignore` / `@parcel/watcher` ignore globs over a hardcoded ignore list, an existing extension/MIME table over a duplicated constant, a maintained library (the rule above) over custom code. When unsure, grep for the existing path before writing a new one.

## Feature discoverability (tips)

When adding a new user-facing feature or shortcut, consider adding a tip so users discover it. See `settings/tips.ts` and `settings/useTips.ts` for the registry and API.

## Reserved keybindings

When adding or rebinding a global shortcut in `input/actions.ts`, check `input/prohibitedKeybinds.ts` — those chords are claimed by tools that run inside kolu PTYs (Claude Code's Ctrl+B / Ctrl+J today) and must reach the terminal. The collision is unit-tested in `keyboard.test.ts`; add an entry there when a new tool reserves a chord.

## Git

- Use [conventional commits](https://www.conventionalcommits.org/) (e.g. `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).

## Implementer playbook

The project-defined commands a task needs (check · fmt · test · ci) and the evidence step. Written for whoever implements — an agent driving a task to a PR or a human doing the same by hand.

### Check command

`just check` — fast static-correctness gate. Runs `pnpm typecheck` plus `biome lint` across the workspace. CI's `ci::typecheck` runs the typecheck half and `ci::biome` runs the lint half. `just lint` is a standalone recipe that mirrors `ci::biome`.

### Format command

`just fmt` — runs `biome format --write` over the workspace plus `nixpkgs-fmt` over `.nix` files. Biome v2 is the sole JS/TS/JSON/CSS formatter (Prettier was retired in [#710](https://github.com/juspay/kolu/issues/710)). Config lives in `biome.jsonc` at the repo root.

### Test command

Invoke the `/test` skill. It owns **both** lanes: the unit lane (`just test-unit`, or a `--filter`ed `test:unit` / `vitest run` narrowed to the packages the diff touches) and the e2e lane (relevant `.feature` files selected from the git diff, run via `just test-quick`). Its "Unit lane" table is the source of truth for the vitest invocations — read it instead of grepping the `justfile` or a `package.json` for them.

### CI command

Invoke the **`/ci` skill** — it owns the full CI procedure for this repo: the odu MCP front door, the banned opt-out flags (`--no-post` / `--no-strict` / `--no-snapshot`), the **`x86_64-linux`-only platform pin** (never run `aarch64-darwin` unless the user asks for it in that conversation), odu-native venue-pool leasing, live fail-fast surfacing, the `pu`-misbehaviour #1204 log, and the green-gate (`odu protect`). Running CI is exactly "run the `/ci` skill." Runner mechanics (subcommands, flags, modes, the socket surface) are the `/odu` skill it layers on top of.

### Surface changes

- **Changing any `packages/surface*` package** requires the two gates in the `/surface` skill: a **paired, CI-green drishti PR pinned to the final kolu HEAD**, and an **ODU-IMPACT** verdict (`breaks-at-bump` / `adoption-opportunity` / `none`) in this PR's body, grounded in a grep of odu's tree at its pinned SHA.

### PR evidence

- **Produce:** write the throwaway section at `.saatchi/evidence.ts`, then `nix run github:juspay/saatchi` — it starts the app, drives it, and lands one shot per `shot()` call in `.saatchi/shots/`.
- **Publish:** `nix run github:juspay/saatchi#publish` prints a paste-ready markdown block (videos handled); paste it on the PR.
- The full contract — the `serve` adapter, sections, video, exit codes: [saatchi's README](https://github.com/juspay/saatchi).

## Documentation

**Keep the docs in lockstep with the code, in the same PR — so the doc changes ride the same review as the code.** This is a principle, not a fixed checklist. For any user-facing or architectural change, find every doc the change makes *stale* and update it. **Discover them, don't recall them:**

- **Grep the doc surfaces for what you changed** — the feature, command, flag, type, or term you touched — across `README.md`, every `packages/*/README.md`, and `website/` (kolu.dev docs + feature pages). A hit that describes the old behaviour is a doc to fix; judging a hit still-accurate is a *conscious decision to record*, not a silent skip.
- **Update the home of the change.** The doc nearest to what moved, e.g.: the changed package's **own `README.md`** (the most-overlooked one — a CLI/behaviour change lives there first); the shared-framework contract inventory in **`packages/surface/README.md`** when a descriptor is added/retired/reclassified; the per-host **daemon** READMEs — **`packages/padi/README.md`** (session · awareness · restore · kaval ownership) and **`packages/kaval/README.md`** (PTY ownership) — when the daemon topology moves; the top-level **`README.md`** architecture prose/diagram; the **`website/`** marketing page (e.g. `src/pages/index.astro`) when a *browser* surface changes shape — drive the running app via the `/dev-server` skill for a reference screenshot, never `just dev`.

Default to **over-checking**: enumerate the candidate docs and, for each, either edit it or state why it's untouched. "I updated the README and changelog" is not a doc-sync until the changed package's README, the framework inventory, and any user-facing marketing surface were each *considered* (and the skip, if any, justified).

### kolu.dev docs are the canonical product docs

The user-facing description of kolu lives in the **kolu.dev docs** at `website/src/content/docs/` (rendered through `DocsLayout`, grouped by the `section` frontmatter). This is the canonical place a user reads about what kolu does and how to use it — **not** the root `README.md`, which is a slim map that points into these pages.

- When you add or materially change a **user-facing feature**, update the matching docs page in the same PR — a new agent's detection → `agent-detection.mdx`; a theming option → `theming.mdx`; a canvas behaviour → `canvas.mdx`; a terminal-tile behaviour → `tiles.mdx`; a dock behaviour → `dock.mdx`; a session/sleep-wake feature → `sessions.mdx`. (`concepts.mdx` is vocabulary-only — behaviour never lands there; if no page owns the surface, that's the signal to create one, not to widen Core Concepts.) Add a **new page** (frontmatter: `title` · `description` · `order` · `section`) when the feature doesn't fit an existing one; the sidebar orders by `order` and groups by `section`.
- Keep the README a pointer. Don't re-grow a feature catalog there — add or adjust a bullet under "What it does" that links to the doc page instead.
- Diagrams are hand-authored **inline SVG** reusing the `ax-d-*` / `doc-figure` classes (the site has no mermaid). Style both light and dark via the `--color-*` CSS tokens — never raw hex.
- This is the product-docs mirror of the Reference-docs gate in the `/surface` skill (which governs the `@kolu/surface` Reference pages). Same discipline: the record must not lie.

### Architecture (docs)

- The canonical architecture write-up is the **kolu.dev docs** page at `website/src/content/docs/architecture.mdx` (served at <https://kolu.dev/architecture>): the daemon stack (PWA client · kolu-server · padi · kaval), how the layers talk over the wire (the single websocket + Effect RPC over ndjson + the same-origin gate), the two data-flow loops, and the package map — with hand-authored SVG diagrams. **Read it before declaring done** on any structural change, and update every part that no longer matches (the stack table + SVG, the communication section, the data-flow loops + SVG, the package map).
- The root `README.md` Architecture section is only a **pointer** to that page — do not re-grow the package table, the communication tables, or the data-flow diagram there. The README is a map; the kolu.dev docs are canonical.

### Changelog entries

- **A `<Change>` in `changelog/unreleased.mdx` is your trigger, not your finish line.** A changelog entry is the most reliable signal that user-facing behaviour changed — so writing one is the moment to ask *which docs page did this just make stale?* A change can invalidate a page it never opens: a "known gap / for now / currently shows X" sentence you just closed, a table row, a flag you renamed. Grep `website/src/content/docs/` for the behaviour you're changing and fix the page **in the same PR** — the failure mode is not a missing doc, it's an existing sentence quietly turned into a lie.
- **Write each `<Change>` for the reader coming from the LAST RELEASE — and iterate by EDITING it, not appending.** Describe what changed **since the last release**, in their terms; never narrate internal iteration, and never leak internal phase/campaign vocabulary into the entry text — the PR refs carry that archaeology. The **`kind` is release-relative too**: you cannot *fix* (or *change*) what the last release never shipped, so a `<Change>` touching a feature that is **itself still unreleased** describes it as `added` and folds into that feature's existing `added` entry (extend its prose, add your PR to its refs) — never a standalone `fixed`/`changed` note. When your PR revises a feature or fix that already has an unreleased `<Change>`, rewrite that entry so its prose stays net-true and **add your PR to its refs** (`prs={[…]}` renders a chip per PR). Only a change with **no** existing unreleased entry appends a new one.
- Mechanically: add or edit one **Markdown list item** under the matching product-area `###` heading, whose label links to the same docs page this change updates. Create that product-area heading if it is absent. Put the editorial type on the entry itself: `- <Change kind="added" title="…" pr={n}>…</Change>` for a single PR, or use `kind="fixed"`, `kind="changed"`, or `kind="heads-up"` and `prs={[…]}` for several PRs. Keep the **whole entry on ONE line** (no wrapping) so concurrent notes merge cleanly. `<Change>` / `<PR>` are **auto-injected** (`changelog.astro`'s `components` prop) — no import line. Skip only a genuinely user-invisible change (pure refactor / internal).

### Doc links — one registry, every surface

In-app links to kolu.dev product docs are owned by **one leaf module**: `packages/client/src/ui/DocLink.tsx`.

- **Touch a doc page's existence or name** (add / rename / delete under `website/src/content/docs/*.mdx`) → update `DOC_SLUGS` in `DocLink.tsx` in the **same change**. The set-equality test in `DocLink.test.ts` fails both ways when they drift.
- **Link to docs from the UI only through `DocLink` / `docUrl`.** Never hand-roll a `https://kolu.dev/...` href (or any other `kolu.dev` literal) under `packages/client/src`. The grep law in `DocLink.test.ts` bans it outside `DocLink.tsx` itself. Button-chrome sites take `docUrl(slug)` for the href and keep their own styling; inline "learn more" text uses `<DocLink slug={…}>`.
- Tips that point at a docs page set optional `doc?: DocSlug` on the tip entry (`settings/tips.ts`); `TipBanner` renders the link when present.

### The Atlas is frozen history

`docs/atlas/` documents past design work and is no longer a target for new plans or design notes. Implementors do not add to it, advance its statuses, or rebuild/commit its `dist/`.

### Diátaxis

Kolu's world is not a clean single quadrant; use the `/diataxis` skill, whose "Kolu overlay" section records where each quadrant lives (product docs vs the `/surface` framework docs).

## Nix

- **DO NOT add flake inputs** to `flake.nix`. Each input adds ~1.5s to `nix develop` cold start. The flake intentionally has zero inputs — nixpkgs and other sources are managed by [npins](https://github.com/andir/npins) and imported via `fetchTarball`. Use `npins add`/`npins update` for new or updated sources.
- **Shared env vars** live in `koluEnv` (defined in `default.nix`). Both the build and the devShell consume it — don't duplicate env var definitions.
- **Measure `nix develop` time** after Nix changes: `time nix develop -c echo test`. Current target: ~2.6s cold, ~0.3s warm.

## Agent configuration

- The repository root is kolu's published **Agent Plugin**: `plugin.json`, `mcp.json`, `skills/kolu/`, and `.claude-plugin/plugin.json`. Consumers reference it as `github:juspay/kolu`.
- Maintainer-only skills live in the **`dev/` plugin** (`dev/plugin.json`, name `kolu-dev`, `dev/skills/<name>/SKILL.md`). The root manifest lists `./dev` and the external plugins maintainers need (odu, nix-chrome-devtools-mcp, xyne-boxes) under `extensions."asia.nixos.agent-distro".plugins`.
- That extension is read only when the repository root is used as an agent-distro **profile** (`AI_PROFILE=<repo>`); the **published plugin copy** that padi bakes (`AGENT_DISTRO_PLUGINS`) is just the four root items and does not follow extensions.
- There is **no generated runtime directory**: editing a skill under `skills/` or `dev/skills/` is the change. Task-specific conventions live in `dev/skills/<topic>/SKILL.md`; project-wide rules live in this file.

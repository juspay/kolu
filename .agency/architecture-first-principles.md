# Kolu architecture-first-principles overlay

Project-specific substance for the base `architecture-first-principles` skill (same pattern as `.agency/code-police.md`). The base skill reads this file to parameterize its generic checks.

**How the section IDs work:** `C1…C7` are the base skill's seven check IDs (C1 ecosystem-duplicate · C2 consumer-ergonomics · C3 graduation-sweep · C4 depends-on · C5 fresh-eyes · C6 state-and-time · C7 project-conventions). This file carries sections ONLY for the checks that take project parameters — C1 (ecosystem hints), C3 (layer ladder), C7 (coverage map). C2/C4/C5/C6 are fully generic and read nothing from here, which is why those IDs are absent, not missing.

## C1 — ecosystem hints (what "already ships this?" means here)
- SolidJS-native libraries are the house default (conventions.md). Check **@solid-primitives/*** first — `rootless` (createSingletonRoot/createSubRoot), `storage`, `event-listener`, `scheduled`, `media`, `resize-observer`, `trigger`, `memo`, `static-store`, `deep`. Several are already direct or transitive deps — **check `pnpm-lock.yaml`, not just package.json** (a transitive dep costs zero to promote).
- **solid-js built-ins** are ecosystem too: `mapArray`/`indexArray` (keyed roots with owner-tied disposal), `on`, `untrack`, `createMemo`, `mergeProps`.
- **node built-ins**: `node:events` `once(emitter, event, {signal})`, `AbortSignal.timeout`.
- In-repo framework exports before hand-rolling: `@kolu/surface*`, `@kolu/padi-client/dial`, `createSharedRoot` (NOT a `createSingletonRoot` duplicate — audited 2026-07-06: rootless ref-counts, all 18 kolu consumers require never-teardown; the semantic distinction is documented in its header).

## C3 — the layer ladder (lowest honest layer wins)
`solid-generic (no surface concept)` < `@kolu/surface` (+ `/solid`, `/server`) < `@kolu/surface-app` (app-shell glue) < `@kolu/surface-nix-host` (ssh/Nix hosting) < `@kolu/surface-daemon(-supervisor)` (daemon lifecycle) < app policy (`packages/client`, `packages/server`). A pure-solid helper in surface-app is a placement smell; app policy in surface-app is a leak.

## C7 — conventions coverage map (rows marked `checks` are C7's checklist; `GAP` = scheduled future miss)
| rule (source) | enforcement |
| --- | --- |
| Prefer external libraries over hand-rolled (conventions.md) | C1 |
| Volatility boundaries / electricity (electricity.mdx) | C3 |
| Reuse the existing source of truth (conventions.md) | C1 + C4 |
| Fail fast — no fallbacks/knobs; caught error must not collapse | code-police + C2(b) dead-knobs |
| Illegal states unrepresentable / no overloaded nulls (ledger L26) | C4 + planned `no-overloaded-null` police rule |
| Framework slots speak roles, classes are for `new` | C3 (placement) |
| README/docs updated with structural change (.claude/rules/architecture.md) | C5 (stale-docs) |
| STREAM_RETRY on every client stream (.claude/rules/streaming.md) | **checks** — C7 verifies on client-stream diffs; candidate police rule |
| Reserved keybindings (conventions.md) | unit test `keyboard.test.ts` |
| Atlas dist sync (.claude/rules/atlas.md) | CI `atlas-sync` |
| APM two-tree sync | **GAP** — #1693 pending; regen broken #1706; manual-sync discipline meanwhile |
| Conventional commits | **GAP** — trivially CI-able |
| Paired drishti PR for @kolu/surface* (.claude/rules/surface.md) | /be ship phase |
| Tips for new user-facing features (conventions.md) | C5 catches undocumented; explicit tips-check candidate |

## Project checks (kolu-added; general ones get upstreamed instead)
_None yet. When a kolu-specific smell recurs, add a Ck row here with its seed miss, question, and evidence bar._

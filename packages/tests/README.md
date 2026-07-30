# E2E Tests

End-to-end tests using [Cucumber.js](https://github.com/cucumber/cucumber-js) with [Playwright](https://playwright.dev/) for browser automation.

## E2E governance and timing

E2E graduation is auditable before any scenario is deleted:

- `scenario-inventory.json` is an append-only history of executable scenario
  revisions. A revision fingerprints backgrounds, steps, tags, expanded
  Examples values, data tables, and doc strings—not merely a scenario title or
  row count.
- `coverage-ledger.yaml` must contain a landed row for every revision that
  disappears. Every row names its real defect surface, retained user journey,
  and destination lane. A `replace` action also requires collected replacement
  evidence and the human review note that accepted it as equivalent at the
  declared defect surface; a `retain-smoke` action is covered by its strictly
  stronger retained browser journey.
- `just test-e2e-governance` compares inventory records with every committed
  version of the inventory reachable from `HEAD`, so deleting or editing
  history in a later commit fails even in detached CI.
  New or intentionally
  revised scenarios are appended with `cd packages/tests && pnpm
  inventory:update` and then reviewed.
- Every Cucumber run writes `reports/messages.ndjson` and reduces it to
  `reports/e2e-timing.json`. The report keeps every attempt, retry, wall-clock
  duration, final-attempt duration, and per-feature totals; reports remain
  gitignored run artifacts.
- `baseline-census.json` records Wave 0's starting census. Collect at least five
  independently leased runs per platform in a `baseline-samples.json`, then run
  `pnpm baseline:report baseline-samples.json baseline-summary.json`; the
  reducer refuses fewer samples and reports medians and IQRs for E2E, unit,
  daemon, whole-pipeline critical path, attempts, and retries.

The ledger is a guardrail, not an equivalence oracle. CI proves immutable
history, complete ledger rows, current browser survivors, non-empty platform
declarations, and collection of every named test. Human review decides whether a
replacement preserves the same user promise through the same defect surface;
`reviewEvidence.note` records that non-executable decision without pretending
CI proved semantic equivalence.

## Structure

```
packages/tests/
├── cucumber.js              # Cucumber config (profiles)
├── features/                # Gherkin scenarios
│   ├── smoke.feature        # Page load, health endpoint
│   └── terminal.feature     # Canvas rendering, resize, zoom, WebSocket
├── step_definitions/        # Step implementations (Playwright)
│   ├── smoke_steps.ts
│   └── terminal_steps.ts
└── support/
    ├── world.ts             # KoluWorld — shared state + terminal helpers
    └── hooks.ts             # Browser lifecycle, server startup, screenshots
```

## Running

```bash
# Against a running dev server (just dev)
just test-dev

# Full build + test (starts server via nix run)
just test
```

Scenarios tagged `@skip` are excluded by default (regression harnesses for known-broken behavior). Run them with `CUCUMBER_TAGS='@skip' just test-quick features/foo.feature`.

Set `HEADLESS=false` to see the browser:

```bash
cd packages/tests && REUSE_SERVER=1 HEADLESS=false nix develop ../..#default -c npx tsx node_modules/.bin/cucumber-js --profile ui
```

## How it works

- **Cucumber.js** is the test runner. It parses `.feature` files and matches steps to TypeScript functions.
- **Playwright** is the browser automation library. `chromium.launch()` starts a real Chromium instance.
- **KoluWorld** (in `support/world.ts`) holds per-scenario state: the Playwright `page`, collected errors, and terminal helper methods (`zoomIn()`, `resizeViewport()`, `terminalRun()`, etc.).
- **Hooks** (`support/hooks.ts`) manage lifecycle: one browser for the entire run (`BeforeAll`), fresh context + page per scenario (`Before`/`After`), screenshot on failure.

### Adding a new test

1. Write a scenario in a `.feature` file.
2. Run — Cucumber prints snippet stubs for undefined steps.
3. Implement the steps in `step_definitions/`.

### Future: shared scenarios for API + UI

When REST endpoints land (Phase 2+), the same `.feature` files can drive both API-level and UI-level tests via separate profiles:

```
step_definitions/        # UI steps (Playwright browser)
step_definitions_api/    # API steps (direct HTTP calls)
support/                 # PlaywrightWorld
support_api/             # ApiWorld (no browser)
```

Run with `--profile ui` or `--profile api` against the same scenarios.

## Why Cucumber over Playwright's test runner

We migrated from `@playwright/test` to Cucumber + Playwright (as library) in Phase 0.

### What we gained

- **Readable scenarios as documentation.** `.feature` files describe behavior in plain language. Useful for reviewing what the app does without reading TypeScript.
- **Test-first workflow.** Write the scenario before the implementation — Cucumber prints stub snippets for missing steps, giving you a clear checklist.
- **Shared scenarios across test profiles.** One `.feature` file can be executed by different step definition sets (UI via Playwright, API via `fetch`). Avoids duplicating test logic.
- **Step reuse across scenarios.** Steps like `the terminal is ready` or `there should be no page errors` are defined once and composed freely. Playwright tests reuse code via helper functions too, but Cucumber makes the composition visible in the `.feature` file.
- **Lower runner overhead.** Cucumber-js is a thinner runner than `@playwright/test`. Same Chromium, same Playwright API, but ~30% faster in practice due to less worker/config/reporter machinery.

### What we lost

- **Interactive UI mode.** `npx playwright test --ui` provides a visual test explorer with step-through replay. No Cucumber equivalent. Workaround: `HEADLESS=false` + `PWDEBUG=1` opens Playwright Inspector.
- **Auto-waiting assertions.** `@playwright/test` wraps `expect()` with auto-retry (e.g., `expect(locator).toBeVisible()` polls until true or timeout). With raw Playwright, we use `locator.waitFor()` explicitly — slightly more verbose.
- **Trace viewer.** Playwright's trace recording (`--trace on`) and viewer (`npx playwright show-trace`) aren't available out of the box. Could be wired manually in hooks but we haven't needed it.
- **Parallel workers.** `@playwright/test` parallelizes across worker processes with isolated contexts by default. Cucumber has `--parallel N` but requires more careful state management. Not relevant yet with 9 scenarios completing in ~10s.
- **Snapshot/visual testing.** `@playwright/test` has built-in screenshot comparison (`expect(page).toHaveScreenshot()`). Would need a separate library if we ever want pixel-level regression testing.

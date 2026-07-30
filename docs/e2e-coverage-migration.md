# E2E coverage-preservation ledger

This ledger records the first Pareto migration from macOS browser e2e scenarios
to existing lower-level coverage. A scenario is removed only when a retained
e2e still proves the assembled boundary and canonical lower-level tests own the
removed input or state matrix.

The baseline is commit `5ec6ad09`: 540 executed scenarios, 12m32.6s in
Cucumber, 13m44.2s for `just test-quick` on the local M1 Max Mac. Full details
are in `e2e-local-macos-measurement.md`.

## Coverage invariants

- Every distinct browser/process boundary remains represented in e2e.
- Every removed input/state permutation remains asserted by a canonical unit or
  integration test.
- Production behavior is unchanged; this change edits tests and documentation
  only.
- A failure in the retained e2e boundary must still catch broken wiring between
  the lower-level subject and the rendered UI.

## Code tab

### Filter mode permutations

Eight outline examples were removed: `local` and `branch` from four filter
scenarios. The `browse` example remains for each DOM interaction, proving the
Code-tab/Pierre wiring.

The shared filter projection is covered exhaustively by
`packages/client/src/right-panel/fileSearch.test.ts`; directory removal and
surviving-expansion behavior are covered by
`packages/solid-pierre/src/pathReconcile.test.ts`. The three modes feed that
same tree/filter implementation, so repeating the interaction against all three
data sources did not cover another branch in the filter behavior.

### Pure filter and directory-pruning cases

The standalone path-token and dead-directory scenarios were removed. Their
exact algorithms remain covered by `fileSearch.test.ts` and
`pathReconcile.test.ts`. The retained filter-click and folder-collapse e2e
scenarios still prove that the algorithms are wired to the real Code tab.

### Browser forward-tail truncation

The forward-tail scenario was removed. Its exact state transition is covered by
`packages/solid-browser/src/createBrowser.test.ts` (navigating after going back
drops the forward tail). The retained cross-mode back/forward journey proves
that Code-tab controls drive the canonical browser.

### Markdown parser matrices

The GFM table/task/inline-HTML and YAML-front-matter scenarios were removed.
Their complete output contracts, including alignment, task checkbox shape,
front-matter escaping, malformed inputs, lists, and disabled front matter, live
in `packages/solid-markdown/src/render.test.ts`.

The retained rich-Markdown, sanitizer, source/rendered, footnote-popover, link,
and image e2e scenarios continue to cover the marked → sanitizer → Solid DOM
composition. Sanitizer-only scenarios stay e2e because the parser tests do not
exercise that DOM boundary.

### Wikilink extension choice

The `.md`-versus-same-stem-extension scenario was removed. Its exact regression
case is covered in `packages/solid-markdown/src/wikilink.test.ts`. Unique,
ambiguous, and missing wikilink e2e journeys remain, preserving parser → repo
inventory → UI navigation and toast coverage.

## Grok

The `tool_use`, `waiting`, and `awaiting_user` initial-state scenarios were
removed. Their event-to-state folds are table-driven in
`packages/integrations/grok/src/core.test.ts`.

The initial `thinking` e2e remains as the on-disk-state → watcher → surface → DOM
composition proof. The late `active_sessions` and live `events.jsonl` scenarios
remain because they exercise real watcher wake-ups that a pure fold test cannot.

## Ports

The passive “loopback needs a forward” scenario was removed because the retained
forward-and-load journey contains that assertion and continues through the real
relay. The cancel journey was removed; actual socket teardown is covered by
`packages/port-forward/src/relay.test.ts`, while manager and concurrent teardown
semantics live in `manager.test.ts` and `lifecycle.test.ts`.

Wildcard discovery, IPv4 forwarding, IPv6 forwarding, split-terminal
attribution, and listener disappearance remain e2e. In particular, IPv6 stays
end to end even though scanner and relay units cover its halves: it is the
composition proof that the discovered address reaches the correct relay.

## Scroll lock

Five scenarios were removed: button dismissal, activity indication,
terminal-switch return, disabled policy, and programmatic scrolling. Their state
transitions are covered by `packages/xterm-kit/src/solid/scrollLock.test.ts`,
including `scrollToBottom`, disabled writes, non-user scroll suppression, and
tab-return behavior.

Five browser scenarios remain for real xterm geometry and focus: engaging the
lock, holding the viewport across output, returning focus, buffer trimming, and
visibility return. Those are the cases whose correctness depends on an actual
browser/xterm viewport.

## Expected count change

The migration removes 24 executed Cucumber scenarios:

- Code tab: 14
- Grok: 3
- Ports: 2
- Scroll lock: 5

Expected suite size: **540 → 516 scenarios**, a **4.4% e2e-count reduction**.
The runtime reduction should be larger than the count reduction because the
baseline failures in Grok and Ports consumed full timeout budgets. The actual
after measurement belongs in `e2e-local-macos-measurement.md`; this ledger does
not substitute an estimate for that result.

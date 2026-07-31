# E2E runtime optimization report

## Goal

Reduce Kolu's browser E2E load without changing product behavior or losing
coverage of any distinct user-visible feature. A browser execution graduates
only when its promise is covered by a lower-layer test plus an independent
browser survivor, or by a strictly stronger retained browser journey.

## Result

| Census | Original | Final | Change |
| --- | ---: | ---: | ---: |
| Feature files | 58 | 58 | 0 |
| Gherkin declarations | 530 | 494 | -36 |
| Expanded executions | 546 | 508 | -38 |
| Default Linux executions | 541 | 503 | -38 |
| Default Darwin executions | 540 | 502 | -38 |

The default Darwin browser load fell by 7.04%. No product behavior was removed
or changed; production-code edits expose existing decisions to lower tests, and
the remaining changes are tests, fixtures, CI environment, and documentation.

## Runtime evidence

All macOS measurements use the exact `ci@petit` host.

| Revision | Suite | Result | E2E wall time |
| --- | --- | --- | ---: |
| `f16eb26` | Original 540-execution strict suite | Did not settle before Odu's one-hour cap | > 60 min |
| `8364706` | Superseded 496-execution candidate, before six perfection restorations | Passed | 219.367 s |
| `71dd255` | Final 502-execution strict suite | Passed | 198.109 s |

The baseline is censored, not a five-sample median. Its run spent the hour in
retries because macOS `/etc/zprofile` replaced the Nix path and exposed
`/usr/bin/git`, an Xcode command-line-tools stub, inside test PTYs. That harness
failure made a matched before/after median impossible and revealed that a
temporary marker-only command helper could produce false greens from stale
fixtures.

The repaired harness is status-strict again. The E2E dev shell includes Nix Git,
the fixture profile restores the inherited Nix `PATH`, compound setup commands
fail as one checked transaction, and intentionally interactive or failing
commands use an explicit start-only step. The 496-execution candidate passed
after those repairs. After perfection review restored six distinct journeys,
the final 502-execution suite also passed and completed in 198.109 seconds.

## Coverage method

- `scenario-inventory.json` keeps every historical scenario revision and CI
  compares it with every committed inventory reachable from `HEAD`.
- `coverage-ledger.yaml` maps each removed revision to its promise, defect
  surface, independent current browser survivor, and—when the action is
  `replace`—lower-layer tests, platform declarations, and a human review note.
- Governance collects every named test. It does not claim to prove semantic
  equivalence; adversarial human review makes that judgment.
- The perfection sweep restored every candidate for which the browser owned a
  distinct fact, including Code-tab mode matrices, rich Markdown composition,
  agent lifecycle paint, worktree composition, terminal and canvas geometry,
  file-drop boundaries, and the other browser/system seams documented in the
  ledger history.

## Decision

Keep the 38-execution reduction. It removes duplicated browser assertions while
preserving the distinct user journeys. There is no retirement quota: future
removals must pass the same inventory, applicable replacement, survivor,
review, and runtime checks.

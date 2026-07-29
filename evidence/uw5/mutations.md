# UW5 executed mutation ledger

Every row was applied to production code, its named test was executed red, and the
production source was restored before the next row. The captured failure excerpts are
in [`mutations.log`](mutations.log).

| Row | Production mutation | Binding command/test | Observed red |
| --- | --- | --- | --- |
| M1 | Kaval `onDrain` silently succeeds | `kaval/daemonSurface.test.ts` direct drain | promise resolved instead of rejecting |
| M2 | `connectKaval` drops the pre-fragment honest-unknown projection | Padi connect identity pin | expected honest-unknown pair, received undefined |
| M3 | frozen production probe becomes catch-to-null | Padi fragment-only probe | expected a probe, received null |
| M4 | currency fold restores the old non-empty guard | client `kavalCurrency.test.ts` | expected stale, received none |
| M5 | Kaval drain sends `SIGTERM` before refusal | gated Kaval process test | post-refusal hello failed |
| M6 | structured missing-fragment arm returns null | gated yesterday-Kaval test | expected a probe, received null |
| M7 | terminal supervision closes sequentially | surface runtime supervision | runtime disposer was skipped |
| M8 | pre-fragment probe fabricates the local contract version | Padi observed-version pin | expected 5.4, received 5.3 |
| M9 | pre-fragment convergence trusts legacy build identity | same Padi probe pin | expected off-nix, received tempting legacy build |
| M10 | same-contract pre-fragment probe fabricates current build | Padi nudge pin | expected report-mismatch, received adopt |
| M11 | pre-fragment redial loses honest no-listener classification | Padi exit-between-redials pin | rejected ENOENT instead of resolving null |
| M12 | baked identity loses its joint-pair guard | surface-daemon baked identity tests | contradictory half-pairs stopped throwing |
| M13 | pre-fragment connection restores `identity: undefined` | Padi connect pin | expected honest-unknown pair, received undefined |
| M14 | client treats honest-unknown connected identity as warming | client daemon presentation | expected connected, received warming |
| M15 | client requires a non-empty reported key before nudging | client daemon presentation | expected stale, received none |
| M16 | client disables restart on connected presence | client daemon presentation | expected restart affordance true, received false |
| M17 | logger fixture returns to an unexcluded physical suffix | Padi closure equality test | logger test fixture entered the daemon hash |
| M18 | explicitly empty baked variables become off-nix | surface-daemon baked identity tests | explicit-empty case stopped throwing |
| M19 | Kaval connector loses its identity-pair validation | Padi half-present connect pin | partial identity connected instead of rejecting |
| M20 | Kaval handshake stops comparing boot instants | Padi dual-boot pin | contradictory boots connected instead of rejecting |
| M21 | connected-without-identity anomaly is demoted to warning | Padi reattach logging pin | expected one error log, received zero |
| W1-M1 | inventory returns build commit from legacy `system.version.identity` | tempting pre-fragment dual-truth pin | expected null, received legacy commit |
| W1-M2 | pre-fragment connection copies legacy identity | same tempting fixture | expected empty pair, received both legacy values |
| W1-M3 | shared hello reader loses the identity-pair guard | reader-level half-pair table | all four contradictory payloads resolved |
| W1-M4 | real status probe catches every error to `EMPTY_PROBE` | half-present current Kaval | resolved all-null row instead of rejecting |
| W1-M5 | inventory orchestration catches injected probe errors | throwing scan seam | resolved plausible null row instead of rejecting |

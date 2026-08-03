# fix-restore-race — the darwin e2e "restored active tile" failure

**Failure.** `ci::e2e@aarch64-darwin` (sha `0ad95e7`), scenario *Restored multi-tile
session preserves active terminal and centers viewport*
(`features/session-restore.feature:46`), failed BOTH retries at "the active canvas
tile should match the saved-session second tile" — a 20 s `waitForFunction` timeout.
507/508 other darwin scenarios passed. The same scenario flaked once on a loaded
Linux box and re-ran clean in isolation.

## Root cause — the racing pair

A restore delivers its result on **two independently timed channels**, and the client
seeded the active tile from the slower one:

| channel | what it carries | when it publishes |
| --- | --- | --- |
| `terminals` collection | the freshly-spawned restored tiles | as each terminal spawns (`restoreRecord`, synchronous) |
| `session` cell | the blob whose `activeTerminalId` names the active tile | after `saveSession` → padi's Conf → a **synchronous disk write** |

`restoreSession` writes the terminals first and the session blob second, so the
adverse ordering is the *default* server-side emission order. The client normally
survived it only because the session frame needs no round trip while each terminal's
metadata subscription does — the blob usually wins by an RTT. Put the host under IO
load (a loaded aarch64-darwin runner) and that disk write outlasts the metadata round
trips.

When it does, `useSessionRestore`'s hydration effect sees the full restored set while
still holding the blob it just **consumed** — whose `activeTerminalId` names a
pre-restore id that no longer exists. The membership check
(`serverActiveId && topIds.includes(serverActiveId)`) fails, `picked` silently falls
back to `topIds[0]` — the FIRST tile — and `markSeeded()` latches. A lost write, not
a slow one: no later push can repair it, which is why the step polled for the full
20 s on every attempt.

Not B3's Z1/Z2 rewiring and not B8b's `onTileAction` fix — both were ruled out; the
seam predates the campaign and the campaign only shifted the timing.

## Fix — the answer rides the call

`session.restore` now **answers** with the active-terminal marker it settled on
(padi surface `5.1`, additive minor). `handleRestoreSession` pins that answer on the
host's restore latch, and the hydration effect waits for the call to answer
(`if (isRestoring()) return`) instead of racing the blob. Ordering became structural:
the answer cannot arrive after the terminals it describes.

- `packages/padi/src/session/sessionRestore.ts` — `restoreSession` returns
  `{ activeTerminalId }`, read back from its ONE writer (`getActiveTerminalId`).
- `packages/padi/src/surface.ts` — `PadiSessionRestoreOutputSchema`,
  `PADI_SURFACE_VERSION` 5.0 → 5.1 with the rationale paragraph.
  `session.import` deliberately untouched (it seeds no view).
- `packages/client/src/hostScope/createSessionRestore.ts` — the latch parks the
  answer as a BOX (`{ id: null }` "host holds none" ≠ `null` "no restore answered");
  `markSeeded` spends it.
- `packages/client/src/terminal/useSessionRestore.ts` — the in-flight gate, and the
  seed prefers the pinned answer over the persisted marker.
- `packages/tests/step_definitions/session_restore_steps.ts` + `support/world.ts` —
  a latent harness defect with the same symptom: the restore-card self-heal re-POST
  passed only the terminal list, and `test__set` writes the WHOLE blob, so an omitted
  `activeTerminalId` decoded to `null` and ERASED the marker under test. Now stashed
  and replayed like `savedAt`.

## Evidence

- **Seam test** (`useSessionRestore.test.ts` — "the restored active tile does NOT
  ride the session-cell echo"): drives the adverse ordering directly. Pre-fix it
  seeds `new-0`; post-fix `new-1`.
- **E2E reproduction** (temporary, not committed): a WebSocket init script delaying
  EVERY `session/get` chunk by 1500 ms. With the client fix reverted the scenario
  fails at exactly the CI step with exactly the CI symptom
  (`page.waitForFunction: Timeout 20000ms exceeded`); with the fix it passes in 9 s.

## Gates

| gate | result |
| --- | --- |
| seam test + latch tests | green (red when reverted) |
| `features/session-restore.feature` ×2 | 9/9, 9/9 |
| `features/kill.feature` + `reconnect.feature` | 7/7 |
| `just test-unit` (all packages) | green |
| `pnpm typecheck` | green |
| `just test-e2e-governance` | green |
| `just lint` / `just fmt-check` | green |

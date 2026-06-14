/** Guards the "App.tsx is a thin layout shell" invariant (#1340). App.tsx
 *  mounts layout and composes domain singletons — it must not OWN domain state.
 *  New reactive primitives (createSignal / createMemo / createEffect) in the
 *  shell are the canary for state that belongs in a `useXxx.ts` singleton.
 *
 *  This is the CI-enforced half of the `app-shell-stays-thin` code-police rule
 *  (.agency/code-police.md). If this fails because you added reactive state to
 *  App.tsx: move it into a domain `useXxx.ts` singleton (the pattern every
 *  other consumer follows) rather than bumping the budget. Bump the budget ONLY
 *  for genuinely layout-level reactive state, and say why in the PR — the bump
 *  is the deliberate, reviewable exception, not a silent ratchet. */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_SRC = readFileSync(
  fileURLToPath(new URL("./App.tsx", import.meta.url)),
  "utf8",
);

/** Reactive primitives the shell is allowed to hold. At the #1340 thin-shell
 *  baseline App.tsx holds exactly three: `closeConfirmTarget` (the one dialog
 *  whose open-state it owns), `workspaceEntries`, and the `canvasMode` memo —
 *  all layout / command wiring. Domain state goes in a singleton, not here. */
const REACTIVE_PRIMITIVE_BUDGET = 3;

describe("App.tsx thin-shell invariant (#1340)", () => {
  it(`holds at most ${REACTIVE_PRIMITIVE_BUDGET} reactive primitives`, () => {
    // Matches `createSignal(`, `createSignal<T>(`, and the Memo/Effect forms;
    // the bare import names (followed by `,`) don't match.
    const matches = APP_SRC.match(/\bcreate(Signal|Memo|Effect)\s*[(<]/g) ?? [];
    expect(matches.length).toBeLessThanOrEqual(REACTIVE_PRIMITIVE_BUDGET);
  });
});

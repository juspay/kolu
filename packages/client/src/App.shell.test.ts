/// <reference types="node" />

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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Resolve via `fileURLToPath(import.meta.url)` + `node:path` (not `new URL(…,
// import.meta.url)`): under the `happy-dom` test env the GLOBAL `URL` is the
// browser one, which rejects a `file:` base — so build the path from the module's
// own file URL instead.
const APP_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "App.tsx"),
  "utf8",
);
const RESOLVER_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "kaval/canvasModeResolver.ts"),
  "utf8",
);

/** Reactive primitives the shell is allowed to hold. At the #1340 thin-shell
 *  baseline App.tsx holds two: `closeConfirmTarget` (the one dialog whose
 *  open-state it owns) and the `canvasMode` memo — layout / command wiring.
 *  `workspaceEntries` left with the retired WorkspaceGrid switcher. Domain
 *  state goes in a singleton, not here. */
const REACTIVE_PRIMITIVE_BUDGET = 2;

describe("App.tsx thin-shell invariant (#1340)", () => {
  it(`holds at most ${REACTIVE_PRIMITIVE_BUDGET} reactive primitives`, () => {
    // Matches the call forms `createSignal(`, `createSignal<T>(`, the
    // Memo/Effect/Store/Resource variants, and `makePersisted(` — the
    // reactive-state introducers this codebase reaches for; the bare import
    // names (followed by `,`) don't match.
    //
    // This is a source-token tripwire, not a fence. A `createSignal` hoisted to
    // MODULE scope just above the component reads as in-shell ownership (the
    // exact drift the budget guards) but the regex can't distinguish it from an
    // in-component one. Treat a budget bump as a prompt to look at the diff, not
    // a license to grow the shell's state.
    const matches =
      APP_SRC.match(
        /\bcreate(Signal|Memo|Effect|Store|Resource)\s*[(<]|\bmakePersisted\s*\(/g,
      ) ?? [];
    expect(matches.length).toBeLessThanOrEqual(REACTIVE_PRIMITIVE_BUDGET);
  });
});

/** #1763 — the canvas `<Switch>` has NO fallback arm (see the comment above it in
 *  App.tsx), so a `CanvasMode` kind with no `<Match>` renders BLANK. This is a
 *  SOURCE-LEVEL tripwire (the App.shell idiom) rather than a whole-App render harness:
 *  every kind the resolver's `CanvasMode` union can emit must be wired in App.tsx —
 *  a new kind without a Match, or a deleted/miswired `boot-stalled` arm, fails HERE.
 *  This is the seam the per-component render pins can't reach (codex-debate F2). */
describe("App canvas <Switch> covers every CanvasMode kind (#1763 — no blank fallback)", () => {
  // The `CanvasMode` union's `kind` literals, from the resolver's own type/returns.
  const kinds = [
    ...new Set(
      [...RESOLVER_SRC.matchAll(/kind:\s*"([a-z-]+)"/g)].map((m) => m[1]),
    ),
  ];

  it("finds the non-trivial kind set (guards the extraction itself)", () => {
    expect(kinds).toEqual(
      expect.arrayContaining([
        "connecting",
        "boot-stalled",
        "workspace",
        "empty",
        "down",
        "host-failed",
        "warming",
      ]),
    );
  });

  it.each(kinds)("App wires a <Match>/narrowing for the %s kind", (kind) => {
    // Every arm keys on `mode().kind === "X"` (direct) or a narrowing helper's
    // `m.kind === "X"` (down/warming/host-failed/boot-stalled) — either way the
    // kind literal appears in an equality against the mode. A missing kind = blank.
    expect(APP_SRC).toContain(`=== "${kind}"`);
  });

  it("routes the boot-stalled kind specifically to <BootStalledCanvas>", () => {
    expect(APP_SRC).toMatch(/bootStalledRecovery\(\)/);
    expect(APP_SRC).toContain("<BootStalledCanvas");
  });
});

/**
 * Boot-adoption sweep — the `CompleteHostSweep` TYPE GATE.
 *
 * The round-1 bug was "save the session on PARTIAL host info": a per-host adopt that
 * could `saveSession` after reconciling only ITS host would converge the session and
 * DROP the not-yet-reconciled hosts' terminals. PR-0 makes that structurally
 * impossible: `adoptSurvivingHost` returns a `HostAdoptionResult` with no save in
 * scope, and `commitBootAdoption` (the ONLY place that seeds sleeping records + saves)
 * accepts ONLY a branded `CompleteHostSweep`, which only `completeSweep([...all host
 * results])` mints. Committing one host's result is a COMPILE error.
 *
 * The gate assertions are `@ts-expect-error` lines in blocks that are TYPE-CHECKED but
 * never RUN — the proof is that they fail to compile.
 */

import {
  LOCAL_LOCATION,
  type SavedSleepingTerminal,
} from "kolu-common/surface";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getTerminal, unregisterTerminal } from "../terminal-registry.ts";
import {
  __resetSurfaceCtxForTest,
  noopSurfaceCtxForTest,
  setSurfaceCtx,
} from "../surfaceCtx.ts";
import {
  __resetWorkspaceSurfaceCtxForTest,
  noopWorkspaceSurfaceCtxForTest,
  setWorkspaceSurfaceCtx,
} from "../workspaceSurfaceCtx.ts";
import {
  commitBootAdoption,
  completeSweep,
  type HostAdoptionResult,
} from "./reattach.ts";
import { hostScopes } from "./resolve.ts";

const SLEEP_ID = "55555555-5555-4555-8555-555555555555";

function localResult(
  sleepingRecords: SavedSleepingTerminal[] = [],
): HostAdoptionResult {
  const scope = hostScopes()[0];
  if (!scope) throw new Error("expected a local host scope");
  return { scope, adoptedCount: 0, sleepingRecords };
}

function sleepingRecord(): SavedSleepingTerminal {
  return {
    id: SLEEP_ID,
    state: "sleeping",
    sleptAt: 222,
    cwd: "/work/repo",
    git: null,
    pr: { kind: "absent" },
    location: LOCAL_LOCATION,
    lastActivityAt: 7,
    lastAgentCommand: "claude --model sonnet",
  };
}

beforeEach(() => {
  setSurfaceCtx(noopSurfaceCtxForTest());
  setWorkspaceSurfaceCtx(noopWorkspaceSurfaceCtxForTest());
});

afterEach(() => {
  unregisterTerminal(SLEEP_ID);
  __resetSurfaceCtxForTest();
  __resetWorkspaceSurfaceCtxForTest();
});

describe("commitBootAdoption — the CompleteHostSweep type gate", () => {
  it("REJECTS a single host's result at the type layer (the partial-save bug is unspellable)", () => {
    // Type-checked, never RUN — the assertion IS the compile error.
    function _commitOneHostResult(result: HostAdoptionResult): void {
      // @ts-expect-error — a HostAdoptionResult is NOT a CompleteHostSweep; committing
      // one host's result must be a type error so the session can't be saved on a
      // subset of hosts.
      commitBootAdoption(result);
    }
    // A bare {results, saved} literal can't fabricate the brand either.
    function _commitUnbrandedLiteral(): void {
      // @ts-expect-error — missing the `CompleteHostSweep` brand (a module-private
      // unique symbol), so a hand-built sweep is rejected — only `completeSweep` mints one.
      commitBootAdoption({ results: [], saved: null });
    }
    expect(typeof _commitOneHostResult).toBe("function");
    expect(typeof _commitUnbrandedLiteral).toBe("function");
  });

  it("ACCEPTS a sweep minted by completeSweep (the only mint path)", () => {
    // No @ts-expect-error here: this MUST compile — `completeSweep` of the gathered
    // results is the sanctioned commit input.
    commitBootAdoption(completeSweep([localResult()], null));
    // Empty sweep is a no-op converge (nothing seeded, no active marker, empty save).
    expect(getTerminal(SLEEP_ID)).toBeUndefined();
  });

  it("seeds every host's sleeping records when the complete sweep is committed", () => {
    // A sleeping record carried in a host's result is seeded dormant on commit —
    // routed to its own host (local here) through the façade.
    commitBootAdoption(completeSweep([localResult([sleepingRecord()])], null));
    expect(getTerminal(SLEEP_ID)?.meta.state).toBe("sleeping");
  });
});

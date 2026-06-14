/** Pins the canvas-surface precedence the App shell delegates to
 *  `resolveCanvasMode` (#1340 thin-shell extraction). The arm ORDER is
 *  load-bearing correctness — `down` and `warming` must each beat `empty` so a
 *  dead/degraded or restarting kaval never masquerades as "you have no
 *  terminals" (#1034 empty-canvas lie + restart-drain). Imports the pure
 *  resolver only, so the precedence is exercised without mounting the
 *  daemon-status subscription. */

import type { DaemonState } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { type CanvasFacts, resolveCanvasMode } from "./canvasModeResolver";

/** A fully "ready" snapshot — daemon up, session loaded, one terminal — that
 *  resolves to `workspace`. Each test overrides only the facts under test, so
 *  the precedence (not an incidental field) is what flips the outcome. */
function facts(overrides: Partial<CanvasFacts> = {}): CanvasFacts {
  return {
    isLoading: false,
    daemonPending: false,
    down: undefined,
    warming: false,
    warmingLabel: "Connecting…",
    daemonState: "connected",
    terminalCount: 1,
    ...overrides,
  };
}

describe("resolveCanvasMode precedence (#1340)", () => {
  it("connecting wins while the session is loading, regardless of all else", () => {
    expect(
      resolveCanvasMode(
        facts({
          isLoading: true,
          down: "dead",
          warming: true,
          terminalCount: 0,
        }),
      ),
    ).toEqual({ kind: "connecting" });
  });

  it("connecting wins while daemon status is still pending", () => {
    // The #1034 gate: pending must beat a not-yet-arrived `down`/empty so a
    // dead boot never flashes the normal empty workspace first.
    expect(
      resolveCanvasMode(facts({ daemonPending: true, terminalCount: 0 })),
    ).toEqual({ kind: "connecting" });
  });

  it("down beats empty and carries its dead/degraded sub-state", () => {
    expect(
      resolveCanvasMode(facts({ down: "dead", terminalCount: 0 })),
    ).toEqual({ kind: "down", state: "dead" });
    expect(
      resolveCanvasMode(facts({ down: "degraded", terminalCount: 5 })),
    ).toEqual({ kind: "down", state: "degraded" });
  });

  it("down beats warming when both are set", () => {
    expect(
      resolveCanvasMode(facts({ down: "degraded", warming: true })),
    ).toEqual({ kind: "down", state: "degraded" });
  });

  it("warming beats empty and carries its label + daemonState payload", () => {
    const daemonState: DaemonState = "restarting";
    expect(
      resolveCanvasMode(
        facts({
          warming: true,
          warmingLabel: "Restarting kaval…",
          daemonState,
          terminalCount: 0,
        }),
      ),
    ).toEqual({
      kind: "warming",
      label: "Restarting kaval…",
      daemonState: "restarting",
    });
  });

  it("warming preserves an undefined daemonState (pre-first-yield label)", () => {
    expect(
      resolveCanvasMode(facts({ warming: true, daemonState: undefined })),
    ).toMatchObject({ kind: "warming", daemonState: undefined });
  });

  it("empty wins once up and idle with zero terminals", () => {
    expect(resolveCanvasMode(facts({ terminalCount: 0 }))).toEqual({
      kind: "empty",
    });
  });

  it("workspace is the ready default with terminals present", () => {
    expect(resolveCanvasMode(facts({ terminalCount: 3 }))).toEqual({
      kind: "workspace",
    });
  });
});

/**
 * The grid publish, driven the way `Terminal.tsx` drives it — through the REAL
 * `runAction` edge, so the toast these tests assert on is the one a user sees.
 *
 * kolu#2101 H1 (the lid-close field test). During the ~15s between a browser
 * waking and a remote host reconverging, every pane on that host re-measures and
 * republishes its grid. The relay answers with the correct, typed refusal —
 * `reServeSurface: procedure "lifecycle.resize" invoked with no live upstream
 * link` — which is deliberately UNTAGGED (`reServeSurface.ts`: a re-served
 * procedure's error schema is the AGENT's, so the refusal has no channel to
 * travel on) and therefore crosses as a DEFECT. A defect skips the action's own
 * `Effect.catch` entirely and lands at `runAction`'s edge, which reports it:
 *
 *     publish terminal grid failed unexpectedly: reServeSurface: procedure
 *     "lifecycle.resize" invoked with no live upstream link
 *
 * Three panes, three identical red toasts, for an expected transient that
 * self-heals. The gate below is on the client's OWN fact (is this terminal's
 * host entry `connected`?), never on the refusal's prose.
 */

import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAction } from "../runAction";
import { createGridPublisher, publishGridAction } from "./publishGrid";

const toastSpy = { error: vi.fn(), success: vi.fn() };
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: (...a: unknown[]) => toastSpy.success(...a),
    error: (...a: unknown[]) => toastSpy.error(...a),
    warning: () => {},
    info: () => {},
  }),
}));

/** The relay's refusal, verbatim (`reServeSurface.ts`'s
 *  `upstreamUnavailable`), raised the way it crosses the wire: as a DEFECT.
 *
 *  Reconstructed here rather than imported: the client must NOT depend on
 *  `@kolu/surface-remote`'s class or on this string — matching the refusal's
 *  prose client-side is exactly the coupling H1 refuses. The literal lives in
 *  the FIXTURE so a test can reproduce the incident's signature; the code under
 *  test never sees it. */
const REFUSAL =
  'reServeSurface: procedure "lifecycle.resize" invoked with no live upstream link';
const refusalDefect = () =>
  Effect.suspend<never, never, never>(() => {
    const err = new Error(REFUSAL);
    err.name = "UpstreamUnavailableError";
    throw err;
  });

/** Let the fire-and-forget fiber `runAction` forks reach its observer. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("publishGridAction", () => {
  beforeEach(() => {
    toastSpy.error.mockReset();
    vi.restoreAllMocks();
  });

  it("(a) host NOT connected + the relay's refusal → no toast, nothing escapes, one quiet log", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const resize = vi.fn(refusalDefect);

    runAction(
      "publish terminal grid",
      publishGridAction(
        { cols: 80, rows: 24 },
        {
          terminalId: "t1",
          hostState: () => "warming",
          ptyLive: () => true,
          resize,
        },
      ),
    );
    await settle();

    // The publish never happened, so the refusal was never provoked…
    expect(resize).not.toHaveBeenCalled();
    // …and nothing reached the user or the defect edge. PRE-FIX (this same test
    // against an ungated `publishGridAction`) this line reproduced the field
    // test's toast verbatim:
    //   publish terminal grid failed unexpectedly: reServeSurface: procedure
    //   "lifecycle.resize" invoked with no live upstream link
    expect(toastSpy.error.mock.calls).toEqual([]);
    expect(err).not.toHaveBeenCalled();
    // The suppression is SAID — quietly, once, naming the pane, the entry kind
    // and the grid.
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[0])).toContain("80×24");
    expect(String(info.mock.calls[0]?.[0])).toContain('"warming"');
  });

  it("(b) host connected + the SAME refusal → the toast still fires (the loud arm is untouched)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const resize = vi.fn(refusalDefect);

    runAction(
      "publish terminal grid",
      publishGridAction(
        { cols: 80, rows: 24 },
        {
          terminalId: "t1",
          hostState: () => "connected",
          ptyLive: () => true,
          resize,
        },
      ),
    );
    await settle();

    expect(resize).toHaveBeenCalledTimes(1);
    expect(toastSpy.error).toHaveBeenCalledTimes(1);
    // The incident's exact signature — the gate must not have widened into a
    // swallow of the error CLASS. A host the client believes is up that refuses
    // a resize is a real fault and stays loud.
    expect(String(toastSpy.error.mock.calls[0]?.[0])).toBe(
      `publish terminal grid failed unexpectedly: ${REFUSAL}`,
    );
  });

  it("(c) host connected + a healthy resize → the grid is published, no toast", async () => {
    const resize = vi.fn(() => Effect.succeed({ ok: true }));

    runAction(
      "publish terminal grid",
      publishGridAction(
        { cols: 132, rows: 43 },
        {
          terminalId: "t1",
          hostState: () => "connected",
          ptyLive: () => true,
          resize,
        },
      ),
    );
    await settle();

    expect(resize).toHaveBeenCalledWith({ cols: 132, rows: 43 });
    expect(toastSpy.error).not.toHaveBeenCalled();
  });

  it("a DECLARED resize failure on a connected host still toasts with its message", async () => {
    // The pre-existing arm, unchanged: a typed failure (not a defect) reaches
    // the action's own `Effect.catch`, which reports it next to the logic that
    // produced it (`.claude/rules/toast-conventions.md`).
    const resize = vi.fn(() => Effect.fail(new Error("kaval said no")));

    runAction(
      "publish terminal grid",
      publishGridAction(
        { cols: 80, rows: 24 },
        {
          terminalId: "t1",
          hostState: () => "connected",
          ptyLive: () => true,
          resize,
        },
      ),
    );
    await settle();

    expect(toastSpy.error).toHaveBeenCalledTimes(1);
    expect(String(toastSpy.error.mock.calls[0]?.[0])).toBe(
      "Terminal resize to 80×24 failed: kaval said no",
    );
  });

  // ── The suppressed publish is never re-fired (kolu#2101 K4) ─────────────
  //
  // H1's gate drops the publish while the host is not connected on the
  // argument that "the post-convergence re-attach restates it". The grid effect
  // fires once per GRID CHANGE, though, and nothing re-observes the host
  // returning to `connected` — so if the open attach produces no frame, no
  // failure and no end across the outage window (law-2 weather, or simply a
  // quiet pane), the drop is permanent. Measured pre-fix, driving exactly that:
  //
  //   pane measured          : 132×43
  //   pty grid during outage : 80×24 (resize calls: 0)
  //   pty grid AFTER the host flipped back to "connected": 80×24
  //   lifecycle.resize calls, total                      : 0
  //
  // Reachable on the LOCAL host too — `daemon.restart` drains it out of
  // `connected`.

  it("(K4) a grid suppressed while the host is down is re-published ONCE on the connected flip", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    /** The server-side PTY, as kaval holds it. */
    let ptyGrid = "80×24";
    let host = "connected";
    const resize = vi.fn((g: TerminalGrid) =>
      Effect.sync(() => {
        ptyGrid = `${g.cols}×${g.rows}`;
      }),
    );
    const publisher = createGridPublisher({
      terminalId: "t1",
      hostState: () => host,
      ptyLive: () => true,
      resize,
    });

    // The lid closes, then the user drags the split divider.
    host = "warming";
    runAction(
      "publish terminal grid",
      publisher.publish({ cols: 132, rows: 43 }),
    );
    await settle();
    expect(resize).not.toHaveBeenCalled();
    expect(ptyGrid).toBe("80×24");

    // The host reconverges. The attach is SILENT — no frame, no failure, no end
    // — so nothing re-opens it and, pre-fix, nothing ever restated the grid.
    host = "connected";
    runAction("publish terminal grid", publisher.republishSuppressed());
    await settle();
    expect(resize).toHaveBeenCalledTimes(1);
    expect(resize).toHaveBeenCalledWith({ cols: 132, rows: 43 });
    expect(ptyGrid).toBe("132×43");

    // ONCE. The effect re-runs on every host-state tick, and a second write of
    // the same grid must cost nothing.
    runAction("publish terminal grid", publisher.republishSuppressed());
    runAction("publish terminal grid", publisher.republishSuppressed());
    await settle();
    expect(resize).toHaveBeenCalledTimes(1);
  });

  it("(K4) a flip with nothing suppressed publishes nothing", async () => {
    const resize = vi.fn(() => Effect.succeed({ ok: true }));
    const publisher = createGridPublisher({
      terminalId: "t1",
      hostState: () => "connected",
      ptyLive: () => true,
      resize,
    });

    runAction("publish terminal grid", publisher.republishSuppressed());
    await settle();
    expect(resize).not.toHaveBeenCalled();
  });

  it("(K4) the latch carries the LAST suppressed grid, and a normal publish clears it", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    let host = "failed";
    const resize = vi.fn(() => Effect.succeed({ ok: true }));
    const publisher = createGridPublisher({
      terminalId: "t1",
      hostState: () => host,
      ptyLive: () => true,
      resize,
    });

    // Three suppressed measurements during one outage: only the last one
    // describes the pane, and replaying the earlier two would move the shared
    // PTY backwards.
    for (const cols of [100, 120, 132]) {
      runAction("publish terminal grid", publisher.publish({ cols, rows: 40 }));
    }
    await settle();

    host = "connected";
    runAction("publish terminal grid", publisher.republishSuppressed());
    await settle();
    expect(resize.mock.calls).toEqual([[{ cols: 132, rows: 40 }]]);

    // A publish that goes through normally supersedes the latch, so a LATER
    // flip cannot replay a grid the pane has already moved past.
    runAction(
      "publish terminal grid",
      publisher.publish({ cols: 80, rows: 24 }),
    );
    await settle();
    runAction("publish terminal grid", publisher.republishSuppressed());
    await settle();
    expect(resize.mock.calls).toEqual([
      [{ cols: 132, rows: 40 }],
      [{ cols: 80, rows: 24 }],
    ]);
  });

  it("a gone PTY eats the failure toast — the tile is tearing down anyway", async () => {
    const resize = vi.fn(() => Effect.fail(new Error("kaval said no")));

    runAction(
      "publish terminal grid",
      publishGridAction(
        { cols: 80, rows: 24 },
        {
          terminalId: "t1",
          hostState: () => "connected",
          ptyLive: () => false,
          resize,
        },
      ),
    );
    await settle();

    expect(toastSpy.error).not.toHaveBeenCalled();
  });
});

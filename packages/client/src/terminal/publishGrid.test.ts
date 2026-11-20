import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAction } from "../runAction";
import {
  createGridPublisher,
  GRID_SETTLE_MS,
  publishGridAction,
} from "./publishGrid";

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

const REFUSAL =
  'reServeSurface: procedure "lifecycle.resize" invoked with no live upstream link';
const refusalDefect = () =>
  Effect.suspend<never, never, never>(() => {
    const err = new Error(REFUSAL);
    err.name = "UpstreamUnavailableError";
    throw err;
  });

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

    expect(resize).not.toHaveBeenCalled();
    expect(toastSpy.error.mock.calls).toEqual([]);
    expect(err).not.toHaveBeenCalled();
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

describe("createGridPublisher", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function harness(init?: { host?: string }) {
    let host = init?.host ?? "connected";
    let ptyGrid = "80×24";
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
      run: (action) => {
        runAction("publish terminal grid", action);
      },
    });
    return {
      publisher,
      resize,
      ptyGrid: () => ptyGrid,
      setHost(next: string) {
        host = next;
      },
    };
  }

  it("publishes ONCE for a drag, carrying the grid the drag ended at", async () => {
    const h = harness();
    for (const cols of [120, 110, 100, 90, 80]) {
      h.publisher.publish({ cols, rows: 40 });
      await vi.advanceTimersByTimeAsync(40);
    }
    expect(h.resize).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(GRID_SETTLE_MS);
    expect(h.resize.mock.calls).toEqual([[{ cols: 80, rows: 40 }]]);
    expect(h.ptyGrid()).toBe("80×40");
  });

  it("publishes again once the pane moves after the window closed", async () => {
    const h = harness();
    h.publisher.publish({ cols: 80, rows: 24 });
    await vi.advanceTimersByTimeAsync(GRID_SETTLE_MS);
    h.publisher.publish({ cols: 132, rows: 43 });
    await vi.advanceTimersByTimeAsync(GRID_SETTLE_MS);
    expect(h.resize.mock.calls).toEqual([
      [{ cols: 80, rows: 24 }],
      [{ cols: 132, rows: 43 }],
    ]);
  });

  it("publishes nothing after cancel — a tile torn down, or hidden, mid-drag", async () => {
    const h = harness();
    h.publisher.publish({ cols: 132, rows: 43 });
    h.publisher.cancel();
    await vi.advanceTimersByTimeAsync(GRID_SETTLE_MS * 4);
    expect(h.resize).not.toHaveBeenCalled();
  });

  it("a cancel drops the pending publish, not the publisher", async () => {
    const h = harness();
    h.publisher.publish({ cols: 132, rows: 43 });
    h.publisher.cancel();
    await vi.advanceTimersByTimeAsync(GRID_SETTLE_MS * 4);

    h.publisher.publish({ cols: 100, rows: 30 });
    await vi.advanceTimersByTimeAsync(GRID_SETTLE_MS);
    expect(h.resize.mock.calls).toEqual([[{ cols: 100, rows: 30 }]]);
    expect(h.ptyGrid()).toBe("100×30");
  });

  it("(K4) a grid suppressed while the host is down is re-published ONCE on the connected flip", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const h = harness();

    h.setHost("warming");
    h.publisher.publish({ cols: 132, rows: 43 });
    await vi.advanceTimersByTimeAsync(GRID_SETTLE_MS);
    expect(h.resize).not.toHaveBeenCalled();
    expect(h.ptyGrid()).toBe("80×24");

    h.setHost("connected");
    h.publisher.republishSuppressed();
    expect(h.resize).toHaveBeenCalledTimes(1);
    expect(h.resize).toHaveBeenCalledWith({ cols: 132, rows: 43 });
    expect(h.ptyGrid()).toBe("132×43");

    h.publisher.republishSuppressed();
    h.publisher.republishSuppressed();
    expect(h.resize).toHaveBeenCalledTimes(1);
  });

  it("(K4) a flip with nothing suppressed publishes nothing", () => {
    const h = harness();
    h.publisher.republishSuppressed();
    expect(h.resize).not.toHaveBeenCalled();
  });

  it("(K4) the latch carries the LAST suppressed grid, and a normal publish clears it", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const h = harness({ host: "failed" });

    for (const cols of [100, 120, 132]) {
      h.publisher.publish({ cols, rows: 40 });
      await vi.advanceTimersByTimeAsync(GRID_SETTLE_MS);
    }

    h.setHost("connected");
    h.publisher.republishSuppressed();
    expect(h.resize.mock.calls).toEqual([[{ cols: 132, rows: 40 }]]);

    h.publisher.publish({ cols: 80, rows: 24 });
    await vi.advanceTimersByTimeAsync(GRID_SETTLE_MS);
    h.publisher.republishSuppressed();
    expect(h.resize.mock.calls).toEqual([
      [{ cols: 132, rows: 40 }],
      [{ cols: 80, rows: 24 }],
    ]);
  });

  it("(K4) a host that flips back MID-WINDOW still gets the grid, once", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const h = harness({ host: "warming" });

    h.publisher.publish({ cols: 132, rows: 43 });
    await vi.advanceTimersByTimeAsync(GRID_SETTLE_MS / 2);
    h.setHost("connected");
    h.publisher.republishSuppressed();
    expect(h.resize).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(GRID_SETTLE_MS);
    expect(h.resize.mock.calls).toEqual([[{ cols: 132, rows: 43 }]]);
    h.publisher.republishSuppressed();
    expect(h.resize).toHaveBeenCalledTimes(1);
  });

  it("(K4) a suppressed settled publish re-latches, and converges on the next flip", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const h = harness({ host: "connected" });

    h.publisher.publish({ cols: 100, rows: 30 });
    await vi.advanceTimersByTimeAsync(GRID_SETTLE_MS);
    expect(h.resize).toHaveBeenCalledTimes(1);

    h.setHost("warming");
    h.publisher.publish({ cols: 132, rows: 43 });
    await vi.advanceTimersByTimeAsync(GRID_SETTLE_MS);
    expect(h.resize).toHaveBeenCalledTimes(1);

    h.setHost("connected");
    h.publisher.republishSuppressed();
    expect(h.resize.mock.calls).toEqual([
      [{ cols: 100, rows: 30 }],
      [{ cols: 132, rows: 43 }],
    ]);
  });
});

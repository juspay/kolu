/** THE CANVAS MEMO HOLDS STILL WHILE THE CANVAS DOES.
 *
 *  `canvasMode` reads the 1 s monotonic tick unconditionally (boot-deadline accrual),
 *  so a steady workspace re-resolves every second and mints an equal-but-new arm. This
 *  drives a REAL `createMemo` with `sameCanvasMode` as its `equals`, over a real clock
 *  signal and the real resolver — App's own shape (`App.tsx`) without mounting App —
 *  and holds a subscriber against it:
 *
 *   - four ticks in a steady state publish nothing, and (via `@kolu/solid-test-setup`,
 *     which fails a test on any Solid dev diagnostic) raise no `UNSTABLE_MEMO_OUTPUT`;
 *   - every kind transition, and every payload change, still publishes.
 *
 *  Only `../wire`, `./useDaemonStatus` and the clock are stubbed — the same seam
 *  `useCanvasMode.test.ts` stubs, for the same reason. */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
} from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DaemonDownState } from "./daemonPresentation";

const h = vi.hoisted(() => ({
  /** The monotonic clock, as a REACTIVE read: the test's signal, installed below. */
  read: (() => 0) as () => number,
  entryKind: "connected" as "not-a-member" | "connected" | "warming",
  members: [{ kind: "local" }] as HostKey[],
  down: undefined as DaemonDownState | undefined,
  warming: false,
}));

vi.mock("../wire", () => ({
  activeHost: () => LOCAL_HOST,
  connectionInfo: () => undefined,
  hostKeys: () => h.members,
  padiMap: { live: () => true },
}));
vi.mock("../time/clock", () => ({
  getMonotonicNow: () => () => h.read(),
}));
vi.mock("./useDaemonStatus", () => ({
  activeEntryState: () => ({ kind: h.entryKind }),
  daemonStatusPending: () => false,
  isActiveHostLocal: () => true,
  daemonChannelLive: () => true,
  daemonWarming: () => h.warming,
  downState: () => h.down,
  localDaemonStatus: () => undefined,
}));

// Deferred imports, not static ones: the modules under test read the three mocks
// above at module scope, so they must not evaluate before `vi.mock` is installed —
// the same ordering `useCanvasMode.test.ts` keeps.
const { canvasMode } = await import("./useCanvasMode");
const { sameCanvasMode } = await import("./sameCanvasMode");
const { resetBootAnchors } = await import("./bootDeadline");
const { resetConnectTails } = await import("./connectTailClock");

/** App's memo, to the letter (`App.tsx`), over facts the test owns. */
const harness = () => {
  const [now, setNow] = createSignal(0);
  h.read = now;
  const [terminalCount, setTerminalCount] = createSignal(1);
  const published: string[] = [];
  const dispose = createRoot((disposer) => {
    const mode = createMemo(
      () =>
        canvasMode({
          isLoading: () => false,
          terminalCount,
          recordsAwaited: () => 0,
        }),
      { equals: sameCanvasMode },
    );
    createEffect(
      () => mode(),
      (value) => {
        published.push(value.kind);
      },
    );
    return disposer;
  });
  flush();
  return {
    published,
    dispose,
    setTerminalCount: (count: number) => {
      setTerminalCount(count);
      flush();
    },
    /** One second of wall time, as the shared clock delivers it. */
    tick: (times = 1) => {
      for (let at = 0; at < times; at += 1) {
        setNow(now() + 1_000);
        flush();
      }
    },
  };
};

beforeEach(() => {
  resetBootAnchors();
  resetConnectTails();
  h.entryKind = "connected";
  h.members = [{ kind: "local" }];
  h.down = undefined;
  h.warming = false;
  // The per-host tail/anchor maps are keyed by the active host; nothing else is.
  expect(encodeHostKey(LOCAL_HOST)).toBe("local");
});

describe("the canvas memo under a ticking clock", () => {
  it("publishes nothing across four clock ticks in a steady workspace", () => {
    const run = harness();
    expect(run.published).toEqual(["workspace"]);

    run.tick(4);

    expect(run.published).toEqual(["workspace"]);
    run.dispose();
  });

  it("publishes nothing across four ticks on a payload-bearing arm whose payload holds", () => {
    // ONE down verdict object, re-served every tick — the way `downState()` serves it.
    h.down = { state: "degraded" };
    const run = harness();
    expect(run.published).toEqual(["down"]);

    run.tick(4);

    expect(run.published).toEqual(["down"]);
    run.dispose();
  });

  it("still publishes every kind transition", () => {
    const run = harness();
    run.tick(2);
    expect(run.published).toEqual(["workspace"]);

    // workspace → empty: the last tile goes.
    run.setTerminalCount(0);
    expect(run.published).toEqual(["workspace", "empty"]);

    // empty → down: the daemon dies.
    h.down = { state: "dead" };
    run.tick();
    expect(run.published).toEqual(["workspace", "empty", "down"]);

    // down → empty again: it comes back.
    h.down = undefined;
    run.tick();
    expect(run.published).toEqual(["workspace", "empty", "down", "empty"]);
    run.dispose();
  });

  it("still publishes a payload change inside one kind", () => {
    h.down = { state: "degraded" };
    const run = harness();
    expect(run.published).toEqual(["down"]);

    // Same arm, a different verdict — the restart affordance turns on it.
    h.down = { state: "dead" };
    run.tick();

    expect(run.published).toEqual(["down", "down"]);
    run.dispose();
  });
});

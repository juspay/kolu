// @vitest-environment happy-dom

/** The in-flight entry's LIFETIME: it may not outlive its write.
 *
 *  The read rule (`savedSplitOf`) and the settle rule (`settleSplitPending`)
 *  are pinned as pure functions in `splitPanelState.test.ts`. This drives the
 *  real store against a controllable record and a controllable server, because
 *  the three ways an entry ends are each a sequence — a write answering, a
 *  record moving — and not a value.
 */

import { Deferred, Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  /** The `setSubPanel` calls the store has made, in order, each parked on its
   *  own gate — the Effect spelling of "the server has not answered yet". */
  pendingWrites: [] as Array<Deferred.Deferred<void, Error>>,
  setSubPanel: vi.fn(),
  toastError: vi.fn(),
}));

h.setSubPanel.mockImplementation(() => {
  const gate = Deferred.makeUnsafe<void, Error>();
  h.pendingWrites.push(gate);
  return Deferred.await(gate);
});

const record = createRoot(() => {
  const [value, setValue] = createSignal<
    { subPanel?: { collapsed: boolean; panelSize: number } } | undefined
  >(undefined);
  return { value, setValue };
});

vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () => ({
    wire: { terminals: { byKey: () => record.value } },
  }),
}));

vi.mock("../wire", () => ({
  activePadiRpc: { chrome: { setSubPanel: h.setSubPanel } },
}));

vi.mock("solid-sonner", () => ({
  toast: { error: h.toastError },
}));

import { useSplitPanelState } from "./splitPanelState";

const T = "split-store-tile" as TerminalId;
const OPEN_30 = { collapsed: false, panelSize: 0.3 } as const;
const COLLAPSED = { collapsed: true, panelSize: 0.3 } as const;
const DRAG_A = { collapsed: false, panelSize: 0.4 } as const;
const DRAG_B = { collapsed: false, panelSize: 0.55 } as const;
const FOREIGN = { collapsed: false, panelSize: 0.8 } as const;

/** Answer the oldest outstanding write — the order the server replies in —
 *  and let the fiber that was parked on it run to its completion callback.
 *  Awaiting the gate's own settle is the signal, not a duration. */
async function answerWrite(ok: boolean): Promise<void> {
  const gate = h.pendingWrites.shift();
  if (!gate) throw new Error("no outstanding write to answer");
  await Effect.runPromise(
    ok
      ? Deferred.succeed(gate, undefined)
      : Deferred.fail(gate, new Error("refused")),
  );
  // One turn for the resumed fiber to run its `tap`/`catch` and settle the
  // store. The gate above is the wait; this is the scheduler's own queue.
  await Promise.resolve();
  await Promise.resolve();
}

describe("the split's in-flight entry cannot outlive its write", () => {
  beforeEach(() => {
    useSplitPanelState().forget(T);
    h.pendingWrites.length = 0;
    h.setSubPanel.mockClear();
    h.toastError.mockClear();
    record.setValue({ subPanel: { ...OPEN_30 } });
  });

  it("shows the gesture at once, and lets the record take over when it lands", async () => {
    const split = useSplitPanelState();
    split.write(T, COLLAPSED);
    expect(split.state(T)).toEqual(COLLAPSED);

    await answerWrite(true);
    // Still the gesture — the write landed but the record has not echoed yet,
    // and dropping the entry here would flash the old value.
    expect(split.state(T)).toEqual(COLLAPSED);

    record.setValue({ subPanel: { ...COLLAPSED } });
    expect(split.state(T)).toEqual(COLLAPSED);
    // …and the entry is gone, so the record is the source again: a later
    // change reaches this tile.
    record.setValue({ subPanel: { ...FOREIGN } });
    expect(split.state(T)).toEqual(FOREIGN);
  });

  it("A FAILED write reverts to the record", async () => {
    const split = useSplitPanelState();
    split.write(T, COLLAPSED);
    expect(split.state(T)).toEqual(COLLAPSED);

    await answerWrite(false);

    // Nothing was saved, so nothing may be shown as saved — the tile must not
    // sit on a collapse the server never took, which the next reload would
    // then silently undo.
    expect(split.state(T)).toEqual(OPEN_30);
    expect(h.toastError).toHaveBeenCalledOnce();
  });

  it("A FOREIGN value wins once our writes are acknowledged", async () => {
    const split = useSplitPanelState();
    split.write(T, COLLAPSED);
    await answerWrite(true);

    // Another browser (or an agent through MCP) writes something else, so the
    // record never comes to equal ours. Their value is the saved one.
    record.setValue({ subPanel: { ...FOREIGN } });
    expect(split.state(T)).toEqual(FOREIGN);
  });

  it("…but NOT while a write of ours is still outstanding", () => {
    const split = useSplitPanelState();
    split.write(T, COLLAPSED);

    // An echo of some earlier state arriving mid-write is not somebody else's
    // value; it is the past. The gesture stands.
    record.setValue({ subPanel: { ...FOREIGN } });
    expect(split.state(T)).toEqual(COLLAPSED);
  });

  it("A DRAG does not jitter: an older echo never pulls the divider back", async () => {
    const split = useSplitPanelState();
    split.write(T, DRAG_A);
    split.write(T, DRAG_B);
    expect(split.state(T)).toEqual(DRAG_B);

    // The first write answers and its echo lands, while the second is still
    // outstanding. The divider must stay where the user left it.
    await answerWrite(true);
    record.setValue({ subPanel: { ...DRAG_A } });
    expect(split.state(T)).toEqual(DRAG_B);

    // The second answers; its echo is still behind it on the same socket, so
    // the stale record must not count as "moved on" either.
    await answerWrite(true);
    expect(split.state(T)).toEqual(DRAG_B);

    record.setValue({ subPanel: { ...DRAG_B } });
    expect(split.state(T)).toEqual(DRAG_B);
  });

  it("a failure with a newer write still outstanding leaves the newer one standing", async () => {
    const split = useSplitPanelState();
    split.write(T, DRAG_A);
    split.write(T, DRAG_B);

    await answerWrite(false);
    // The failed write is superseded by one that has not answered: reverting
    // here would show a value older than what the user is still asking for.
    expect(split.state(T)).toEqual(DRAG_B);

    await answerWrite(false);
    expect(split.state(T)).toEqual(OPEN_30);
  });
});

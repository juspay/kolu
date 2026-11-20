// @vitest-environment happy-dom

import { Deferred, Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
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

async function answerWrite(ok: boolean): Promise<void> {
  const gate = h.pendingWrites.shift();
  if (!gate) throw new Error("no outstanding write to answer");
  await Effect.runPromise(
    ok
      ? Deferred.succeed(gate, undefined)
      : Deferred.fail(gate, new Error("refused")),
  );
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
    expect(split.state(T)).toEqual(COLLAPSED);

    record.setValue({ subPanel: { ...COLLAPSED } });
    expect(split.state(T)).toEqual(COLLAPSED);
    record.setValue({ subPanel: { ...FOREIGN } });
    expect(split.state(T)).toEqual(FOREIGN);
  });

  it("A WRITE OF THE VALUE ALREADY SHOWN IS NOT A WRITE", () => {
    const split = useSplitPanelState();

    split.write(T, { ...OPEN_30 });
    expect(h.setSubPanel).not.toHaveBeenCalled();

    split.write(T, DRAG_A);
    expect(h.setSubPanel).toHaveBeenCalledOnce();
    split.write(T, { ...DRAG_A });
    expect(h.setSubPanel).toHaveBeenCalledOnce();

    split.write(T, DRAG_B);
    expect(h.setSubPanel).toHaveBeenCalledTimes(2);
    expect(split.state(T)).toEqual(DRAG_B);
  });

  it("A FAILED write reverts to the record", async () => {
    const split = useSplitPanelState();
    split.write(T, COLLAPSED);
    expect(split.state(T)).toEqual(COLLAPSED);

    await answerWrite(false);

    expect(split.state(T)).toEqual(OPEN_30);
    expect(h.toastError).toHaveBeenCalledOnce();
  });

  it("A FOREIGN value wins once our writes are acknowledged", async () => {
    const split = useSplitPanelState();
    split.write(T, COLLAPSED);
    await answerWrite(true);

    record.setValue({ subPanel: { ...FOREIGN } });
    expect(split.state(T)).toEqual(FOREIGN);
  });

  it("…but NOT while a write of ours is still outstanding", () => {
    const split = useSplitPanelState();
    split.write(T, COLLAPSED);

    record.setValue({ subPanel: { ...FOREIGN } });
    expect(split.state(T)).toEqual(COLLAPSED);
  });

  it("A DRAG does not jitter: an older echo never pulls the divider back", async () => {
    const split = useSplitPanelState();
    split.write(T, DRAG_A);
    split.write(T, DRAG_B);
    expect(split.state(T)).toEqual(DRAG_B);

    await answerWrite(true);
    record.setValue({ subPanel: { ...DRAG_A } });
    expect(split.state(T)).toEqual(DRAG_B);

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
    expect(split.state(T)).toEqual(DRAG_B);

    await answerWrite(false);
    expect(split.state(T)).toEqual(OPEN_30);
  });
});

import type { TerminalId } from "kolu-common/surface";
import { createComputed, createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it } from "vitest";
import {
  registerHostAttention,
  liveAskingTotal,
  type HostMarks,
  hostFrame,
  terminalClass,
  writeHostMarks,
} from "./attentionMarks";

const HOST = "local";
const A = "t-a" as TerminalId;

let dropHost: (() => void) | undefined;

beforeEach(() => {
  dropHost?.();
  dropHost = undefined;
  writeHostMarks(HOST, undefined);
});

function countReruns(fn: () => unknown, steps: readonly (() => void)[]) {
  return createRoot((dispose) => {
    let runs = 0;
    createComputed(() => {
      fn();
      runs += 1;
    });
    const after: number[] = [];
    for (const step of steps) {
      step();
      after.push(runs);
    }
    dispose();
    return after;
  });
}

function fixture(initial: Partial<Omit<HostMarks, "unseenFinished">> = {}) {
  const [frame, setFrame] = createSignal<Omit<HostMarks, "unseenFinished">>({
    byClass: { asking: [], working: [], linger: [], finished: [] },
    liveIds: [],
    live: true,
    reported: true,
    ...initial,
  });
  const [byClass, setByClass] = createSignal(frame().byClass);
  const [liveIds, setLiveIds] = createSignal(frame().liveIds);
  dropHost = registerHostAttention(HOST, {
    facts: () => ({
      get byClass() {
        return byClass();
      },
      get liveIds() {
        return liveIds();
      },
      get live() {
        return frame().live;
      },
      get reported() {
        return frame().reported;
      },
    }),
  });
  return (next: Partial<Omit<HostMarks, "unseenFinished">>) => {
    if (next.byClass) setByClass(next.byClass);
    if (next.liveIds) setLiveIds(next.liveIds);
    if (next.live !== undefined || next.reported !== undefined)
      setFrame((p) => ({ ...p, ...next }));
  };
}

describe("a class read does not wake on the live set", () => {
  it("holds still across byte-motion writes, then moves on a real class change", () => {
    const update = fixture({
      reported: true,
      byClass: { asking: [], working: [A], linger: [], finished: [] },
    });

    const after = countReruns(
      () => terminalClass(HOST, A),
      [
        () => update({ liveIds: [A] }),
        () => update({ liveIds: [] }),
        () => update({ liveIds: [A] }),
        () =>
          update({
            byClass: { asking: [A], working: [], linger: [], finished: [] },
          }),
      ],
    );

    expect(after.slice(0, 3)).toEqual([1, 1, 1]);
    expect(after[3]).toBe(2);
  });

  it("still reports the right class either way", () => {
    const update = fixture({
      reported: true,
      byClass: { asking: [], working: [A], linger: [], finished: [] },
      liveIds: [],
    });
    expect(terminalClass(HOST, A)).toBe("working");

    update({ liveIds: [A] });
    expect(terminalClass(HOST, A)).toBe("working");

    update({
      byClass: { asking: [A], working: [], linger: [], finished: [] },
    });
    expect(terminalClass(HOST, A)).toBe("asking");
  });

  it("leaves the untouched legs referentially identical, which is what carries it", () => {
    const update = fixture({
      reported: true,
      byClass: { asking: [], working: [A], linger: [], finished: [] },
    });
    const before = hostFrame(HOST).byClass;
    update({ liveIds: [A] });
    expect(hostFrame(HOST).byClass).toBe(before);
  });
});

it("badge counts registered live host facts and follows liveness", () => {
  const update = fixture({
    byClass: { asking: [A], working: [], linger: [], finished: [] },
  });
  expect(liveAskingTotal()).toBe(1);
  update({ live: false });
  expect(liveAskingTotal()).toBe(0);
  update({
    live: true,
    byClass: { asking: [], working: [], linger: [], finished: [] },
  });
  expect(liveAskingTotal()).toBe(0);
});

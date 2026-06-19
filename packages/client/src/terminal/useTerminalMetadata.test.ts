import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";

// `useTerminalMetadata` pulls `app` (a live surface socket) and `solid-sonner`
// (a toast DOM) at import time. Stub both so the hook loads under Node, and
// drive the per-key metadata collection through a plain hoisted bag — flipping
// a field or the id set lets a test observe the `terminalIds` memo directly.
type TestMeta = { parentId?: TerminalId } & Record<string, unknown>;
const bag = vi.hoisted(() => ({
  keys: [] as TerminalId[],
  meta: new Map<TerminalId, TestMeta>(),
}));

vi.mock("../wire", () => ({
  app: {
    collections: {
      terminalMetadata: {
        use: () => ({
          keys: () => bag.keys,
          byKey: (id: TerminalId) =>
            bag.meta.has(id) ? () => bag.meta.get(id) : undefined,
        }),
      },
    },
  },
}));
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: () => {},
    error: () => {},
    warning: () => {},
    info: () => {},
  }),
}));

import { sameTerminalIdOrder } from "./useTerminalMetadata";

const tids = (...xs: string[]) => xs as TerminalId[];

describe("sameTerminalIdOrder", () => {
  it("is true for the same ids in the same order", () => {
    expect(sameTerminalIdOrder(tids("a", "b", "c"), tids("a", "b", "c"))).toBe(
      true,
    );
  });

  it("is true for two empty lists", () => {
    expect(sameTerminalIdOrder(tids(), tids())).toBe(true);
  });

  it("is false when the order differs (position labels depend on order)", () => {
    expect(sameTerminalIdOrder(tids("a", "b"), tids("b", "a"))).toBe(false);
  });

  it("is false when an id is added", () => {
    expect(sameTerminalIdOrder(tids("a", "b"), tids("a", "b", "c"))).toBe(
      false,
    );
  });

  it("is false when an id is removed", () => {
    expect(sameTerminalIdOrder(tids("a", "b", "c"), tids("a", "b"))).toBe(
      false,
    );
  });

  it("is false when an id is swapped for another", () => {
    expect(sameTerminalIdOrder(tids("a", "b"), tids("a", "x"))).toBe(false);
  });
});

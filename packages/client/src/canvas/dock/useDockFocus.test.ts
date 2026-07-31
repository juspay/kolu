import type { TerminalId } from "kolu-common/surface";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getMetadata: vi.fn(),
  focusTerminal: vi.fn(),
  warning: vi.fn(),
}));

vi.mock("../../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    getMetadata: h.getMetadata,
    focusTerminal: h.focusTerminal,
  }),
}));

vi.mock("solid-sonner", () => ({ toast: { warning: h.warning } }));

import { useDockFocus } from "./useDockFocus";

const ID = "dock-focus-test" as TerminalId;

describe("useDockFocus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("surfaces a stale external target without calling the invariant-strict store", () => {
    h.getMetadata.mockReturnValue(undefined);

    useDockFocus()(ID);

    expect(h.focusTerminal).not.toHaveBeenCalled();
    expect(h.warning).toHaveBeenCalledExactlyOnceWith(
      "Terminal no longer exists",
    );
  });

  it("lands a live terminal", () => {
    h.getMetadata.mockReturnValue({ id: ID, parentId: null });

    useDockFocus()(ID);

    expect(h.focusTerminal).toHaveBeenCalledExactlyOnceWith(ID);
    expect(h.warning).not.toHaveBeenCalled();
  });
});

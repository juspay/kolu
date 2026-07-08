import { beforeEach, describe, expect, it, vi } from "vitest";

// `importSessionAction` imports `toast` from `solid-sonner`, which pulls the
// SSR `solid-js/web` build under the node runner. Mock it and capture the three
// variants we assert on. `vi.hoisted` makes the spies available inside the
// hoisted `vi.mock` factory.
const { loading, success, error } = vi.hoisted(() => ({
  loading: vi.fn(() => "toast-id"),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("solid-sonner", () => ({ toast: { loading, success, error } }));

import type { SavedSession } from "@kolu/padi/surface";
import { createImportSessionAction } from "./importSessionAction";

// A minimal valid session — the action only reads `terminals.length`.
// `activeTerminalId` is the collapsed single-absence form (`.nullable()`,
// never `.optional()`) — a literal built without `.parse()` must name it.
const session: SavedSession = {
  terminals: [],
  activeTerminalId: null,
  savedAt: 1,
};

describe("createImportSessionAction", () => {
  beforeEach(() => {
    loading.mockClear();
    success.mockClear();
    error.mockClear();
  });

  it("surfaces a toast.error carrying the server message when the import RPC rejects", async () => {
    // Proves Fix 1: without the loading→error round-trip (the old fire-and-forget
    // path), this rejection is unhandled and no error toast ever fires.
    const run = createImportSessionAction({
      pick: async () => session,
      runImport: async () => {
        throw new Error("disk full");
      },
    });

    await run();

    expect(loading).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith("Import failed: disk full", {
      id: "toast-id",
    });
    expect(success).not.toHaveBeenCalled();
  });

  it("is a no-op on a second invoke while an import is in flight (re-entry guard)", async () => {
    // Proves the guard: without it, both invokes pick + import, duplicating the
    // restored terminals.
    let resolveImport: (() => void) | undefined;
    const runImport = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveImport = resolve;
        }),
    );
    const pick = vi.fn(async () => session);
    const run = createImportSessionAction({ pick, runImport });

    const first = run(); // enters, sets inFlight synchronously
    const second = run(); // guard: returns immediately

    // Let the first invoke's pick resolve and reach runImport.
    await Promise.resolve();
    await Promise.resolve();

    expect(pick).toHaveBeenCalledOnce();
    expect(runImport).toHaveBeenCalledOnce();

    resolveImport?.();
    await first;
    await second;
  });

  it("does not toast when the picker is cancelled", async () => {
    const run = createImportSessionAction({
      pick: async () => null,
      runImport: vi.fn(),
    });

    await run();

    expect(loading).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

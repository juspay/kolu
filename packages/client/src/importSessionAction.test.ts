import { Deferred, Effect, Fiber } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loading, success, error } = vi.hoisted(() => ({
  loading: vi.fn(() => "toast-id"),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("solid-sonner", () => ({ toast: { loading, success, error } }));

import type { SavedSession } from "@kolu/padi-client/surface";
import { createImportSessionAction } from "./importSessionAction";

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

  it("surfaces a toast.error carrying the server message when the import RPC fails", async () => {
    const run = createImportSessionAction({
      pick: () => Effect.succeed(session),
      runImport: () => Effect.fail(new Error("disk full")),
    });

    await Effect.runPromise(run());

    expect(loading).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith("Import failed: disk full", {
      id: "toast-id",
    });
    expect(success).not.toHaveBeenCalled();
  });

  it("is a no-op on a second invoke while an import is in flight (re-entry guard)", async () => {
    const gate = Deferred.makeUnsafe<void>();
    const runImport = vi.fn(() => Deferred.await(gate));
    const pick = vi.fn(() => Effect.succeed(session));
    const run = createImportSessionAction({ pick, runImport });

    const first = Effect.runFork(run());
    const second = Effect.runFork(run());

    expect(pick).toHaveBeenCalledOnce();
    expect(runImport).toHaveBeenCalledOnce();

    await Effect.runPromise(Deferred.succeed(gate, undefined));
    await Effect.runPromise(Fiber.join(first));
    await Effect.runPromise(Fiber.join(second));
  });

  it("does not toast when the picker is cancelled", async () => {
    const run = createImportSessionAction({
      pick: () => Effect.succeed(null),
      runImport: vi.fn(),
    });

    await Effect.runPromise(run());

    expect(loading).not.toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

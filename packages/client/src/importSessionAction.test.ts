import { Deferred, Effect, Fiber } from "effect";
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

  it("surfaces a toast.error carrying the server message when the import RPC fails", async () => {
    // Proves Fix 1: without the loading→error round-trip (the old fire-and-forget
    // path), this failure is unhandled and no error toast ever fires.
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
    // Proves the guard: without it, both invokes pick + import, duplicating the
    // restored terminals. The in-flight import parks on a `Deferred` — the
    // Effect spelling of the old hand-held `resolve` — so the second invoke is
    // observed while the first is genuinely suspended.
    const gate = Deferred.makeUnsafe<void>();
    const runImport = vi.fn(() => Deferred.await(gate));
    const pick = vi.fn(() => Effect.succeed(session));
    const run = createImportSessionAction({ pick, runImport });

    // `runFork` runs on THIS stack until the effect suspends, so the guard is
    // armed and `runImport` reached before the second invoke is even built.
    const first = Effect.runFork(run());
    const second = Effect.runFork(run()); // guard: returns immediately

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

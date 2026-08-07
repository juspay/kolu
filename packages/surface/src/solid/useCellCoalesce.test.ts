import { Effect } from "effect";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { StreamingProcedure } from "../client";
import type { Cell } from "../index";
import { useCell } from "./useCell";

/** Minimal preferences-shaped cell to exercise `coalesceMs`. Mirrors the
 *  real preferences cell: a spread-merge `applyPatch`, local authority, and
 *  a mutate spy standing in for the server RPC. */
type Prefs = { size: number; collapsed: boolean };
type PrefsPatch = Partial<Prefs>;

const applyPatch = (cur: Prefs, p: PrefsPatch): Prefs => ({ ...cur, ...p });

// An empty server stream: the local store stays at `initial`, which is all
// these tests need (they exercise the client-side write path, not seeding).
async function* emptyStream(): AsyncGenerator<Prefs> {}

function makeCell(
  mutate: (p: PrefsPatch) => Effect.Effect<void, unknown>,
  coalesceMs: number | undefined,
  onError?: (err: Error) => void,
) {
  return useCell({} as Cell<"prefs", Prefs>, {
    authority: "local",
    initial: { size: 0.25, collapsed: false },
    source: (() => emptyStream()) as unknown as StreamingProcedure<
      undefined,
      Prefs
    >,
    applyPatch,
    mutate,
    coalesceMs,
    onError,
  });
}

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("useCell local authority — coalesceMs", () => {
  it("coalesces a burst of distinct patches into one trailing mutate with merged keys", async () => {
    const mutate = vi.fn(() => Effect.void);
    await createRoot(async (dispose) => {
      const cell = makeCell(mutate, 30);
      // Fire without awaiting — local apply is synchronous; the server flush
      // is what we're testing is deferred. `{ coalesce: true }` opts each write
      // into the debounce.
      Effect.runSync(cell.patch({ size: 0.3 }, { coalesce: true }));
      Effect.runSync(cell.patch({ size: 0.4 }, { coalesce: true }));
      Effect.runSync(cell.patch({ collapsed: true }, { coalesce: true }));
      // Local apply is synchronous — a mid-drag reader sees every step.
      expect(cell.value()).toEqual({ size: 0.4, collapsed: true });
      // The server round-trip is deferred, not fired per patch.
      expect(mutate).not.toHaveBeenCalled();
      await tick(60);
      // One flush, carrying both the last size AND the interleaved collapsed
      // toggle — heterogeneous keys are merged, not clobbered.
      expect(mutate).toHaveBeenCalledTimes(1);
      expect(mutate).toHaveBeenCalledWith({ size: 0.4, collapsed: true });
      dispose();
    });
  });

  it("a 50-write resize drag produces a single server write (regression guard for #1041)", async () => {
    const mutate = vi.fn<(p: PrefsPatch) => Effect.Effect<void, unknown>>(
      () => Effect.void,
    );
    await createRoot(async (dispose) => {
      const cell = makeCell(mutate, 30);
      for (let i = 1; i <= 50; i++)
        Effect.runSync(
          cell.patch({ size: 0.2 + i * 0.001 }, { coalesce: true }),
        );
      expect(mutate).not.toHaveBeenCalled();
      await tick(60);
      expect(mutate).toHaveBeenCalledTimes(1);
      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({ size: expect.closeTo(0.25) }),
      );
      dispose();
    });
  });

  it("without coalesceMs every patch flushes immediately (proves the guard bites)", async () => {
    const mutate = vi.fn(() => Effect.void);
    await createRoot(async (dispose) => {
      const cell = makeCell(mutate, undefined);
      await Effect.runPromise(cell.patch({ size: 0.3 }, { coalesce: true }));
      await Effect.runPromise(cell.patch({ size: 0.4 }, { coalesce: true }));
      expect(mutate).toHaveBeenCalledTimes(2);
      dispose();
    });
  });

  it("a plain patch flushes immediately even when coalesceMs is configured (per-write opt-in)", async () => {
    const mutate = vi.fn(() => Effect.void);
    await createRoot(async (dispose) => {
      const cell = makeCell(mutate, 30);
      // No `{ coalesce: true }` — a discrete write (e.g. a settings toggle)
      // must reach the server now, not after the debounce window.
      await Effect.runPromise(cell.patch({ collapsed: true }));
      expect(mutate).toHaveBeenCalledTimes(1);
      expect(mutate).toHaveBeenCalledWith({ collapsed: true });
      dispose();
    });
  });

  it("throws when coalesceMs is set without applyPatch (fail-fast misconfiguration)", () => {
    createRoot((dispose) => {
      expect(() =>
        useCell({} as Cell<"prefs", Prefs>, {
          authority: "local",
          initial: { size: 0.25, collapsed: false },
          source: (() => emptyStream()) as unknown as StreamingProcedure<
            undefined,
            Prefs
          >,
          mutate: () => Effect.void,
          coalesceMs: 30,
          // applyPatch intentionally omitted
        }),
      ).toThrow(/coalesceMs requires applyPatch/);
      dispose();
    });
  });

  it("routes a coalesced-flush failure to onError, not the patch effect", async () => {
    const boom = new Error("flush failed");
    const mutate = vi.fn(() => Effect.fail(boom));
    const onError = vi.fn();
    await createRoot(async (dispose) => {
      const cell = makeCell(mutate, 30, onError);
      // The returned effect SUCCEEDS on local apply — it does not carry the
      // deferred server failure, which lands on `onError` a window later.
      await expect(
        Effect.runPromise(cell.patch({ size: 0.3 }, { coalesce: true })),
      ).resolves.toBeUndefined();
      await tick(60);
      expect(onError).toHaveBeenCalledWith(boom);
      dispose();
    });
  });
});

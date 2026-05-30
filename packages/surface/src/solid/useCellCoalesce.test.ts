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
  mutate: (p: PrefsPatch) => Promise<void>,
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
    const mutate = vi.fn(async () => {});
    await createRoot(async (dispose) => {
      const cell = makeCell(mutate, 30);
      // Fire without awaiting — local apply is synchronous; the server flush
      // is what we're testing is deferred.
      void cell.patch({ size: 0.3 });
      void cell.patch({ size: 0.4 });
      void cell.patch({ collapsed: true });
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
    const mutate = vi.fn<(p: PrefsPatch) => Promise<void>>(async () => {});
    await createRoot(async (dispose) => {
      const cell = makeCell(mutate, 30);
      for (let i = 1; i <= 50; i++) void cell.patch({ size: 0.2 + i * 0.001 });
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
    const mutate = vi.fn(async () => {});
    await createRoot(async (dispose) => {
      const cell = makeCell(mutate, undefined);
      await cell.patch({ size: 0.3 });
      await cell.patch({ size: 0.4 });
      expect(mutate).toHaveBeenCalledTimes(2);
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
          mutate: async () => {},
          coalesceMs: 30,
          // applyPatch intentionally omitted
        }),
      ).toThrow(/coalesceMs requires applyPatch/);
      dispose();
    });
  });

  it("routes a coalesced-flush failure to onError, not the patch promise", async () => {
    const boom = new Error("flush failed");
    const mutate = vi.fn(async () => {
      throw boom;
    });
    const onError = vi.fn();
    await createRoot(async (dispose) => {
      const cell = makeCell(mutate, 30, onError);
      // The returned promise resolves on local apply — it does not reject
      // with the deferred server error.
      await expect(cell.patch({ size: 0.3 })).resolves.toBeUndefined();
      await tick(60);
      expect(onError).toHaveBeenCalledWith(boom);
      dispose();
    });
  });
});

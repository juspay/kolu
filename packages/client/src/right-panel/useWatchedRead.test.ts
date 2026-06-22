/** R8 — `useWatchedRead`'s requery-on-pulse contract, in isolation (no transport).
 *
 * The Code tab's live updates depend on this primitive re-querying the procedure
 * each time the change pulse ticks, and on a rejected read landing on
 * `error()`/`onError` (never an uncaught page error). Pin both. */

import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { type PulseAccessor, useWatchedRead } from "./useWatchedRead";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

// NOTE on what this can and can't pin: the requery contract below is exercised
// with a signal-backed pulse. The PRODUCTION subtlety — that the surface
// subscription stores the frame in a `createStore` and writes it via `reconcile`
// (stable object reference, only `seq` mutates), so the consumer MUST read the
// nested `seq` rather than the whole object — can't be reproduced here: this
// vitest harness doesn't propagate `createStore` updates made after an `await`
// (a harness limit, not a Solid one). That reconcile-reference behaviour is
// covered by the Code-tab e2e live-update scenarios instead. These tests pin the
// rest of the contract (requery on pulse, stand-down, error handling).

/** A pulse accessor backed by a seq signal. */
function fakePulse(seq: () => number): PulseAccessor {
  return Object.assign(() => ({ seq: seq() }), {
    pending: () => false,
    error: () => undefined as Error | undefined,
  });
}

describe("useWatchedRead", () => {
  it("re-queries the procedure on each new pulse", async () => {
    await createRoot(async (dispose) => {
      const [seq, setSeq] = createSignal(0);
      let reads = 0;
      const r = useWatchedRead(
        () => ({ repoPath: "/r" }),
        async () => {
          reads += 1;
          return reads;
        },
        fakePulse(seq),
      );
      await flush();
      expect(reads).toBe(1);
      expect(r()).toBe(1);

      // The watcher fires: a fresh pulse → a fresh query (re-read on change).
      setSeq(1);
      await flush();
      expect(reads).toBe(2);
      expect(r()).toBe(2);

      dispose();
    });
  });

  it("pending() reads true SYNCHRONOUSLY when input flips null→value (the diff→browse gate)", async () => {
    await createRoot(async (dispose) => {
      const [seq] = createSignal(0);
      const [inp, setInp] = createSignal<{ repoPath: string } | null>(null);
      const r = useWatchedRead(inp, async () => ["a.txt"], fakePulse(seq));
      await flush();
      expect(r.pending()).toBe(false); // null input → stood down, not pending

      // The view→browse moment: the openInCodeTab resolution gate reads
      // `allPaths.pending()` on THIS tick and must see `true` — else it resolves
      // against an empty list. A derived pending reads true here (value not yet
      // loaded for the new input); the old imperative flag raced to false.
      setInp({ repoPath: "/r" });
      expect(r.pending()).toBe(true);

      await flush();
      expect(r.pending()).toBe(false); // value landed → no longer pending
      expect(r()).toEqual(["a.txt"]);
      dispose();
    });
  });

  it("stands the read down when input is null", async () => {
    await createRoot(async (dispose) => {
      const [seq] = createSignal(0);
      let reads = 0;
      const r = useWatchedRead(
        () => null,
        async () => {
          reads += 1;
          return reads;
        },
        fakePulse(seq),
      );
      await flush();
      expect(reads).toBe(0);
      expect(r()).toBeUndefined();
      dispose();
    });
  });

  it("routes a rejected read to error()/onError, never throwing on read", async () => {
    await createRoot(async (dispose) => {
      const [seq] = createSignal(0);
      let onErr: Error | undefined;
      const r = useWatchedRead<{ repoPath: string }, number>(
        () => ({ repoPath: "/bare-repo" }),
        async () => {
          throw new Error("git ls-files: must be run in a work tree");
        },
        fakePulse(seq),
        { onError: (e) => (onErr = e) },
      );
      await flush();
      // value reads as undefined (no throw → no uncaught page error)…
      expect(r()).toBeUndefined();
      // …and the failure is observable on error()/onError.
      expect(r.error()?.message).toContain("work tree");
      expect(onErr?.message).toContain("work tree");
      dispose();
    });
  });
});

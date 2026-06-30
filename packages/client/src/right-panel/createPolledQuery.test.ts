import type { Subscription } from "@kolu/surface/solid";
import { type Accessor, createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { createPolledQuery } from "./createPolledQuery";

const tick = () => new Promise((r) => setTimeout(r, 0));

/** A promise whose `resolve` is exposed, so a test can hold a read mid-flight
 *  and release it on demand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** A hand-driven `{seq}` pulse `Subscription` — `deliver(n)` pushes a frame +
 *  clears pending, the way `subscribeRepoChange.use(...)` would. */
function makePulse() {
  const [value, setValue] = createSignal<{ seq: number } | undefined>(
    undefined,
  );
  const [pending, setPending] = createSignal(true);
  const [error, setError] = createSignal<Error | undefined>(undefined);
  const sub = Object.assign(
    (() => value()) as Accessor<{ seq: number } | undefined>,
    { pending, error },
  ) as Subscription<{ seq: number }>;
  return {
    sub,
    deliver: (seq: number) => {
      setValue({ seq });
      setPending(false);
    },
    fail: (e: Error) => setError(e),
  };
}

describe("createPolledQuery", () => {
  it("reads ONCE on mount and does NOT re-read on the {seq:0} snapshot frame", async () => {
    await createRoot(async (dispose) => {
      const pulse = makePulse();
      let n = 0;
      const q = createPolledQuery(
        () => ({ k: "a" }),
        async () => {
          n++;
          return `v${n}`;
        },
        pulse.sub,
      );
      await tick();
      expect(n).toBe(1); // single mount read, not double
      expect(q()).toBe("v1");
      // The pulse's snapshot frame coincides with the mount read — must NOT
      // re-read (the dedup that keeps it a single read like the old stream).
      pulse.deliver(0);
      await tick();
      expect(n).toBe(1);
      dispose();
    });
  });

  it("re-queries on a delta pulse ({seq>0}), keeping the prior value while it re-reads", async () => {
    await createRoot(async (dispose) => {
      const pulse = makePulse();
      pulse.deliver(0);
      const second = deferred<string>();
      let n = 0;
      const q = createPolledQuery(
        () => ({ k: "a" }),
        () => {
          n++;
          return n === 1 ? Promise.resolve("v1") : second.promise;
        },
        pulse.sub,
      );
      await tick();
      expect(q()).toBe("v1");
      expect(q.pending()).toBe(false);
      // A git change bumps the pulse → re-query, but the OLD value stays on
      // screen (no transient undefined) and pending flips true mid-flight.
      pulse.deliver(1);
      await tick();
      expect(n).toBe(2);
      expect(q()).toBe("v1"); // value held during the re-read
      expect(q.pending()).toBe(true);
      second.resolve("v2");
      await tick();
      expect(q()).toBe("v2");
      expect(q.pending()).toBe(false);
      dispose();
    });
  });

  it("re-queries on an INPUT change and resets to undefined (a resubscribe)", async () => {
    await createRoot(async (dispose) => {
      const pulse = makePulse();
      pulse.deliver(0);
      const [mode, setMode] = createSignal("local");
      const branch = deferred<string>();
      const q = createPolledQuery(
        () => ({ mode: mode() }),
        (input) =>
          input.mode === "local"
            ? Promise.resolve("local-result")
            : branch.promise,
        pulse.sub,
      );
      await tick();
      expect(q()).toBe("local-result");
      // Switching mode is a resubscribe — the value resets to undefined
      // (pending) rather than showing the prior mode's result.
      setMode("branch");
      await tick();
      expect(q()).toBeUndefined();
      expect(q.pending()).toBe(true);
      branch.resolve("branch-result");
      await tick();
      expect(q()).toBe("branch-result");
      dispose();
    });
  });

  it("stands down (no read, undefined value) when the input is null", async () => {
    await createRoot(async (dispose) => {
      const pulse = makePulse();
      pulse.deliver(0);
      const read = vi.fn(async () => "v");
      const q = createPolledQuery<{ k: string }, string>(
        () => null,
        read,
        pulse.sub,
      );
      await tick();
      expect(read).not.toHaveBeenCalled();
      expect(q()).toBeUndefined();
      dispose();
    });
  });

  it("surfaces a read rejection on error() and calls onError", async () => {
    await createRoot(async (dispose) => {
      const pulse = makePulse();
      pulse.deliver(0);
      const onError = vi.fn();
      const q = createPolledQuery(
        () => ({ k: "a" }),
        async () => {
          throw new Error("boom");
        },
        pulse.sub,
        { onError },
      );
      await tick();
      expect(q.error()?.message).toBe("boom");
      expect(onError).toHaveBeenCalledOnce();
      expect(q.pending()).toBe(false);
      dispose();
    });
  });
});

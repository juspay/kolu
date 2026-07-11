/** Unit tests for the pulse-then-requery primitive that replaced the Code tab's
 *  koluSurface fs/git value streams (W1.R4). A mocked `unenrolledStreamCall` stands in
 *  for the active host's pulse stream; the test pumps a "pulse frame" by hand via
 *  `pulse()`. Each frame is one pulse — the initial snapshot frame, an on-disk change, or
 *  the fresh frame a reconnect re-subscribe yields — so a single pump models any. */

import type { StreamingProcedure } from "@kolu/surface/solid";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { createPolledQuery } from "./createPolledQuery";

// The pulse is an UNENROLLED stream (`unenrolledStreamCall`) now, not `client.rawStream`.
// Mock it as a controllable async-iterable: the test pushes a frame via `pulse()` (→ one
// requery) or an error via `failPulse()` (→ `surfaceError`); the iterable ends when its
// AbortSignal fires (an input change), so a superseded pulse stops.
const pulseCtl = vi.hoisted(() => ({
  latest: null as null | {
    emit: (e: { frame: true } | { err: Error }) => void;
  },
}));
vi.mock("@kolu/surface/client", () => ({
  unenrolledStreamCall: async (
    _proc: unknown,
    _input: unknown,
    opts?: { signal?: AbortSignal },
  ) => {
    const queue: Array<{ frame: true } | { err: Error }> = [];
    let wake: (() => void) | null = null;
    let ended = false;
    const stop = () => {
      ended = true;
      wake?.();
    };
    opts?.signal?.addEventListener("abort", stop);
    pulseCtl.latest = {
      emit: (e) => {
        queue.push(e);
        wake?.();
        wake = null;
      },
    };
    return {
      async *[Symbol.asyncIterator]() {
        while (!ended) {
          while (queue.length) {
            const e = queue.shift();
            if (e && "err" in e) throw e.err;
            yield undefined;
          }
          if (ended) break;
          await new Promise<void>((r) => {
            wake = r;
          });
        }
      },
    };
  },
}));

async function flush(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

/** A fake pulse source. `pulse()` fires one frame (→ one requery); `failPulse(err)`
 *  throws it into the pulse iterable (→ `surfaceError`); `live` is the transport-liveness
 *  accessor the primitive gates its reconnect-blip swallow on. */
function fakeStream() {
  const [live, setLive] = createSignal(true);
  // A FACTORY now (the pulse follows the active host — `() => padiRpcOf(activeHost())…`); the
  // mocked `unenrolledStreamCall` ignores the proc, so only the factory TYPE matters here.
  const pulseProc: () => StreamingProcedure<
    { repoPath: string },
    { seq: number }
  > = () =>
    null as unknown as StreamingProcedure<
      { repoPath: string },
      { seq: number }
    >;
  return {
    live,
    pulseProc,
    pulse: () => pulseCtl.latest?.emit({ frame: true }),
    setLive: (v: boolean) => setLive(v),
    failPulse: (err: Error) => pulseCtl.latest?.emit({ err }),
  };
}

describe("createPolledQuery", () => {
  it("idle input: no pulse subscription, no query, pending", async () => {
    let calls = 0;
    const result = await new Promise<{ v: unknown; pending: boolean }>(
      (resolve) => {
        createRoot(async (dispose) => {
          const { live, pulseProc, pulse } = fakeStream();
          const q = createPolledQuery({
            input: () => null,
            live,
            pulseProc,
            pulseInput: (i: { repoPath: string }) => ({ repoPath: i.repoPath }),
            query: async () => {
              calls += 1;
              return "x";
            },
          });
          await flush();
          pulse(); // no subscription installed while idle — a no-op
          await flush();
          resolve({ v: q(), pending: q.pending() });
          dispose();
        });
      },
    );
    expect(result.v).toBe(undefined);
    expect(result.pending).toBe(true);
    expect(calls).toBe(0);
  });

  it("the first pulse frame runs the initial query; value lands, pending clears", async () => {
    const result = await new Promise<{ v: unknown; calls: number; p: boolean }>(
      (resolve) => {
        createRoot(async (dispose) => {
          let calls = 0;
          const { live, pulseProc, pulse } = fakeStream();
          const q = createPolledQuery({
            input: () => ({ repoPath: "A" }),
            live,
            pulseProc,
            pulseInput: (i) => ({ repoPath: i.repoPath }),
            query: async (i) => {
              calls += 1;
              return `${i.repoPath}#${calls}`;
            },
          });
          await flush();
          pulse(); // initial snapshot frame
          await flush();
          resolve({ v: q(), calls, p: q.pending() });
          dispose();
        });
      },
    );
    expect(result.v).toBe("A#1");
    expect(result.calls).toBe(1);
    expect(result.p).toBe(false);
  });

  it("a later pulse requeries in place (also the reconnect-refresh path)", async () => {
    const result = await new Promise<{ v: unknown; calls: number; p: boolean }>(
      (resolve) => {
        createRoot(async (dispose) => {
          let calls = 0;
          const { live, pulseProc, pulse } = fakeStream();
          const q = createPolledQuery({
            input: () => ({ repoPath: "A" }),
            live,
            pulseProc,
            pulseInput: (i) => ({ repoPath: i.repoPath }),
            query: async (i) => {
              calls += 1;
              return `${i.repoPath}#${calls}`;
            },
          });
          await flush();
          pulse(); // initial
          await flush();
          pulse(); // an on-disk change (or a reconnect's fresh frame)
          await flush();
          resolve({ v: q(), calls, p: q.pending() });
          dispose();
        });
      },
    );
    expect(result.v).toBe("A#2");
    expect(result.calls).toBe(2);
    // The requery never went pending — it updated in place.
    expect(result.p).toBe(false);
  });

  it("input change requeries with the new input", async () => {
    const result = await new Promise<{
      before: unknown;
      after: unknown;
      calls: number;
    }>((resolve) => {
      createRoot(async (dispose) => {
        let calls = 0;
        const [repo, setRepo] = createSignal("A");
        const { live, pulseProc, pulse } = fakeStream();
        const q = createPolledQuery({
          input: () => ({ repoPath: repo() }),
          live,
          pulseProc,
          pulseInput: (i) => ({ repoPath: i.repoPath }),
          query: async (i) => {
            calls += 1;
            return `${i.repoPath}#${calls}`;
          },
        });
        await flush();
        pulse();
        await flush();
        const before = q();

        setRepo("B");
        await flush();
        pulse(); // the re-subscribed pulse's first frame, now keyed on B
        await flush();
        const after = q();

        resolve({ before, after, calls });
        dispose();
      });
    });
    expect(result.before).toBe("A#1");
    expect(result.after).toBe("B#2");
    expect(result.calls).toBe(2);
  });

  it("surfaces a query rejection via error() and onError", async () => {
    const seen: string[] = [];
    const result = await new Promise<string>((resolve) => {
      createRoot(async (dispose) => {
        const { live, pulseProc, pulse } = fakeStream();
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          live,
          pulseProc,
          pulseInput: (i) => ({ repoPath: i.repoPath }),
          query: async () => {
            throw new Error("boom");
          },
          onError: (err) => seen.push(err.message),
        });
        await flush();
        pulse();
        await flush();
        resolve(q.error()?.message ?? "");
        dispose();
      });
    });
    expect(result).toBe("boom");
    expect(seen).toEqual(["boom"]);
  });

  it("swallows a query rejection while the transport is not live (reconnect blip)", async () => {
    // The value stream this replaces rode STREAM_RETRY, which never surfaced a
    // reconnect-window failure. A query that rejects while `health().live` is
    // false must NOT set error() or fire onError — it's a transient blip; the
    // pulse requeries on reconnect.
    const seen: string[] = [];
    const errMsg = await new Promise<string | undefined>((resolve) => {
      createRoot(async (dispose) => {
        const { live, pulseProc, pulse, setLive } = fakeStream();
        setLive(false);
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          live,
          pulseProc,
          pulseInput: (i) => ({ repoPath: i.repoPath }),
          query: async () => {
            throw new Error("boom");
          },
          onError: (err) => seen.push(err.message),
        });
        await flush();
        pulse();
        await flush();
        resolve(q.error()?.message);
        dispose();
      });
    });
    expect(errMsg).toBeUndefined();
    expect(seen).toEqual([]);
  });

  it("routes a PULSE (watcher) failure into error()/pending() — one unified channel", async () => {
    // A watcher-install failure (inotify ENOSPC) is PERSISTENT — it must set a
    // real error state (error() set, pending() unstuck), not merely fire a 4s
    // toast over a forever-"Loading…". Reverting the pulse effect to the old
    // onError-only path leaves error() undefined + pending() stuck true here.
    const seen: string[] = [];
    const res = await new Promise<{
      err: string | undefined;
      pending: boolean;
    }>((resolve) => {
      createRoot(async (dispose) => {
        const { live, pulseProc, failPulse } = fakeStream();
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          live,
          pulseProc,
          pulseInput: (i) => ({ repoPath: i.repoPath }),
          query: async () => "unused", // no frame fires; pending stays true until the pulse errors
          onError: (err) => seen.push(err.message),
        });
        await flush();
        failPulse(new Error("ENOSPC")); // the watcher install fails after subscribe
        await flush();
        resolve({ err: q.error()?.message, pending: q.pending() });
        dispose();
      });
    });
    expect(res.err).toBe("ENOSPC"); // routed into error() — undefined before the fix
    expect(res.pending).toBe(false); // unstuck — stayed true before the fix
    expect(seen).toEqual(["ENOSPC"]); // the single onError still fires once
  });

  it("swallowError swallows a benign transient (delete-while-viewing) — value kept, no error/onError", async () => {
    // A file deleted mid-view makes the requery reject with a NOT_FOUND; the
    // caller classifies it as benign. It must NOT surface (error() stays clear,
    // last value retained, no toast) — parity with the old value stream that
    // simply stopped yielding. Removing the swallowError guard sets error().
    const seen: string[] = [];
    const res = await new Promise<{
      err: string | undefined;
      v: unknown;
      seen: string[];
    }>((resolve) => {
      createRoot(async (dispose) => {
        let calls = 0;
        const { live, pulseProc, pulse } = fakeStream();
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          live,
          pulseProc,
          pulseInput: (i) => ({ repoPath: i.repoPath }),
          query: async () => {
            calls += 1;
            if (calls === 1) return "content";
            throw new Error("NOT_FOUND: file gone");
          },
          onError: (err) => seen.push(err.message),
          swallowError: (err) => /NOT_FOUND/.test(err.message),
        });
        await flush();
        pulse(); // first read → "content"
        await flush();
        pulse(); // file deleted → requery throws NOT_FOUND → swallowed
        await flush();
        resolve({ err: q.error()?.message, v: q(), seen });
        dispose();
      });
    });
    expect(res.err).toBeUndefined(); // swallowed — no error panel
    expect(res.v).toBe("content"); // last content retained
    expect(res.seen).toEqual([]); // no toast
  });

  it("a fresh-reference-but-equal-value input does NOT blank or re-query (the #1714 contract)", async () => {
    // The regression: `getMetadata` handed consumers a fresh object per tick, so
    // `input` (keyed on `repoPath` off that object) re-evaluated to a NEW
    // `{ repoPath }` object with the SAME value on every incidental metadata tick.
    // The pre-fix `on(() => ({ i: input(), host }))` re-fired on that reference
    // churn — blanking the value to `undefined`, going `pending`, and re-subscribing
    // the pulse — which remounted the Code tab (the flicker). The value-deduped input
    // key must make an equal-value re-eval a no-op: value retained, never pending, no
    // extra query.
    const res = await new Promise<{
      v: unknown;
      calls: number;
      pending: boolean;
    }>((resolve) => {
      createRoot(async (dispose) => {
        let calls = 0;
        const [tick, setTick] = createSignal(0);
        const { live, pulseProc, pulse } = fakeStream();
        const q = createPolledQuery({
          // A fresh `{ repoPath: "A" }` object every eval; `tick` invalidates the
          // accessor WITHOUT changing the value — the exact churn #1714 fed in.
          input: () => {
            tick();
            return { repoPath: "A" };
          },
          live,
          pulseProc,
          pulseInput: (i) => ({ repoPath: i.repoPath }),
          query: async (i) => {
            calls += 1;
            return `${i.repoPath}#${calls}`;
          },
        });
        await flush();
        pulse(); // initial snapshot → "A#1"
        await flush();

        // An upstream reference tick: `input()` re-evals to a NEW object, same value.
        setTick(1);
        await flush();
        resolve({ v: q(), calls, pending: q.pending() });
        dispose();
      });
    });
    expect(res.v).toBe("A#1"); // value retained — NOT blanked to undefined
    expect(res.pending).toBe(false); // never went pending (the "Loading…" flash)
    expect(res.calls).toBe(1); // no re-subscribe → no extra query
  });

  it("a host-only change (same input value) still blanks + re-subscribes", async () => {
    // The identical-repoPath edge `pulseHost`'s doc calls out: switching the
    // active host while `input()`'s VALUE is unchanged (same repoPath present
    // on two hosts) must still tear down the old host's pulse and blank —
    // `inputState`'s key is over (input, host), not input alone.
    const res = await new Promise<{
      before: unknown;
      afterSwitch: { v: unknown; pending: boolean };
      after: unknown;
      calls: number;
    }>((resolve) => {
      createRoot(async (dispose) => {
        let calls = 0;
        const [host, setHost] = createSignal("host-1");
        const { live, pulseProc, pulse } = fakeStream();
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          live,
          pulseProc,
          pulseHost: host,
          pulseInput: (i) => ({ repoPath: i.repoPath }),
          query: async (i) => {
            calls += 1;
            return `${i.repoPath}#${calls}`;
          },
        });
        await flush();
        pulse();
        await flush();
        const before = q();

        setHost("host-2");
        await flush();
        const afterSwitch = { v: q(), pending: q.pending() };
        pulse(); // the re-subscribed pulse's first frame, now keyed on host-2
        await flush();
        const after = q();

        resolve({ before, afterSwitch, after, calls });
        dispose();
      });
    });
    expect(res.before).toBe("A#1");
    expect(res.afterSwitch.v).toBe(undefined); // blanked on the host switch
    expect(res.afterSwitch.pending).toBe(true);
    expect(res.after).toBe("A#2"); // re-queried on the new host's pulse
    expect(res.calls).toBe(2);
  });

  it("retainAcrossKeys: a switch BACK to a previously-loaded key ADOPTS the cache (no blank), then the pulse refreshes (padi W9)", async () => {
    // The Code-tab half of instant host switch-back: with `retainAcrossKeys`, a
    // GENUINE host change to a key that was loaded before shows the held value
    // instantly (no blank, not `pending`) while the re-subscribed pulse refreshes —
    // instead of dropping the Code tab to "Loading…". A BRAND-NEW key still blanks,
    // exactly as the default path (the sibling test above), so the value-keyed
    // contract is untouched; only the SWITCH-BACK stops blanking.
    const res = await new Promise<{
      onHost1: unknown;
      freshKeyBlank: { v: unknown; pending: boolean };
      onHost2: unknown;
      adopted: { v: unknown; pending: boolean };
      refreshed: unknown;
    }>((resolve) => {
      createRoot(async (dispose) => {
        let calls = 0;
        const [host, setHost] = createSignal("host-1");
        const { live, pulseProc, pulse } = fakeStream();
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          live,
          pulseProc,
          pulseHost: host,
          pulseInput: (i) => ({ repoPath: i.repoPath }),
          query: async (i) => {
            calls += 1;
            return `${i.repoPath}#${calls}`;
          },
          retainAcrossKeys: true,
        });
        await flush();
        pulse();
        await flush();
        const onHost1 = q(); // "A#1" — cached under the (A, host-1) key

        // Switch to host-2 (same repoPath, a NEW key): still blanks + pending, since
        // this key has no cached value yet — the default host-change behavior.
        setHost("host-2");
        await flush();
        const freshKeyBlank = { v: q(), pending: q.pending() };
        pulse();
        await flush();
        const onHost2 = q(); // "A#2" — now cached under (A, host-2)

        // Switch BACK to host-1: its key IS cached, so adopt "A#1" WITHOUT blanking…
        setHost("host-1");
        await flush();
        const adopted = { v: q(), pending: q.pending() };
        // …and the re-subscribed pulse's first frame refreshes it in the background.
        pulse();
        await flush();
        const refreshed = q(); // "A#3"

        resolve({ onHost1, freshKeyBlank, onHost2, adopted, refreshed });
        dispose();
      });
    });
    expect(res.onHost1).toBe("A#1");
    // A brand-new key still blanks + goes pending (unchanged from the default path).
    expect(res.freshKeyBlank.v).toBeUndefined();
    expect(res.freshKeyBlank.pending).toBe(true);
    expect(res.onHost2).toBe("A#2");
    // Switch-BACK adopts the cached value instantly — NO blank, NOT pending.
    expect(res.adopted.v).toBe("A#1");
    expect(res.adopted.pending).toBe(false);
    // …and the pulse refreshes it in the background to the current on-disk value.
    expect(res.refreshed).toBe("A#3");
  });
});

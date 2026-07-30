/** Unit tests for the eager-read-then-pulse primitive that replaced the Code tab's
 *  koluSurface fs/git value streams (W1.R4). A mocked `unenrolledStreamCall` stands in
 *  for the active host's pulse stream; the test pumps a "pulse frame" by hand via
 *  `pulse()`. The eager read hydrates without waiting for watcher setup; each frame is
 *  then one invalidation — the initial race-closing snapshot, an on-disk change, or the
 *  fresh frame a reconnect re-subscribe yields — so a single pump models any. */

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
vi.mock("@kolu/surface/client", async () => {
  // The SHARED abort-aware stream mock; this fixture tracks a single `latest` emitter.
  const { makeAbortAwareStream } = await import("./streamMock.testlib");
  return {
    unenrolledStreamCall: async (
      _proc: unknown,
      _input: unknown,
      opts?: { signal?: AbortSignal },
    ) => {
      const { iterable, push } = makeAbortAwareStream(opts?.signal);
      pulseCtl.latest = { emit: push };
      return iterable;
    },
  };
});

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
  // A FACTORY now (the pulse follows the active host — `() => activePadiStreams.<pulse>.unenrolled`); the
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

  it("hydrates eagerly, then the first pulse closes the read-before-watch race", async () => {
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
          pulse(); // initial snapshot frame: race-closing refresh after eager hydration
          await flush();
          resolve({ v: q(), calls, p: q.pending() });
          dispose();
        });
      },
    );
    expect(result.v).toBe("A#2");
    expect(result.calls).toBe(2);
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
          pulse(); // initial race-closing snapshot
          await flush();
          pulse(); // an on-disk change (or a reconnect's fresh frame)
          await flush();
          resolve({ v: q(), calls, p: q.pending() });
          dispose();
        });
      },
    );
    expect(result.v).toBe("A#3");
    expect(result.calls).toBe(3);
    // The requery never went pending — it updated in place.
    expect(result.p).toBe(false);
  });

  it("explicit refresh marks the retained value pending until a fresh read lands", async () => {
    const result = await new Promise<{
      before: unknown;
      held: unknown;
      pending: boolean;
      after: unknown;
      calls: number;
    }>((resolve) => {
      createRoot(async (dispose) => {
        let calls = 0;
        let value = "old";
        const { live, pulseProc } = fakeStream();
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          live,
          pulseProc,
          pulseInput: (i) => ({ repoPath: i.repoPath }),
          query: async () => {
            calls += 1;
            return value;
          },
        });
        await flush();
        const before = q();
        value = "fresh";
        q.refresh();
        const held = q();
        const pending = q.pending();
        await flush();
        resolve({ before, held, pending, after: q(), calls });
        dispose();
      });
    });
    expect(result.before).toBe("old");
    expect(result.held).toBe("old");
    expect(result.pending).toBe(true);
    expect(result.after).toBe("fresh");
    expect(result.calls).toBe(2);
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
    expect(result.before).toBe("A#2");
    expect(result.after).toBe("B#4");
    expect(result.calls).toBe(4);
  });

  it("surfaces identical eager and snapshot query failures as one active error edge", async () => {
    const seen: string[] = [];
    const result = await new Promise<{ message: string; calls: number }>(
      (resolve) => {
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
              throw new Error("boom");
            },
            onError: (err) => seen.push(err.message),
          });
          await flush();
          pulse();
          await flush();
          resolve({ message: q.error()?.message ?? "", calls });
          dispose();
        });
      },
    );
    expect(result).toEqual({ message: "boom", calls: 2 });
    expect(seen).toEqual(["boom"]);
  });

  it("surfaces a different error code even when its message matches the active failure", async () => {
    const seen: string[] = [];
    const result = await new Promise<{
      message: string;
      code: unknown;
      calls: number;
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
            throw Object.assign(new Error("boom"), {
              code: calls < 3 ? "FIRST" : "SECOND",
            });
          },
          onError: (err) => seen.push(String((err as { code?: unknown }).code)),
        });
        await flush(); // eager "boom"
        pulse(); // initial snapshot repeats "boom" — one active edge
        await flush();
        pulse(); // same message, different code must replace it + surface
        await flush();
        resolve({
          message: q.error()?.message ?? "",
          code: (q.error() as { code?: unknown } | undefined)?.code,
          calls,
        });
        dispose();
      });
    });
    expect(result).toEqual({ message: "boom", code: "SECOND", calls: 3 });
    expect(seen).toEqual(["FIRST", "SECOND"]);
  });

  it("surfaces the same failure again after a success clears it", async () => {
    const seen: string[] = [];
    const result = await new Promise<{
      valueAfterSuccess: unknown;
      errorAfterSuccess: string | undefined;
      finalError: string | undefined;
      calls: number;
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
            if (calls === 2) return "recovered";
            throw new Error("boom");
          },
          onError: (err) => seen.push(err.message),
        });
        await flush(); // eager failure
        pulse(); // initial snapshot succeeds and clears the active error
        await flush();
        const valueAfterSuccess = q();
        const errorAfterSuccess = q.error()?.message;
        pulse(); // later recurrence is a new edge
        await flush();
        resolve({
          valueAfterSuccess,
          errorAfterSuccess,
          finalError: q.error()?.message,
          calls,
        });
        dispose();
      });
    });
    expect(result).toEqual({
      valueAfterSuccess: "recovered",
      errorAfterSuccess: undefined,
      finalError: "boom",
      calls: 3,
    });
    expect(seen).toEqual(["boom", "boom"]);
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
        await flush(); // eager read → "content"
        pulse(); // file deleted → snapshot refresh throws NOT_FOUND → swallowed
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
        pulse(); // initial snapshot refresh → "A#2"
        await flush();

        // An upstream reference tick: `input()` re-evals to a NEW object, same value.
        setTick(1);
        await flush();
        resolve({ v: q(), calls, pending: q.pending() });
        dispose();
      });
    });
    expect(res.v).toBe("A#2"); // value retained — NOT blanked to undefined
    expect(res.pending).toBe(false); // never went pending (the "Loading…" flash)
    expect(res.calls).toBe(2); // eager + initial snapshot only; no churn query
  });

  it("a host-only change (same input value) still blanks + re-subscribes", async () => {
    // The identical-repoPath edge `pulseHost`'s doc calls out: switching the
    // active host while `input()`'s VALUE is unchanged (same repoPath present
    // on two hosts) must still tear down the old host's pulse and blank —
    // `inputState`'s key is over (input, host), not input alone.
    const res = await new Promise<{
      before: unknown;
      afterSwitch: { v: unknown; pending: boolean };
      afterEagerRead: unknown;
      after: unknown;
      calls: number;
    }>((resolve) => {
      createRoot(async (dispose) => {
        let calls = 0;
        const [host, setHost] = createSignal("host-1");
        let releaseHost2!: () => void;
        const host2Gate = new Promise<void>((resolveGate) => {
          releaseHost2 = resolveGate;
        });
        const { live, pulseProc, pulse } = fakeStream();
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          live,
          pulseProc,
          pulseHost: host,
          pulseInput: (i) => ({ repoPath: i.repoPath }),
          query: async (i) => {
            calls += 1;
            if (host() === "host-2") await host2Gate;
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
        releaseHost2();
        await flush();
        const afterEagerRead = q();
        pulse(); // the re-subscribed pulse's first frame, now keyed on host-2
        await flush();
        const after = q();

        resolve({ before, afterSwitch, afterEagerRead, after, calls });
        dispose();
      });
    });
    expect(res.before).toBe("A#2");
    expect(res.afterSwitch.v).toBe(undefined); // blanked on the host switch
    expect(res.afterSwitch.pending).toBe(true);
    expect(res.afterEagerRead).toBe("A#3"); // hydrates without waiting for a frame
    expect(res.after).toBe("A#4"); // snapshot closes the setup race
    expect(res.calls).toBe(4);
  });

  it("active pause gate: pauses (value held, pulse torn down) while inactive, RESUMES with no blank + an immediate refresh (padi W9)", async () => {
    // The Code-tab half of instant switch-back, by OWNERSHIP: `hostCodeTab`
    // builds one instance per host and wires `active = ctx.isActive`. Backgrounding a
    // host flips `active` false — the value is HELD and the pulse torn down (no
    // background polling); switching BACK flips it true — the held value stays (NO
    // blank) and the pulse re-subscribes to refresh immediately.
    const res = await new Promise<{
      shown: unknown;
      whilePaused: { v: unknown; pending: boolean; calls: number };
      onResume: { v: unknown; pending: boolean };
      afterEagerResume: unknown;
      afterResume: unknown;
    }>((resolve) => {
      createRoot(async (dispose) => {
        let calls = 0;
        let releaseResume!: () => void;
        const resumeGate = new Promise<void>((resolveGate) => {
          releaseResume = resolveGate;
        });
        const [active, setActive] = createSignal(true);
        const { live, pulseProc, pulse } = fakeStream();
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          live,
          pulseProc,
          pulseInput: (i) => ({ repoPath: i.repoPath }),
          query: async (i) => {
            calls += 1;
            if (calls === 3) await resumeGate;
            return `${i.repoPath}#${calls}`;
          },
          active,
        });
        await flush();
        pulse();
        await flush();
        const shown = q(); // "A#2" (eager read + initial snapshot refresh)

        // PAUSE (host backgrounded): value held, pulse torn down. A pulse frame while
        // paused hits the aborted stream and must NOT requery.
        setActive(false);
        await flush();
        pulse();
        await flush();
        const whilePaused = { v: q(), pending: q.pending(), calls };

        // RESUME (switch-BACK) with unchanged input: NO blank (value held), then the
        // re-subscribed pulse's first frame refreshes it immediately.
        setActive(true);
        await flush();
        const onResume = { v: q(), pending: q.pending() };
        releaseResume();
        await flush();
        const afterEagerResume = q();
        pulse();
        await flush();
        const afterResume = q(); // "A#4" (resume eager read + snapshot refresh)

        resolve({
          shown,
          whilePaused,
          onResume,
          afterEagerResume,
          afterResume,
        });
        dispose();
      });
    });
    expect(res.shown).toBe("A#2");
    // Held while paused; no background poll fired (the pulse was torn down on pause).
    expect(res.whilePaused.v).toBe("A#2");
    expect(res.whilePaused.pending).toBe(false);
    expect(res.whilePaused.calls).toBe(2);
    // Resume: the eager refresh is deliberately held in flight, proving the
    // retained value remains visible instead of blanking and refilling quickly.
    expect(res.onResume.v).toBe("A#2");
    expect(res.onResume.pending).toBe(false);
    expect(res.afterEagerResume).toBe("A#3");
    // The pulse snapshot then closes the resume read-before-watch race.
    expect(res.afterResume).toBe("A#4");
  });

  it("active pause gate: an input change WHILE paused blanks + re-queries on resume (a genuine query change is not silently stale)", async () => {
    // If the query genuinely changed while a host was backgrounded (e.g. the user
    // changed the diff mode), resuming must NOT show the stale held value: the key
    // differs from what is shown, so it blanks + re-queries like any new input.
    const res = await new Promise<{
      shownA: unknown;
      whilePaused: { v: unknown; pending: boolean };
      onResume: { v: unknown; pending: boolean };
      afterResume: unknown;
    }>((resolve) => {
      createRoot(async (dispose) => {
        let calls = 0;
        let releaseB!: () => void;
        const bGate = new Promise<void>((resolveGate) => {
          releaseB = resolveGate;
        });
        const [input, setInput] = createSignal<{ repoPath: string }>({
          repoPath: "A",
        });
        const [active, setActive] = createSignal(true);
        const { live, pulseProc, pulse } = fakeStream();
        const q = createPolledQuery({
          input,
          live,
          pulseProc,
          pulseInput: (i) => ({ repoPath: i.repoPath }),
          query: async (i) => {
            calls += 1;
            if (i.repoPath === "B") await bGate;
            return `${i.repoPath}#${calls}`;
          },
          active,
        });
        await flush();
        pulse();
        await flush();
        const shownA = q(); // "A#2" (eager read + initial snapshot refresh)

        // Pause, then change the input WHILE paused (the effect no-ops while inactive,
        // so the held value stays put — it does not blank yet).
        setActive(false);
        await flush();
        setInput({ repoPath: "B" });
        await flush();
        const whilePaused = { v: q(), pending: q.pending() };

        // Resume: the key changed (B ≠ the shown A), so it blanks + re-queries.
        setActive(true);
        await flush();
        const onResume = { v: q(), pending: q.pending() };
        releaseB();
        await flush();
        const afterResume = q(); // "B#3" from the eager resume read

        resolve({ shownA, whilePaused, onResume, afterResume });
        dispose();
      });
    });
    expect(res.shownA).toBe("A#2");
    // Paused: the held value stays (the effect does not act while inactive).
    expect(res.whilePaused.v).toBe("A#2");
    expect(res.whilePaused.pending).toBe(false);
    // Resume with a changed query: blanks + goes pending (not silently stale).
    expect(res.onResume.v).toBeUndefined();
    expect(res.onResume.pending).toBe(true);
    expect(res.afterResume).toBe("B#3");
  });

  it("active pause gate: an IN-FLIGHT query is aborted on pause — a late resolve never writes the now-background store (no cross-host mix)", async () => {
    // A requery already DISPATCHED when a host is backgrounded must be torn down, not
    // just the pulse: `BrowseFileDispatcher` reads `activeHost()` AFTER its await (the
    // binary URL), so a late resolve would stamp the NEW host's URL with THIS host's tag
    // into THIS host's retained store — a cross-host mix. Pausing aborts the in-flight
    // query, so its resolve early-returns on `ctl.signal.aborted` and the held value is
    // frozen. (Before the fix, the inactive branch returned WITHOUT aborting, so the late
    // resolve overwrote the store with "A#LATE".)
    const res = await new Promise<{
      paused: unknown;
      afterLateResolve: unknown;
    }>((resolve) => {
      createRoot(async (dispose) => {
        let calls = 0;
        const deferred: { release: (() => void) | null } = { release: null };
        const [active, setActive] = createSignal(true);
        const { live, pulseProc, pulse } = fakeStream();
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          live,
          pulseProc,
          pulseInput: (i) => ({ repoPath: i.repoPath }),
          query: async (i) => {
            calls += 1;
            if (calls === 1) return `${i.repoPath}#1`;
            // The 2nd query blocks until the test releases it — modelling an RPC
            // round-trip (the `await`) that outlives the pause.
            await new Promise<void>((r) => {
              deferred.release = r;
            });
            return `${i.repoPath}#LATE`;
          },
          active,
        });
        await flush();
        pulse(); // query#1 → "A#1"
        await flush();

        pulse(); // query#2 starts, then blocks on the deferred
        await flush();
        // Pause BEFORE query#2 resolves — it must be aborted, not left running.
        setActive(false);
        await flush();
        const paused = q();

        // Let the in-flight query resolve; it lands AFTER the pause.
        deferred.release?.();
        await flush();
        const afterLateResolve = q();

        resolve({ paused, afterLateResolve });
        dispose();
      });
    });
    expect(res.paused).toBe("A#1"); // held value frozen on pause
    expect(res.afterLateResolve).toBe("A#1"); // late resolve discarded (aborted)
  });
});

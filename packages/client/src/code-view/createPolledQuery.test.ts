/** Unit tests for the pulse-then-requery primitive that replaced the Code tab's
 *  koluSurface fs/git value streams (W1.R4). A mocked `unenrolledStreamCall` stands in
 *  for the active host's pulse stream; the test pumps a "pulse frame" by hand via
 *  `pulse()`. Each frame is one pulse — the initial snapshot frame, an on-disk change, or
 *  the fresh frame a reconnect re-subscribe yields — so a single pump models any. */

import { Effect } from "effect";
import type { StreamingProcedure } from "@kolu/surface/solid";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { createPolledQuery } from "./createPolledQuery";

// The pulse is an UNENROLLED stream (`unenrolledStreamCall`) now, not `client.rawStream`.
// Mock it as a controllable `Stream`: the test pushes a frame via `pulse()` (→ one
// requery) or a failure via `failPulse()` (→ `surfaceError`). A superseded pulse stops
// by fiber INTERRUPT (no AbortSignal any more), which runs the mock's finalizer.
const pulseCtl = vi.hoisted(() => ({
  latest: null as null | {
    emit: (e: { frame: true } | { err: Error }) => void;
  },
}));
vi.mock("@kolu/surface/client", async () => {
  // The SHARED controllable stream mock; this fixture tracks a single `latest` emitter.
  const { makeControllableStream } = await import("./streamMock.testlib");
  return {
    unenrolledStreamCall: (_proc: unknown, _input: unknown) => {
      const { stream, push } = makeControllableStream();
      pulseCtl.latest = { emit: push };
      return stream;
    },
  };
});

async function settle(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

/** The `query` seam takes a DESCRIPTION now. These fixtures stay written as
 *  plain async bodies — a throw is the readable way to state "this read fails" —
 *  and `Effect.tryPromise` is what turns that throw into the error channel the
 *  primitive reads, exactly as the real query's own failure arrives. */
function asEffect<I, R>(
  fn: (input: I) => Promise<R>,
): (input: I) => Effect.Effect<R, unknown> {
  return (input) =>
    Effect.tryPromise({
      try: () => fn(input),
      // Pass the thrown value THROUGH: these fixtures state a failure by
      // throwing the exact error the assertion reads, and `tryPromise`'s
      // default wrap would hide it behind an `UnknownError`.
      catch: (e) => e,
    });
}

/** A fake pulse source. `pulse()` fires one frame (→ one requery); `failPulse(err)`
 *  throws it into the pulse iterable (→ `surfaceError`); `live` is the transport-liveness
 *  accessor the primitive gates its reconnect-blip swallow on — `liveAtFirst`
 *  is where it starts, since a stream born mid-reconnect cannot be written
 *  into that state from the owner that builds it. */
function fakeStream(liveAtFirst = true) {
  const [live] = createSignal(liveAtFirst);
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
            query: asEffect(async () => {
              calls += 1;
              return "x";
            }),
          });
          await settle();
          pulse(); // no subscription installed while idle — a no-op
          await settle();
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
            query: asEffect(async (i) => {
              calls += 1;
              return `${i.repoPath}#${calls}`;
            }),
          });
          await settle();
          pulse(); // initial snapshot frame
          await settle();
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
            query: asEffect(async (i) => {
              calls += 1;
              return `${i.repoPath}#${calls}`;
            }),
          });
          await settle();
          pulse(); // initial
          await settle();
          pulse(); // an on-disk change (or a reconnect's fresh frame)
          await settle();
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
          query: asEffect(async (i) => {
            calls += 1;
            return `${i.repoPath}#${calls}`;
          }),
        });
        await settle();
        pulse();
        await settle();
        const before = q();

        setRepo("B");
        await settle();
        pulse(); // the re-subscribed pulse's first frame, now keyed on B
        await settle();
        const after = q();

        resolve({ before, after, calls });
        dispose();
      });
    });
    expect(result.before).toBe("A#1");
    expect(result.after).toBe("B#2");
    expect(result.calls).toBe(2);
  });

  it("a round trip BACK to an already-answered key keeps that key's answer (no blank), where master re-blanked", async () => {
    // The one behaviour difference from master. The store's stamp moves only on a
    // landing, so A → B → A with no landing for B returns to A's OWN answer:
    // value held, `pending()` false, refreshed in place by the pulse's first frame.
    // Master reset the faces on every active run of the poll effect, so the way
    // back blanked and showed a "Loading…" frame before re-answering the same bytes.
    const res = await new Promise<{
      onB: { v: unknown; pending: boolean };
      backAtA: { v: unknown; pending: boolean };
      afterRefresh: unknown;
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
          query: asEffect(async (i) => {
            calls += 1;
            return `${i.repoPath}#${calls}`;
          }),
        });
        await settle();
        pulse(); // A's answer lands: "A#1"
        await settle();

        // Away to B, with NO landing for B (no pulse frame): B has no stamped
        // answer, so it is blank and pending — the unchanged half of the rule.
        setRepo("B");
        await settle();
        const onB = { v: q(), pending: q.pending() };

        // …and BACK to A, whose answer the store still carries.
        setRepo("A");
        await settle();
        const backAtA = { v: q(), pending: q.pending() };

        pulse(); // the re-subscribed pulse's first frame refreshes it in place
        await settle();
        resolve({ onB, backAtA, afterRefresh: q(), calls });
        dispose();
      });
    });
    expect(res.onB.v).toBeUndefined(); // a key with no stamped answer is blank…
    expect(res.onB.pending).toBe(true);
    expect(res.backAtA.v).toBe("A#1"); // …and the key the store answers for is not
    expect(res.backAtA.pending).toBe(false);
    expect(res.afterRefresh).toBe("A#2"); // refreshed in place, never blanked
    expect(res.calls).toBe(2); // B never read: it got no pulse frame
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
          query: asEffect(async () => {
            throw new Error("boom");
          }),
          onError: (err) => seen.push(err.message),
        });
        await settle();
        pulse();
        await settle();
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
        // Born mid-reconnect: the transport is not live before the query is
        // built, so there is nothing to write from inside this owner.
        const { live, pulseProc, pulse } = fakeStream(false);
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          live,
          pulseProc,
          pulseInput: (i) => ({ repoPath: i.repoPath }),
          query: asEffect(async () => {
            throw new Error("boom");
          }),
          onError: (err) => seen.push(err.message),
        });
        await settle();
        pulse();
        await settle();
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
          query: asEffect(async () => "unused"), // no frame fires; pending stays true until the pulse errors
          onError: (err) => seen.push(err.message),
        });
        await settle();
        failPulse(new Error("ENOSPC")); // the watcher install fails after subscribe
        await settle();
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
          query: asEffect(async () => {
            calls += 1;
            if (calls === 1) return "content";
            throw new Error("NOT_FOUND: file gone");
          }),
          onError: (err) => seen.push(err.message),
          swallowError: (err) => /NOT_FOUND/.test(err.message),
        });
        await settle();
        pulse(); // first read → "content"
        await settle();
        pulse(); // file deleted → requery throws NOT_FOUND → swallowed
        await settle();
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
          query: asEffect(async (i) => {
            calls += 1;
            return `${i.repoPath}#${calls}`;
          }),
        });
        await settle();
        pulse(); // initial snapshot → "A#1"
        await settle();

        // An upstream reference tick: `input()` re-evals to a NEW object, same value.
        setTick(1);
        await settle();
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
          query: asEffect(async (i) => {
            calls += 1;
            return `${i.repoPath}#${calls}`;
          }),
        });
        await settle();
        pulse();
        await settle();
        const before = q();

        setHost("host-2");
        await settle();
        const afterSwitch = { v: q(), pending: q.pending() };
        pulse(); // the re-subscribed pulse's first frame, now keyed on host-2
        await settle();
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
      afterResume: unknown;
    }>((resolve) => {
      createRoot(async (dispose) => {
        let calls = 0;
        const [active, setActive] = createSignal(true);
        const { live, pulseProc, pulse } = fakeStream();
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          live,
          pulseProc,
          pulseInput: (i) => ({ repoPath: i.repoPath }),
          query: asEffect(async (i) => {
            calls += 1;
            return `${i.repoPath}#${calls}`;
          }),
          active,
        });
        await settle();
        pulse();
        await settle();
        const shown = q(); // "A#1"

        // PAUSE (host backgrounded): value held, pulse torn down. A pulse frame while
        // paused hits the aborted stream and must NOT requery.
        setActive(false);
        await settle();
        pulse();
        await settle();
        const whilePaused = { v: q(), pending: q.pending(), calls };

        // RESUME (switch-BACK) with unchanged input: NO blank (value held), then the
        // re-subscribed pulse's first frame refreshes it immediately.
        setActive(true);
        await settle();
        const onResume = { v: q(), pending: q.pending() };
        pulse();
        await settle();
        const afterResume = q(); // "A#2"

        resolve({ shown, whilePaused, onResume, afterResume });
        dispose();
      });
    });
    expect(res.shown).toBe("A#1");
    // Held while paused; no background poll fired (the pulse was torn down on pause).
    expect(res.whilePaused.v).toBe("A#1");
    expect(res.whilePaused.pending).toBe(false);
    expect(res.whilePaused.calls).toBe(1);
    // Resume: the held value is shown instantly — NO blank, NOT pending…
    expect(res.onResume.v).toBe("A#1");
    expect(res.onResume.pending).toBe(false);
    // …and the pulse refreshes it in the background (the immediate refresh on activation).
    expect(res.afterResume).toBe("A#2");
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
          query: asEffect(async (i) => {
            calls += 1;
            return `${i.repoPath}#${calls}`;
          }),
          active,
        });
        await settle();
        pulse();
        await settle();
        const shownA = q(); // "A#1"

        // Pause, then change the input WHILE paused (the effect no-ops while inactive,
        // so the held value stays put — it does not blank yet).
        setActive(false);
        await settle();
        setInput({ repoPath: "B" });
        await settle();
        const whilePaused = { v: q(), pending: q.pending() };

        // Resume: the key changed (B ≠ the shown A), so it blanks + re-queries.
        setActive(true);
        await settle();
        const onResume = { v: q(), pending: q.pending() };
        pulse();
        await settle();
        const afterResume = q(); // "B#2"

        resolve({ shownA, whilePaused, onResume, afterResume });
        dispose();
      });
    });
    expect(res.shownA).toBe("A#1");
    // Paused: the held value stays (the effect does not act while inactive).
    expect(res.whilePaused.v).toBe("A#1");
    expect(res.whilePaused.pending).toBe(false);
    // Resume with a changed query: blanks + goes pending (not silently stale).
    expect(res.onResume.v).toBeUndefined();
    expect(res.onResume.pending).toBe(true);
    expect(res.afterResume).toBe("B#2");
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
          query: asEffect(async (i) => {
            calls += 1;
            if (calls === 1) return `${i.repoPath}#1`;
            // The 2nd query blocks until the test releases it — modelling an RPC
            // round-trip (the `await`) that outlives the pause.
            await new Promise<void>((r) => {
              deferred.release = r;
            });
            return `${i.repoPath}#LATE`;
          }),
          active,
        });
        await settle();
        pulse(); // query#1 → "A#1"
        await settle();

        pulse(); // query#2 starts, then blocks on the deferred
        await settle();
        // Pause BEFORE query#2 resolves — it must be aborted, not left running.
        setActive(false);
        await settle();
        const paused = q();

        // Let the in-flight query resolve; it lands AFTER the pause.
        deferred.release?.();
        await settle();
        const afterLateResolve = q();

        resolve({ paused, afterLateResolve });
        dispose();
      });
    });
    expect(res.paused).toBe("A#1"); // held value frozen on pause
    expect(res.afterLateResolve).toBe("A#1"); // late resolve discarded (aborted)
  });

  it("a STANDING failure fires onError once, not again on every pause/resume (one toast per failure)", async () => {
    // The faces are derived through `shownKey()`, which reads `active()` and the
    // standing input key — and an effect's apply arm runs on every re-run of its
    // compute, equal value or not. Wiring `onError` to `error()` therefore raised
    // a fresh toast on every mode switch once a read had failed, forever — three
    // calls for the one failure here (1 → 2 → 3 over two away-and-back switches:
    // nothing LANDS in this fixture, so `store.key` stays null, the paused
    // `shownKey()` matches no failure and only each resume re-raises). A landed-
    // then-failed key pauses onto its own failure too, and makes it five. It is
    // wired to the failure itself, so the callback moves only when a read fails
    // or a landing retires it.
    const seen: string[] = [];
    const errAfterSwitches = await new Promise<string | undefined>(
      (resolve) => {
        createRoot(async (dispose) => {
          const [active, setActive] = createSignal(true);
          const { live, pulseProc, pulse } = fakeStream();
          const q = createPolledQuery({
            input: () => ({ repoPath: "A" }),
            live,
            pulseProc,
            pulseInput: (i) => ({ repoPath: i.repoPath }),
            query: asEffect(async () => {
              throw new Error("boom");
            }),
            onError: (err) => seen.push(err.message),
            active,
          });
          await settle();
          pulse(); // the one failed read
          await settle();

          // Two away-and-back mode switches. No pulse frame fires on resume, so
          // no NEW read fails — nothing here is a second failure.
          for (let i = 0; i < 2; i++) {
            setActive(false);
            await settle();
            setActive(true);
            await settle();
          }
          resolve(q.error()?.message);
          dispose();
        });
      },
    );
    expect(seen).toEqual(["boom"]); // ONE call — three before the fix
    expect(errAfterSwitches).toBe("boom"); // the face still stands for the key
  });
});

/** Unit tests for the pulse-then-requery primitive that replaced the Code tab's
 *  koluSurface fs/git value streams (W1.R4). A fake surface client stands in for
 *  `padi`: its `rawStream` captures the per-frame `onItem` callback the primitive
 *  installs, and the test pumps a "pulse frame" by hand. Each `onItem` is one
 *  pulse — the initial snapshot frame, an on-disk change, or the fresh frame a
 *  reconnect re-subscribe yields — so a single pump models any of the three. */

import type { PadiSurfaceSpec } from "@kolu/padi/surface";
import type { StreamingProcedure, SurfaceClient } from "@kolu/surface/solid";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { createPolledQuery } from "./createPolledQuery";

// createPolledQuery now reads the ACTIVE binding's padi client + `activeHost`
// (W4 B1/B2 — the pulse follows the tab, never pinning the mount-time binding).
// Mock the binding module: `activeBinding` yields whatever client the test
// registered; `activeHost` is a settable accessor so a test can drive a switch.
const store = vi.hoisted(() => ({
  getClient: (() => undefined) as () => unknown,
  getHost: (() => "local") as () => string,
}));
vi.mock("../binding/bindings", () => ({
  activeBinding: () => ({ clients: { padi: store.getClient() } }),
  activeHost: () => store.getHost(),
}));

async function flush(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

/** A fake padi client whose `rawStream` records the primitive's `onItem`. `pulse`
 *  fires it — one pulse frame. `rawStream` is re-invoked on every input change,
 *  so `onItem` always points at the live subscription's callback. */
function fakeClient() {
  let onItem: (() => void) | null = null;
  let live = true;
  let subscribed = 0;
  // The pulse stream's own error() — a reactive signal so a test can fail the
  // WATCHER (as opposed to the query) and assert how the primitive routes it.
  const [pulseErr, setPulseErr] = createSignal<Error | undefined>();
  const client = {
    rawStream: (
      _name: string,
      _proc: unknown,
      _input: unknown,
      opts: { onItem: (item: unknown) => void },
    ) => {
      subscribed += 1;
      onItem = () => opts.onItem(undefined);
      return { pending: () => false, error: () => pulseErr() };
    },
    // Only `.live` is read (the reconnect-blip swallow); the cast covers the
    // rest of SurfaceHealth.
    health: () => ({ live }),
  } as unknown as SurfaceClient<PadiSurfaceSpec>;
  const pulseProc = null as unknown as StreamingProcedure<
    { repoPath: string },
    { seq: number }
  >;
  // Register this fake as the ACTIVE binding's padi client (what `activeBinding()`
  // resolves to inside createPolledQuery). A switch test overrides `store.getClient`
  // afterwards to make it host-reactive.
  store.getClient = () => client;
  return {
    client,
    pulseProc,
    pulse: () => onItem?.(),
    /** How many times this client's pulse stream was (re)opened. */
    subscribed: () => subscribed,
    setLive: (v: boolean) => {
      live = v;
    },
    failPulse: (err: Error) => setPulseErr(err),
  };
}

describe("createPolledQuery", () => {
  it("idle input: no pulse subscription, no query, pending", async () => {
    let calls = 0;
    const result = await new Promise<{ v: unknown; pending: boolean }>(
      (resolve) => {
        createRoot(async (dispose) => {
          const { pulseProc, pulse } = fakeClient();
          const q = createPolledQuery({
            input: () => null,
            pulseName: "test",
            pulse: () => pulseProc,
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
          const { pulseProc, pulse } = fakeClient();
          const q = createPolledQuery({
            input: () => ({ repoPath: "A" }),
            pulseName: "test",
            pulse: () => pulseProc,
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
          const { pulseProc, pulse } = fakeClient();
          const q = createPolledQuery({
            input: () => ({ repoPath: "A" }),
            pulseName: "test",
            pulse: () => pulseProc,
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
        const { pulseProc, pulse } = fakeClient();
        const q = createPolledQuery({
          input: () => ({ repoPath: repo() }),
          pulseName: "test",
          pulse: () => pulseProc,
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
        const { pulseProc, pulse } = fakeClient();
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          pulseName: "test",
          pulse: () => pulseProc,
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
        const { pulseProc, pulse, setLive } = fakeClient();
        setLive(false);
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          pulseName: "test",
          pulse: () => pulseProc,
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
        const { pulseProc, failPulse } = fakeClient();
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          pulseName: "test",
          pulse: () => pulseProc,
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
        const { pulseProc, pulse } = fakeClient();
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          pulseName: "test",
          pulse: () => pulseProc,
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

  it("re-keys the pulse onto the NEW host's client after a switch (B1/B2)", async () => {
    // The #1687 stale-binding class: before the fix the pulse (client.rawStream +
    // the captured pulseProc) pinned the mount-time binding, so after a host switch
    // the Code tab / preview pulsed the RETIRED host forever. The pulse must re-open
    // against the ACTIVE host's client on a switch.
    await new Promise<void>((resolve) => {
      createRoot(async (dispose) => {
        const [host, setHost] = createSignal("A");
        const a = fakeClient();
        const b = fakeClient();
        // activeBinding + activeHost follow the switchable host signal.
        store.getHost = host;
        store.getClient = () => (host() === "B" ? b.client : a.client);
        createPolledQuery({
          input: () => ({ repoPath: "R" }),
          pulseName: "test",
          pulse: () => a.pulseProc,
          pulseInput: (i) => ({ repoPath: i.repoPath }),
          query: async (i) => i.repoPath,
        });
        await flush();
        expect(a.subscribed()).toBe(1); // pulse opened on host A
        expect(b.subscribed()).toBe(0);

        setHost("B"); // THE SWITCH
        await flush();
        expect(b.subscribed()).toBe(1); // pulse RE-OPENED on host B — it followed the tab
        dispose();
        resolve();
      });
    });
  });
});

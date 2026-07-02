/** Unit tests for the pulse-then-requery primitive that replaced the Code tab's
 *  koluSurface fs/git value streams (W1.R4). A fake surface client stands in for
 *  `padi`: its `rawStream` captures the per-frame `onItem` callback the primitive
 *  installs, and the test pumps a "pulse frame" by hand. Each `onItem` is one
 *  pulse — the initial snapshot frame, an on-disk change, or the fresh frame a
 *  reconnect re-subscribe yields — so a single pump models any of the three. */

import type { PadiSurfaceSpec } from "@kolu/padi/surface";
import type { StreamingProcedure, SurfaceClient } from "@kolu/surface/solid";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { createPolledQuery } from "./createPolledQuery";

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
  const client = {
    rawStream: (
      _name: string,
      _proc: unknown,
      _input: unknown,
      opts: { onItem: (item: unknown) => void },
    ) => {
      onItem = () => opts.onItem(undefined);
      return { pending: () => false, error: () => undefined };
    },
    // Only `.live` is read (the reconnect-blip swallow); the cast covers the
    // rest of SurfaceHealth.
    health: () => ({ live }),
  } as unknown as SurfaceClient<PadiSurfaceSpec>;
  const pulseProc = null as unknown as StreamingProcedure<
    { repoPath: string },
    { seq: number }
  >;
  return {
    client,
    pulseProc,
    pulse: () => onItem?.(),
    setLive: (v: boolean) => {
      live = v;
    },
  };
}

describe("createPolledQuery", () => {
  it("idle input: no pulse subscription, no query, pending", async () => {
    let calls = 0;
    const result = await new Promise<{ v: unknown; pending: boolean }>(
      (resolve) => {
        createRoot(async (dispose) => {
          const { client, pulseProc, pulse } = fakeClient();
          const q = createPolledQuery({
            input: () => null,
            client,
            pulseName: "test",
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
          const { client, pulseProc, pulse } = fakeClient();
          const q = createPolledQuery({
            input: () => ({ repoPath: "A" }),
            client,
            pulseName: "test",
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
          const { client, pulseProc, pulse } = fakeClient();
          const q = createPolledQuery({
            input: () => ({ repoPath: "A" }),
            client,
            pulseName: "test",
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
        const { client, pulseProc, pulse } = fakeClient();
        const q = createPolledQuery({
          input: () => ({ repoPath: repo() }),
          client,
          pulseName: "test",
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
        const { client, pulseProc, pulse } = fakeClient();
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          client,
          pulseName: "test",
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
        const { client, pulseProc, pulse, setLive } = fakeClient();
        setLive(false);
        const q = createPolledQuery({
          input: () => ({ repoPath: "A" }),
          client,
          pulseName: "test",
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
});

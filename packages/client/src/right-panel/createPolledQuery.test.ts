import type { StreamingProcedure } from "@kolu/surface/solid";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { createPolledQuery } from "./createPolledQuery";
import { asEffect } from "./effect.testlib";

const pulseCtl = vi.hoisted(() => ({
  latest: null as null | {
    emit: (e: { frame: true } | { err: Error }) => void;
  },
}));
vi.mock("@kolu/surface/client", async () => {
  const { makeReplayingControllableStream } = await import(
    "./streamMock.testlib"
  );
  return {
    unenrolledStreamCall: (_proc: unknown, _input: unknown) => {
      const { stream, push } = makeReplayingControllableStream();
      pulseCtl.latest = { emit: push };
      return stream;
    },
  };
});

async function flush(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

function fakeStream() {
  const [live, setLive] = createSignal(true);
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
            query: asEffect(async () => {
              calls += 1;
              return "x";
            }),
          });
          await flush();
          pulse();
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
            query: asEffect(async (i) => {
              calls += 1;
              return `${i.repoPath}#${calls}`;
            }),
          });
          await flush();
          pulse();
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
            query: asEffect(async (i) => {
              calls += 1;
              return `${i.repoPath}#${calls}`;
            }),
          });
          await flush();
          pulse();
          await flush();
          pulse();
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
        await flush();
        pulse();
        await flush();
        const before = q();

        setRepo("B");
        await flush();
        pulse();
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
          query: asEffect(async () => {
            throw new Error("boom");
          }),
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
          query: asEffect(async () => {
            throw new Error("boom");
          }),
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
          query: asEffect(async () => "unused"),
          onError: (err) => seen.push(err.message),
        });
        await flush();
        failPulse(new Error("ENOSPC"));
        await flush();
        resolve({ err: q.error()?.message, pending: q.pending() });
        dispose();
      });
    });
    expect(res.err).toBe("ENOSPC");
    expect(res.pending).toBe(false);
    expect(seen).toEqual(["ENOSPC"]);
  });

  it("swallowError swallows a benign transient (delete-while-viewing) — value kept, no error/onError", async () => {
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
        await flush();
        pulse();
        await flush();
        pulse();
        await flush();
        resolve({ err: q.error()?.message, v: q(), seen });
        dispose();
      });
    });
    expect(res.err).toBeUndefined();
    expect(res.v).toBe("content");
    expect(res.seen).toEqual([]);
  });

  it("a fresh-reference-but-equal-value input does NOT blank or re-query (the #1714 contract)", async () => {
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
        await flush();
        pulse();
        await flush();

        setTick(1);
        await flush();
        resolve({ v: q(), calls, pending: q.pending() });
        dispose();
      });
    });
    expect(res.v).toBe("A#1");
    expect(res.pending).toBe(false);
    expect(res.calls).toBe(1);
  });

  it("a host-only change (same input value) still blanks + re-subscribes", async () => {
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
        await flush();
        pulse();
        await flush();
        const before = q();

        setHost("host-2");
        await flush();
        const afterSwitch = { v: q(), pending: q.pending() };
        pulse();
        await flush();
        const after = q();

        resolve({ before, afterSwitch, after, calls });
        dispose();
      });
    });
    expect(res.before).toBe("A#1");
    expect(res.afterSwitch.v).toBe(undefined);
    expect(res.afterSwitch.pending).toBe(true);
    expect(res.after).toBe("A#2");
    expect(res.calls).toBe(2);
  });

  it("active pause gate: pauses (value held, pulse torn down) while inactive, RESUMES with no blank + an immediate refresh (padi W9)", async () => {
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
        await flush();
        pulse();
        await flush();
        const shown = q();

        setActive(false);
        await flush();
        pulse();
        await flush();
        const whilePaused = { v: q(), pending: q.pending(), calls };

        setActive(true);
        await flush();
        const onResume = { v: q(), pending: q.pending() };
        pulse();
        await flush();
        const afterResume = q();

        resolve({ shown, whilePaused, onResume, afterResume });
        dispose();
      });
    });
    expect(res.shown).toBe("A#1");
    expect(res.whilePaused.v).toBe("A#1");
    expect(res.whilePaused.pending).toBe(false);
    expect(res.whilePaused.calls).toBe(1);
    expect(res.onResume.v).toBe("A#1");
    expect(res.onResume.pending).toBe(false);
    expect(res.afterResume).toBe("A#2");
  });

  it("active pause gate: an input change WHILE paused blanks + re-queries on resume (a genuine query change is not silently stale)", async () => {
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
        await flush();
        pulse();
        await flush();
        const shownA = q();

        setActive(false);
        await flush();
        setInput({ repoPath: "B" });
        await flush();
        const whilePaused = { v: q(), pending: q.pending() };

        setActive(true);
        await flush();
        const onResume = { v: q(), pending: q.pending() };
        pulse();
        await flush();
        const afterResume = q();

        resolve({ shownA, whilePaused, onResume, afterResume });
        dispose();
      });
    });
    expect(res.shownA).toBe("A#1");
    expect(res.whilePaused.v).toBe("A#1");
    expect(res.whilePaused.pending).toBe(false);
    expect(res.onResume.v).toBeUndefined();
    expect(res.onResume.pending).toBe(true);
    expect(res.afterResume).toBe("B#2");
  });

  it("active pause gate: an IN-FLIGHT query is aborted on pause — a late resolve never writes the now-background store (no cross-host mix)", async () => {
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
            await new Promise<void>((r) => {
              deferred.release = r;
            });
            return `${i.repoPath}#LATE`;
          }),
          active,
        });
        await flush();
        pulse();
        await flush();

        pulse();
        await flush();
        setActive(false);
        await flush();
        const paused = q();

        deferred.release?.();
        await flush();
        const afterLateResolve = q();

        resolve({ paused, afterLateResolve });
        dispose();
      });
    });
    expect(res.paused).toBe("A#1");
    expect(res.afterLateResolve).toBe("A#1");
  });
});

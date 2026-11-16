/**
 * `diagnostics.read` end to end inside padi: the child meter, the stall
 * monitor, the per-call wrapper, and the answer encoding with its DECLARED
 * schema — an answer that will not encode takes down the whole mirror
 * kolu-server holds (#2376's failure class), so the encode is the assertion
 * that matters most here.
 */

import { execFile } from "node:child_process";
import { PadiDiagnosticsSchema } from "@kolu/padi-client/surface";
import { describeDaemon } from "@kolu/daemon-test-gate";
import { Effect, Schema } from "effect";
import { installChildMeter } from "kolu-io";
import type { Logger } from "pino";
import { beforeAll, describe, expect, it } from "vitest";
import { buildPadiSurfaceDeps } from "../servePadi.ts";
import type { TerminalEndpoint } from "../endpoint.ts";
import { fakeEndpoint, stubLog } from "../servePadi.testlib.ts";
import {
  callScoped,
  createCallsTable,
  SLOW_CALL_MS,
  timeProcedures,
} from "./calls.ts";
import { startPadiDiagnostics } from "./index.ts";
import { startStallMonitor } from "./stalls.ts";

function sleepChild(seconds: string): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  execFile("sleep", [seconds], () => resolve());
  return promise;
}

/** A body through the same helper `servePadi`'s `handle()` uses. */
function handled<A>(body: () => Promise<A>): Effect.Effect<A, unknown> {
  return callScoped(body, (attempt) => attempt);
}

function warnSpy(): { log: Logger; warns: unknown[] } {
  const warns: unknown[] = [];
  const log = { ...stubLog, warn: (fields: unknown) => warns.push(fields) };
  return { log: log as unknown as Logger, warns };
}

describe("stall monitor", () => {
  // Real time on purpose: the monitor measures the platform's own event loop,
  // which fake timers do not drive.
  it("reads an idle loop near zero and a blocked one as a stall", async () => {
    const monitor = startStallMonitor();
    try {
      await new Promise((r) => setTimeout(r, 300));
      const idle = monitor.read().current.summary;
      expect(idle.kind).toBe("measured");
      if (idle.kind === "measured")
        expect(idle.value.medianMs).toBeLessThan(10);

      const until = performance.now() + 250;
      while (performance.now() < until) {
        // Hold the loop for 250 ms.
      }
      await new Promise((r) => setTimeout(r, 50));
      const blocked = monitor.read().current.summary;
      expect(blocked.kind).toBe("measured");
      if (blocked.kind === "measured") {
        expect(blocked.value.maxMs).toBeGreaterThanOrEqual(200);
      }
      // No minute has completed yet, and the answer says so.
      expect(monitor.read().lastMinute.kind).toBe("unmeasured");
    } finally {
      monitor.stop();
    }
  });
});

describeDaemon("diagnostics with the child meter installed", () => {
  beforeAll(() => installChildMeter());

  it("times a call and the child it ran; a call with no child is a measured zero", async () => {
    const calls = createCallsTable();
    const { log, warns } = warnSpy();
    const procs = timeProcedures(
      {
        slow: { run: () => handled(() => sleepChild("0.3")) },
        quick: { run: () => handled(async () => 1) },
      },
      calls,
      log,
    );
    await Effect.runPromise(procs.slow.run());
    await Effect.runPromise(procs.quick.run());

    const rows = calls.read().rows;
    const slow = rows.find((r) => r.procedure === "slow.run");
    expect(slow?.total.maxMs).toBeGreaterThanOrEqual(300);
    expect(slow?.inChildren.kind).toBe("measured");
    if (slow?.inChildren.kind === "measured") {
      expect(slow.inChildren.value.children).toBe(1);
      expect(slow.inChildren.value.summary.maxMs).toBeGreaterThanOrEqual(300);
    }
    const quick = rows.find((r) => r.procedure === "quick.run");
    expect(quick?.inChildren).toEqual({
      kind: "measured",
      value: {
        children: 0,
        summary: { count: 1, medianMs: 0, p99Ms: 0, maxMs: 0, sumMs: 0 },
      },
    });
    expect(warns).toEqual([]);
  });

  it("logs one warn line for a call over the slow threshold", async () => {
    const calls = createCallsTable();
    const { log, warns } = warnSpy();
    const procs = timeProcedures(
      {
        slower: {
          run: () =>
            handled(() => sleepChild(String((SLOW_CALL_MS + 100) / 1000))),
        },
      },
      calls,
      log,
    );
    await Effect.runPromise(procs.slower.run());
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ procedure: "slower.run", children: 1 });
  });

  it("answers diagnostics.read through the built handler, and the answer encodes", async () => {
    const diagnostics = startPadiDiagnostics(stubLog);
    try {
      const deps = buildPadiSurfaceDeps({
        endpoint: fakeEndpoint,
        log: stubLog,
        diagnostics,
        startedAt: 0,
        commit: "",
        lifetime: { kind: "forever" },
        stateRoot: "/tmp/padi-diagnostics-test-state-root",
      });
      const read = deps.procedures?.diagnostics
        ?.read as unknown as () => Effect.Effect<unknown>;
      await sleepChild("0.2");

      const answer = await Effect.runPromise(read());
      const encoded = Schema.encodeUnknownSync(PadiDiagnosticsSchema)(answer);
      const decoded = Schema.decodeUnknownSync(PadiDiagnosticsSchema)(encoded);

      const sleep = decoded.children.rows.find((r) => r.kind === "sleep");
      expect(sleep?.startCall.kind).toBe("measured");
      expect(sleep?.run.kind).toBe("measured");
      if (sleep?.run.kind === "measured") {
        expect(sleep.run.value.maxMs).toBeGreaterThanOrEqual(200);
      }
      expect(decoded.stalls.resolutionMs).toBeGreaterThan(0);
      expect(Array.isArray(decoded.watchers.rows)).toBe(true);
      expect(decoded.memory.rssBytes).toBeGreaterThan(0);

      // The read itself went through the call wrapper and `handle()`, so the
      // next answer carries it — with its child time measured, not missing.
      const again = Schema.decodeUnknownSync(PadiDiagnosticsSchema)(
        await Effect.runPromise(read()),
      );
      const self = again.calls.rows.find(
        (r) => r.procedure === "diagnostics.read",
      );
      expect(self?.count).toBe(1);
      expect(self?.inChildren.kind).toBe("measured");
    } finally {
      diagnostics.dispose();
    }
  });

  it("attributes a child to the procedure that started it, through servePadi's own handle()", async () => {
    // `git.getStatus` is an ordinary `handle()` procedure; its endpoint starts
    // a real 200 ms child. Without the scope capture in `handle()` the child
    // runs outside the call's scope and the row reads "no children" — a
    // measured zero that is false.
    const slowEndpoint = {
      ...fakeEndpoint,
      git: {
        ...fakeEndpoint.git,
        getStatus: async () => {
          await sleepChild("0.2");
          return {};
        },
      },
    } as unknown as TerminalEndpoint;
    const diagnostics = startPadiDiagnostics(stubLog);
    try {
      const deps = buildPadiSurfaceDeps({
        endpoint: slowEndpoint,
        log: stubLog,
        diagnostics,
        startedAt: 0,
        commit: "",
        lifetime: { kind: "forever" },
        stateRoot: "/tmp/padi-diagnostics-test-state-root",
      });
      const getStatus = deps.procedures?.git?.getStatus as unknown as (opts: {
        input: { repoPath: string; mode: string };
      }) => Effect.Effect<unknown>;
      await Effect.runPromise(
        getStatus({ input: { repoPath: "/tmp/repo", mode: "local" } }),
      );

      const answer = await diagnostics.read();
      const row = answer.calls.rows.find(
        (r) => r.procedure === "git.getStatus",
      );
      expect(row?.inChildren.kind).toBe("measured");
      if (row?.inChildren.kind === "measured") {
        expect(row.inChildren.value.children).toBe(1);
        expect(row.inChildren.value.summary.maxMs).toBeGreaterThanOrEqual(200);
      }
    } finally {
      diagnostics.dispose();
    }
  });
});

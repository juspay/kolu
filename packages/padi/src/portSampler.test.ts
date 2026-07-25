/**
 * The port sampler's CADENCE — the four properties the scan's promptness and its
 * cost both rest on, driven on fake timers so they are facts rather than hopes.
 */

import type { PortInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPortSampler,
  PORT_SCAN_INTERVAL_MS,
  PORT_SCAN_MIN_GAP_MS,
  type PortScanTarget,
} from "./portSampler.ts";

const quietLog = {
  error: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  // biome-ignore lint/suspicious/noExplicitAny: a pino stand-in, not a pino
} as any;

const ONE: PortScanTarget[] = [{ id: "A" as TerminalId, rootPid: 100 }];
const PORT: PortInfo = { port: 8080, name: "node", wildcard: true };

/** A sampler over a scan the test drives: `passes` counts them, `answer` is what
 *  the next one returns, and `hold` (when set) keeps a pass in flight. */
function harness(opts: { targets?: PortScanTarget[] } = {}) {
  const published: Array<[TerminalId, readonly PortInfo[]]> = [];
  let passes = 0;
  let release: (() => void) | undefined;
  let answer = new Map<number, PortInfo[]>();
  let failWith: Error | undefined;
  const sampler = createPortSampler({
    targets: () => opts.targets ?? ONE,
    publish: (id, ports) => published.push([id, ports]),
    log: quietLog,
    scan: async () => {
      passes += 1;
      if (release !== undefined) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      if (failWith !== undefined) throw failWith;
      return answer;
    },
  });
  return {
    sampler,
    published,
    passes: () => passes,
    setAnswer: (ports: PortInfo[]) => {
      answer = new Map([[100, ports]]);
    },
    /** Answer with a map the test spells itself — for the case where the scan
     *  fails to answer for a requested terminal at all. */
    setAnswerRaw: (map: Map<number, PortInfo[]>) => {
      answer = map;
    },
    setFailure: (err: Error) => {
      failWith = err;
    },
    /** Make the NEXT pass hang until `finish()` is called. */
    hold: () => {
      release = () => {};
    },
    finish: async () => {
      release?.();
      release = undefined;
      await vi.advanceTimersByTimeAsync(0);
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the port sampler's cadence", () => {
  it("scans on the baseline and publishes each target's set", async () => {
    const h = harness();
    h.setAnswer([PORT]);
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS);

    expect(h.passes()).toBe(1);
    expect(h.published).toEqual([["A", [PORT]]]);
    h.sampler.dispose();
  });

  it("keeps ticking on the baseline", async () => {
    const h = harness();
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS * 3);
    expect(h.passes()).toBe(3);
    h.sampler.dispose();
  });

  it("publishes an EMPTY set for a target whose ports are gone", async () => {
    // The port-death half of the contract, which PRT2's auto-cancel rides on: the
    // scan returns no entry for a terminal serving nothing, and the sampler must
    // still say so rather than leaving the last sample standing forever.
    const h = harness();
    h.setAnswer([PORT]);
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS);
    h.setAnswer([]);
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS);

    expect(h.published).toEqual([
      ["A", [PORT]],
      ["A", []],
    ]);
    h.sampler.dispose();
  });

  it("a nudge pulls the scan forward instead of waiting out the baseline", async () => {
    const h = harness();
    // Get past the floor's cold start so the nudge is measured from a real pass.
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS);
    expect(h.passes()).toBe(1);

    h.sampler.nudge();
    await vi.advanceTimersByTimeAsync(PORT_SCAN_MIN_GAP_MS);
    expect(h.passes()).toBe(2);
    h.sampler.dispose();
  });

  it("floors a burst of nudges to one pass per minimum gap", async () => {
    // An agent streaming output nudges constantly; without the floor this is an
    // unbounded scan loop.
    const h = harness();
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS);
    const before = h.passes();

    for (let i = 0; i < 50; i++) {
      h.sampler.nudge();
      await vi.advanceTimersByTimeAsync(10);
    }

    // 50 nudges over ~500 ms — less than one gap, so at most one extra pass.
    expect(h.passes() - before).toBeLessThanOrEqual(1);
    h.sampler.dispose();
  });

  it("is single-flight, and re-runs for a nudge that landed mid-pass", async () => {
    // The pass in flight may have read the socket table BEFORE the listener that
    // prompted the nudge existed, so its result cannot be treated as covering it.
    const h = harness();
    h.hold();
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS);
    expect(h.passes()).toBe(1);

    h.sampler.nudge();
    h.sampler.nudge();
    expect(h.passes()).toBe(1); // no overlap

    await h.finish();
    await vi.advanceTimersByTimeAsync(PORT_SCAN_MIN_GAP_MS);
    expect(h.passes()).toBe(2);
    h.sampler.dispose();
  });

  it("does no OS work at all when there are no terminals", async () => {
    const h = harness({ targets: [] });
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS * 3);
    expect(h.passes()).toBe(0);
    h.sampler.dispose();
  });

  it("a BLIND scan leaves the last sample standing rather than publishing empty", async () => {
    // The `caught-error-must-not-collapse-to-empty` rule at its sharpest: an
    // EACCES on a requested subtree means "we cannot see", and publishing `[]`
    // would render byte-identically to "this terminal serves nothing".
    const h = harness();
    h.setAnswer([PORT]);
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS);
    expect(h.published).toEqual([["A", [PORT]]]);

    h.setFailure(new Error("EACCES on /proc/4242/fd"));
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS);

    expect(h.published).toEqual([["A", [PORT]]]);
    h.sampler.dispose();
  });

  it("treats a scan that skipped a requested terminal as BLIND, not as empty", async () => {
    // The scan promises a sample per requested id. A missing key means it failed
    // to answer for that terminal, and publishing `[]` for it would say "serves
    // nothing" — which is why the sampler refuses to fill the gap in.
    const h = harness();
    h.setAnswer([PORT]);
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS);
    expect(h.published).toEqual([["A", [PORT]]]);

    h.setAnswerRaw(new Map());
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS);

    expect(h.published).toEqual([["A", [PORT]]]);
    h.sampler.dispose();
  });

  it("recovers its cadence after a failed pass", async () => {
    const h = harness();
    h.setFailure(new Error("nope"));
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS * 2);
    expect(h.passes()).toBe(2);
    h.sampler.dispose();
  });

  it("stops scanning once disposed", async () => {
    const h = harness();
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS);
    h.sampler.dispose();
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS * 5);
    expect(h.passes()).toBe(1);
  });
});

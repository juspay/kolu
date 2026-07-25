/**
 * The port sampler's CADENCE — the properties the scan's promptness and its cost
 * both rest on, driven on fake timers so they are facts rather than hopes.
 *
 * The loop itself is the reactor's poll source now, which has its own tests; what
 * is pinned here is what padi DECLARES on top of it and what a consumer can
 * observe: the T+0 seed, the baseline, the nudge, the ≥1 s floor on the nudge edge,
 * single-flight with a mid-pass nudge re-running, a blind pass never publishing an
 * empty set, an all-or-nothing pass, and teardown.
 */

import type { PortInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPortSampler,
  PORT_SCAN_INTERVAL_MS,
  type PortScanTarget,
} from "./portSampler.ts";
import { PortScanError } from "./portScan.ts";

const quietLog = {
  error: () => {},
  fatal: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  // biome-ignore lint/suspicious/noExplicitAny: a pino stand-in, not a pino
} as any;

const ONE: PortScanTarget[] = [{ id: "A" as TerminalId, rootPid: 100 }];
const PORT: PortInfo = { port: 8080, name: "node", wildcard: true };

/** Let a pass settle. One pass is `read → scan → publish` — several promise hops,
 *  so advancing the clock alone leaves the publish in the microtask queue. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** A sampler over a scan the test drives: `passes` counts them, `answer` is what
 *  the next one returns, and `hold` (when set) keeps a pass in flight.
 *
 *  The FIRST pass's answer is an option rather than a setter call, because the poll
 *  source starts its T+0 seed read synchronously with the sampler — there is no
 *  window between construction and the first scan to reach into. */
function harness(
  opts: {
    targets?: PortScanTarget[];
    answer?: PortInfo[];
    answerRaw?: Map<number, PortInfo[]>;
    fail?: Error;
  } = {},
) {
  const published: Array<[TerminalId, readonly PortInfo[]]> = [];
  let passes = 0;
  let release: (() => void) | undefined;
  let answer =
    opts.answerRaw ??
    new Map<number, PortInfo[]>(opts.answer ? [[100, opts.answer]] : []);
  let failWith: Error | undefined = opts.fail;
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
    /** What a target last heard, which is the fact its consumer sees. */
    lastPublished: (id: string) =>
      published.filter(([pid]) => pid === id).at(-1)?.[1],
    passes: () => passes,
    setAnswer: (ports: PortInfo[]) => {
      answer = new Map([[100, ports]]);
    },
    /** Answer with a map the test spells itself — for the case where the scan
     *  fails to answer for a requested root pid at all. */
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
      await settle();
    },
    /** Let the T+0 seed read land — the poll source seeds before it installs the
     *  cadence, so every test starts from one completed pass. */
    seeded: settle,
    /** Advance the clock and let whatever it started settle. */
    advance: async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      await settle();
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the port sampler's cadence", () => {
  it("scans at T+0 and publishes each target's set", async () => {
    // The reactor's seed read: the first sample lands as soon as the sampler is
    // armed rather than one baseline later.
    const h = harness({ answer: [PORT] });
    await h.seeded();

    expect(h.passes()).toBe(1);
    expect(h.published).toEqual([["A", [PORT]]]);
    h.sampler.dispose();
  });

  it("keeps ticking on the baseline", async () => {
    const h = harness();
    await h.seeded();
    await h.advance(PORT_SCAN_INTERVAL_MS * 3);
    expect(h.passes()).toBe(4); // the seed, then one per interval
    h.sampler.dispose();
  });

  it("publishes an EMPTY set for a target whose ports are gone", async () => {
    // The port-death half of the contract, which PRT2's auto-cancel rides on: a
    // terminal serving nothing must hear the empty set rather than being left at
    // its last sample forever.
    const h = harness({ answer: [PORT] });
    await h.seeded();
    h.setAnswer([]);
    await h.advance(PORT_SCAN_INTERVAL_MS);

    expect(h.published).toEqual([
      ["A", [PORT]],
      ["A", []],
    ]);
    h.sampler.dispose();
  });

  it("a nudge pulls the scan forward instead of waiting out the baseline", async () => {
    const h = harness();
    await h.seeded();
    expect(h.passes()).toBe(1);

    h.sampler.nudge();
    await settle();
    expect(h.passes()).toBe(2);
    h.sampler.dispose();
  });

  it("floors a burst of nudges to one pass per minimum gap", async () => {
    // An agent streaming output nudges constantly; without the floor this is an
    // unbounded scan loop.
    const h = harness();
    await h.seeded();
    const before = h.passes();

    for (let i = 0; i < 50; i++) {
      h.sampler.nudge();
      await h.advance(10);
    }

    // 50 nudges over ~500 ms — less than one gap, so at most one extra pass.
    expect(h.passes() - before).toBeLessThanOrEqual(1);
    h.sampler.dispose();
  });

  it("is single-flight, and re-runs for a nudge that landed mid-pass", async () => {
    // The pass in flight may have read the socket table BEFORE the listener that
    // prompted the nudge existed, so its result cannot be treated as covering it.
    // The poll source latches such a tick and runs a trailing read: never two
    // overlapping reads, and never a dropped edge.
    const h = harness();
    h.hold();
    await h.seeded();
    expect(h.passes()).toBe(1);

    h.sampler.nudge();
    h.sampler.nudge();
    expect(h.passes()).toBe(1); // no overlap

    await h.finish();
    expect(h.passes()).toBe(2); // the latched nudge earned its own pass
    h.sampler.dispose();
  });

  it("does no OS work at all when there are no terminals", async () => {
    const h = harness({ targets: [] });
    await h.seeded();
    await h.advance(PORT_SCAN_INTERVAL_MS * 3);
    expect(h.passes()).toBe(0);
    expect(h.published).toEqual([]);
    h.sampler.dispose();
  });

  it("a BLIND scan re-serves the last sample rather than an empty set", async () => {
    // The `caught-error-must-not-collapse-to-empty` rule at its sharpest: an
    // EACCES on a requested subtree means "we cannot see", and publishing `[]`
    // would render byte-identically to "this terminal serves nothing". Re-serving
    // the last map restates the same fact, which the per-terminal sensor's
    // structural dedup then drops.
    const h = harness({ answer: [PORT] });
    await h.seeded();
    expect(h.lastPublished("A")).toEqual([PORT]);

    h.setFailure(new Error("EACCES on /proc/4242/fd"));
    await h.advance(PORT_SCAN_INTERVAL_MS);

    expect(h.lastPublished("A")).toEqual([PORT]);
    expect(h.published.some(([, ports]) => ports.length === 0)).toBe(false);
    h.sampler.dispose();
  });

  it("treats a scan that skipped a requested terminal as BLIND, not as empty", async () => {
    // The scan promises a sample per requested root pid. A missing key means it
    // failed to answer for that subtree, and publishing `[]` for it would say
    // "serves nothing".
    const h = harness({ answer: [PORT] });
    await h.seeded();

    h.setAnswerRaw(new Map());
    await h.advance(PORT_SCAN_INTERVAL_MS);

    expect(h.lastPublished("A")).toEqual([PORT]);
    expect(h.published.some(([, ports]) => ports.length === 0)).toBe(false);
    h.sampler.dispose();
  });

  it("publishes NOTHING from a pass that answered for only some targets", async () => {
    // The all-or-nothing property, stated on the case that used to break it: a
    // per-target publish loop that threw on the first missing key had already
    // published the targets ahead of it, so which halves landed depended on
    // iteration order.
    const two: PortScanTarget[] = [
      { id: "A" as TerminalId, rootPid: 100 },
      { id: "B" as TerminalId, rootPid: 200 },
    ];
    const h = harness({ targets: two, answerRaw: new Map([[100, [PORT]]]) });
    await h.seeded();

    expect(h.published).toEqual([]);
    h.sampler.dispose();
  });

  it("STOPS on a permanently unreadable host instead of looping the error", async () => {
    // The two failure axes have opposite right answers. A blind pass retries (the
    // two cases above); an unsupported platform can never become readable, so
    // retrying it every 5 s is a caught error degrading into a log loop.
    const fatal = new PortScanError(
      "unsupported-platform",
      "port scan: unsupported platform 'sunos'",
    );
    const h = harness({ fail: fatal });
    await h.seeded();
    expect(h.passes()).toBe(1);

    await h.advance(PORT_SCAN_INTERVAL_MS * 5);
    expect(h.passes()).toBe(1); // never retried
    expect(h.published).toEqual([]);
  });

  it("recovers its cadence after a failed pass", async () => {
    const h = harness({ fail: new Error("nope") });
    await h.seeded();
    await h.advance(PORT_SCAN_INTERVAL_MS * 2);
    expect(h.passes()).toBe(3); // the failed seed, then both baselines
    h.sampler.dispose();
  });

  it("stops scanning once disposed", async () => {
    const h = harness();
    await h.seeded();
    h.sampler.dispose();
    await h.advance(PORT_SCAN_INTERVAL_MS * 5);
    expect(h.passes()).toBe(1);
  });
});

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
import pino, { type Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPortSampler,
  nudgeFloorMs,
  PORT_SCAN_INTERVAL_MS,
  type PortScanTarget,
} from "./portSampler.ts";
import { PortScanError, portScanSupported } from "@kolu/port-scan";

const quietLog = pino({ level: "silent" });

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
  const published: Array<[TerminalId, readonly PortInfo[] | "unknown"]> = [];
  let passes = 0;
  let release: (() => void) | undefined;
  let answer =
    opts.answerRaw ??
    new Map<number, PortInfo[]>(opts.answer ? [[100, opts.answer]] : []);
  let failWith: Error | undefined = opts.fail;
  const sampler = createPortSampler({
    targets: () => [...(opts.targets ?? ONE)],
    rootPidOf: (id) => (opts.targets ?? ONE).find((x) => x.id === id)?.rootPid,
    publish: (id, ports) =>
      published.push([id, ports.status === "known" ? ports.list : "unknown"]),
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

/** A pino stand-in that records only what this suite asserts on. */
function platformLog(errors: string[]): Logger {
  // A real pino with its `error` intercepted, so `child()` and every other method
  // still exist — the stub this replaced had none.
  const log = pino({ level: "silent" });
  return Object.assign(Object.create(log) as Logger, {
    error: (_obj: unknown, msg?: string) => {
      if (msg !== undefined) errors.push(msg);
    },
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("the nudge floor is duty-cycle bounded", () => {
  it("leaves a fast pass at the 1 s minimum", () => {
    // The platforms that matter today. If this ever stops holding, the bound has
    // started taxing the common case, which it must not.
    expect(nudgeFloorMs(0)).toBe(1_000); // no measurement yet
    expect(nudgeFloorMs(3)).toBe(1_000); // the spike's linux figure
    expect(nudgeFloorMs(18)).toBe(1_000); // linux, batched, on a 515-process box
    expect(nudgeFloorMs(17)).toBe(1_000); // a quiet Mac
    // 50 ms is the largest pass that still fits under the minimum: 50 * 20 = 1000.
    expect(nudgeFloorMs(50)).toBe(1_000);
  });

  it("stretches a SLOW pass so it cannot exceed ~5% of a core", () => {
    // The measured busy-Mac pass. At the old fixed 1 s floor this was ~9% of a core
    // for as long as any terminal streamed output; the bound is what makes that
    // impossible without naming a platform.
    expect(nudgeFloorMs(93)).toBe(1_860);
    expect(93 / nudgeFloorMs(93)).toBeLessThanOrEqual(0.05);
    // And an arbitrary slow pass, to show the ratio is the invariant rather than
    // these particular numbers.
    for (const ms of [60, 120, 200, 249]) {
      expect(ms / nudgeFloorMs(ms)).toBeLessThanOrEqual(0.05);
    }
  });

  it("saturates rather than growing without limit", () => {
    // Past 5 s the nudge would stop being a nudge, and the 5 s BASELINE is still
    // running underneath — so a pathological pass must not push the floor past it.
    expect(nudgeFloorMs(250)).toBe(5_000); // exactly at the cap
    expect(nudgeFloorMs(5_000)).toBe(5_000); // a pass as slow as the baseline
    expect(nudgeFloorMs(60_000)).toBe(5_000); // absurd, still bounded
  });
});

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

describe("a sample belongs to the lifecycle that produced it", () => {
  // Sleep/wake deliberately reuses a terminal's UUID and gives it a NEW root pid.
  // Keyed by id alone, a sample captured before the sleep was published into the
  // WOKEN terminal's fresh sensor — whose dedup baseline had just been reset, so it
  // emitted them: the Inspector would show, and offer to open, a service that was
  // never attributed to the current PTY.
  it("does NOT publish a pre-sleep sample to the same id on a new root pid", async () => {
    const targets: PortScanTarget[] = [{ id: "A" as TerminalId, rootPid: 100 }];
    const published: Array<[TerminalId, readonly PortInfo[] | "unknown"]> = [];
    let release: (() => void) | undefined = () => {};
    const sampler = createPortSampler({
      targets: () => [...targets],
      rootPidOf: (id) => targets.find((t) => t.id === id)?.rootPid,
      publish: (id, ports) =>
        published.push([id, ports.status === "known" ? ports.list : "unknown"]),
      log: quietLog,
      scan: async () => {
        if (release !== undefined) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return new Map([[100, [PORT]]]);
      },
    });

    // The pass is in flight against rootPid 100…
    await settle();
    // …and while it is, the terminal sleeps and wakes: same id, new pid.
    targets[0] = { id: "A" as TerminalId, rootPid: 999 };
    release?.();
    release = undefined;
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    expect(published).toEqual([]);
    sampler.dispose();
  });

  it("publishes normally when the lifecycle did not change under it", async () => {
    // The control: same test, same held pass, no wake — so the freshness check must
    // not be silently swallowing every publish.
    const h = harness({ answer: [PORT] });
    await h.seeded();
    expect(h.published).toEqual([["A", [PORT]]]);
    h.sampler.dispose();
  });

  it("a blind pass re-serves ONLY to the lifecycle that produced the sample", async () => {
    const targets: PortScanTarget[] = [{ id: "A" as TerminalId, rootPid: 100 }];
    const published: Array<[TerminalId, readonly PortInfo[] | "unknown"]> = [];
    let fail = false;
    const sampler = createPortSampler({
      targets: () => [...targets],
      rootPidOf: (id) => targets.find((t) => t.id === id)?.rootPid,
      publish: (id, ports) =>
        published.push([id, ports.status === "known" ? ports.list : "unknown"]),
      log: quietLog,
      scan: async (pids) => {
        if (fail) throw new PortScanError("blind", "EACCES");
        return new Map(pids.map((p) => [p, [PORT]]));
      },
    });
    await settle();
    expect(published).toHaveLength(1); // the good seed

    // Wake under it, then go blind: the held last-good sample belongs to pid 100 and
    // must not be re-served to pid 999.
    targets[0] = { id: "A" as TerminalId, rootPid: 999 };
    fail = true;
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS);
    await settle();

    expect(published).toHaveLength(1);
    sampler.dispose();
  });
});

describe("the platform refusal is permanent, and asked before the cadence", () => {
  it("portScanSupported is true only for the two platforms with a reader", () => {
    expect(portScanSupported()).toBe(
      process.platform === "linux" || process.platform === "darwin",
    );
  });

  it("installs NO cadence and never scans on an unsupported platform", async () => {
    // The contract: checking the platform INSIDE the read could not deliver "say it
    // once, then stop" — a first read on a host with no terminals yet answers an
    // empty map without reaching the platform switch, so the refusal landed on a
    // later tick where the poll source logs and HOLDS, and "stop" quietly became an
    // error every 5 s forever.
    //
    // Two earlier versions of this test could not detect a fall-through mutant, and
    // both failures are worth naming because they were the same shape — an
    // assertion whose subject could not vary:
    //   1. "one log line, no publishes" over EMPTY targets: an armed poll source
    //      also scans nothing and publishes nothing there.
    //   2. a timer count read after settling: a mutant that armed, rejected its
    //      unsupported seed and tore down would be back at the baseline by then, and
    //      the `scans` counter had no producer at all because attaching one used to
    //      BYPASS the guard.
    // The guard is unconditional now, so the counting scan below is really attached
    // to the code under test — a mutant that logs and arms anyway WILL scan.
    const real = process.platform;
    Object.defineProperty(process, "platform", { value: "sunos" });
    try {
      const errors: string[] = [];
      let scans = 0;
      const sampler = createPortSampler({
        targets: () => [...ONE], // a real target: an armed sampler would scan
        rootPidOf: (id) => ONE.find((t) => t.id === id)?.rootPid,
        publish: () => {
          throw new Error("must not publish on an unsupported platform");
        },
        log: platformLog(errors),
        scan: async () => {
          scans += 1;
          return new Map();
        },
      });
      await settle();
      await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS * 5);

      expect(scans).toBe(0); // never armed, so never read
      expect(errors).toHaveLength(1); // said ONCE, not once per tick
      sampler.nudge(); // and a nudge into a refused sampler is inert
      await settle();
      expect(scans).toBe(0);
      sampler.dispose();
    } finally {
      Object.defineProperty(process, "platform", { value: real });
    }
  });

  it("DOES scan on a supported platform (the control)", async () => {
    // Without this, the `scans === 0` assertion above could pass simply because the
    // harness never counts for any sampler.
    const h = harness();
    await h.seeded();
    expect(h.passes()).toBeGreaterThan(0);
    h.sampler.dispose();
  });
});

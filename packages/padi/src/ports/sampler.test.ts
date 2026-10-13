/**
 * The port sampler's CADENCE — the properties the scan's promptness and its cost
 * both rest on, driven on fake timers so they are facts rather than hopes.
 *
 * The loop itself is the reactor's poll source now, which has its own tests; what
 * is pinned here is what padi DECLARES on top of it and what a consumer can
 * observe: the T+0 seed, the 5 s baseline (the ONLY thing that starts a pass —
 * output no longer pulls one forward, juspay/kolu#2286), single-flight with a
 * mid-pass tick latching one trailing pass, a blind pass never publishing an
 * empty set, an all-or-nothing pass, and teardown.
 */

import type {
  HostListeners,
  PortInfo,
  TerminalId,
} from "@kolu/terminal-vocab/schema";
import pino, { type Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPortSampler,
  PORT_SCAN_INTERVAL_MS,
  type PortScanTarget,
} from "./sampler.ts";
import { type PortScan, PortScanError, portScanSupported } from "./scan.ts";

const quietLog = pino({ level: "silent" });

const ONE: PortScanTarget[] = [{ id: "A" as TerminalId, rootPid: 100 }];
const PORT: PortInfo = {
  port: 8080,
  name: "node",
  command: "node server.js",
  scope: "any",
  family: "v4",
};

/** A detached server — on the host, in no terminal's subtree. */
const DAEMON: PortInfo = {
  port: 18440,
  name: "bun",
  command: "bun odu web-daemon",
  scope: "loopback",
  family: "v4",
};

/** A scan answer: the per-root map, and a host reading holding every port in it
 *  plus whatever else is on the host. */
function scanOf(
  byRoot: Map<number, PortInfo[] | "blind">,
  elsewhere: PortInfo[] = [],
): PortScan {
  const held = [...byRoot.values()].flatMap((v) => (v === "blind" ? [] : v));
  return {
    byRoot,
    host: {
      status: "known",
      claimed: [
        ...held.map((p) => ({ ...p, heldByTerminal: true })),
        ...elsewhere.map((p) => ({ ...p, heldByTerminal: false })),
      ].sort((a, b) => a.port - b.port),
      unclaimed: { status: "known", list: [] },
    },
    dropped: [],
    exited: [],
  };
}

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
    answerRaw?: Map<number, PortInfo[] | "blind">;
    /** Listeners on the host outside every requested subtree. */
    elsewhere?: PortInfo[];
    fail?: Error;
  } = {},
) {
  const published: Array<[TerminalId, readonly PortInfo[] | "unknown"]> = [];
  const hostPublished: HostListeners[] = [];
  let elsewhere = opts.elsewhere ?? [];
  let passes = 0;
  let release: (() => void) | undefined;
  let answer =
    opts.answerRaw ??
    new Map<number, PortInfo[] | "blind">(
      opts.answer ? [[100, opts.answer]] : [],
    );
  let failWith: Error | undefined = opts.fail;
  const sampler = createPortSampler({
    targets: () => [...(opts.targets ?? ONE)],
    rootPidOf: (id) => (opts.targets ?? ONE).find((x) => x.id === id)?.rootPid,
    publish: (id, ports) =>
      published.push([id, ports.status === "known" ? ports.list : "unknown"]),
    publishHost: (listeners) => hostPublished.push(listeners),
    log: quietLog,
    scan: async () => {
      passes += 1;
      if (release !== undefined) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      if (failWith !== undefined) throw failWith;
      return scanOf(answer, elsewhere);
    },
  });
  return {
    sampler,
    published,
    hostPublished,
    setElsewhere: (ports: PortInfo[]) => {
      elsewhere = ports;
    },
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

  it("is single-flight: baseline ticks landing mid-pass latch ONE trailing pass", async () => {
    // A pass slower than the baseline must never overlap the next tick, and the
    // ticks must not be dropped either — the poll source latches them and runs a
    // single trailing read once the pass in flight completes. With the nudge gone
    // this is the ONLY way two passes can contend, so it is the only overlap rule
    // left to pin.
    const h = harness();
    await h.seeded();
    h.hold();
    await h.advance(PORT_SCAN_INTERVAL_MS);
    expect(h.passes()).toBe(2); // the held pass

    await h.advance(PORT_SCAN_INTERVAL_MS * 2);
    expect(h.passes()).toBe(2); // two ticks landed; neither overlapped

    await h.finish();
    expect(h.passes()).toBe(3); // and they coalesced into ONE trailing pass
    h.sampler.dispose();
  });

  it("keeps watching the HOST at zero terminals, publishing no terminal", async () => {
    // A detached server outlives its terminal; the reaper needs the host reading
    // after the last terminal closes. The sampler arms only on padi's first
    // terminal, so this costs nothing on a padi that never ran one.
    const h = harness({ targets: [], elsewhere: [DAEMON] });
    await h.seeded();
    await h.advance(PORT_SCAN_INTERVAL_MS * 3);
    expect(h.passes()).toBe(4);
    expect(h.published).toEqual([]);
    expect(h.hostPublished.at(-1)).toMatchObject({
      claimed: [{ ...DAEMON, heldByTerminal: false }],
    });
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

  it("STOPS on a permanent failure discovered at a LATER pass too — the verdict is timing-independent", async () => {
    // The symmetry the old shape could not have: "permanent ⇒ stop" used to be
    // spelled by letting the T+0 seed rejection kill the connector, so the exact
    // same error at tick 3 only logged and re-armed — forever. Since #2101 G1 a
    // poll read's failure is cell-local at EVERY tick, so the sampler makes the
    // stop decision itself, at whichever pass produces the verdict.
    const h = harness({ answer: [PORT] });
    await h.seeded();
    expect(h.passes()).toBe(1);

    h.setFailure(
      new PortScanError(
        "unsupported-platform",
        "port scan: unsupported platform 'sunos'",
      ),
    );
    await h.advance(PORT_SCAN_INTERVAL_MS);
    expect(h.passes()).toBe(2); // the pass that learned it

    await h.advance(PORT_SCAN_INTERVAL_MS * 5);
    expect(h.passes()).toBe(2); // …and the cadence is gone, not looping the error
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

describe("the host's listeners ride the same pass", () => {
  it("publishes a listener outside every terminal's subtree", async () => {
    // The detached-server case this reading exists for: the daemon is in no
    // terminal's `ports`, and it IS in the host reading from the same pass.
    const h = harness({ answer: [PORT], elsewhere: [DAEMON] });
    await h.seeded();

    expect(h.lastPublished("A")).toEqual([PORT]);
    expect(h.hostPublished.at(-1)).toEqual({
      status: "known",
      claimed: [
        { ...PORT, heldByTerminal: true },
        { ...DAEMON, heldByTerminal: false },
      ],
      unclaimed: { status: "known", list: [] },
    });
    h.sampler.dispose();
  });

  it("republishes an unchanged reading every pass, and the change when it comes", async () => {
    // The sampler does not dedup the host: its one sink, the `hostListeners`
    // cell, owns that with `hostListenersEqual`.
    const h = harness({ answer: [], elsewhere: [DAEMON] });
    await h.seeded();
    await h.advance(PORT_SCAN_INTERVAL_MS);
    const [first, second] = h.hostPublished;
    expect(first?.status).toBe("known");
    expect(second).toEqual(first);

    h.setElsewhere([]);
    await h.advance(PORT_SCAN_INTERVAL_MS);
    expect(h.hostPublished.at(-1)).toMatchObject({ claimed: [] });
    h.sampler.dispose();
  });

  it("a BLIND pass re-serves the last host reading rather than unknown or empty", async () => {
    // One pass that could not see is not news that every server stopped — and
    // it is not news that we stopped looking, either.
    const h = harness({ answer: [], elsewhere: [DAEMON] });
    await h.seeded();
    const good = h.hostPublished.at(-1);
    expect(good?.status).toBe("known");

    h.setFailure(new PortScanError("blind", "EACCES"));
    await h.advance(PORT_SCAN_INTERVAL_MS);

    expect(h.hostPublished.at(-1)).toBe(good);
    h.sampler.dispose();
  });

  it("keeps the host reading LIVE after the last terminal closes", async () => {
    // The detached server's door must still be reaped when the server dies, and
    // that takes a fresh reading, not a frozen or unknown one.
    const targets: PortScanTarget[] = [...ONE];
    let elsewhere: PortInfo[] = [DAEMON];
    const hostPublished: HostListeners[] = [];
    let passes = 0;
    const sampler = createPortSampler({
      targets: () => [...targets],
      rootPidOf: (id) => targets.find((t) => t.id === id)?.rootPid,
      publish: () => {},
      publishHost: (listeners) => hostPublished.push(listeners),
      log: quietLog,
      scan: async (pids) => {
        passes += 1;
        return scanOf(new Map(pids.map((p) => [p, []])), elsewhere);
      },
    });
    await settle();
    expect(hostPublished.at(-1)).toMatchObject({
      claimed: [{ ...DAEMON, heldByTerminal: false }],
    });

    targets.length = 0;
    elsewhere = [];
    await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS);
    await settle();

    expect(passes).toBe(2);
    expect(hostPublished.at(-1)).toMatchObject({
      status: "known",
      claimed: [],
    });
    sampler.dispose();
  });

  it("an unreadable ROOT blinds only its own terminal, never the host or its siblings", async () => {
    // A terminal rooted in another user's process (`sudo -i`) must not freeze
    // every other terminal's ports and the host list.
    const two: PortScanTarget[] = [
      { id: "A" as TerminalId, rootPid: 100 },
      { id: "B" as TerminalId, rootPid: 200 },
    ];
    const h = harness({
      targets: two,
      answerRaw: new Map<number, PortInfo[] | "blind">([
        [100, [PORT]],
        [200, "blind"],
      ]),
      elsewhere: [DAEMON],
    });
    await h.seeded();

    expect(h.lastPublished("A")).toEqual([PORT]);
    expect(h.lastPublished("B")).toBeUndefined(); // stays `unknown`, never `[]`
    expect(h.hostPublished.at(-1)).toMatchObject({ status: "known" });
    h.sampler.dispose();
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
      publishHost: () => {},
      log: quietLog,
      scan: async () => {
        if (release !== undefined) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return scanOf(new Map([[100, [PORT]]]));
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
      publishHost: () => {},
      log: quietLog,
      scan: async (pids) => {
        if (fail) throw new PortScanError("blind", "EACCES");
        return scanOf(new Map(pids.map((p) => [p, [PORT]])));
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
        publishHost: () => {
          throw new Error("must not publish on an unsupported platform");
        },
        log: platformLog(errors),
        scan: async () => {
          scans += 1;
          return scanOf(new Map());
        },
      });
      await settle();
      await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS * 5);

      expect(scans).toBe(0); // never armed, so never read
      expect(errors).toHaveLength(1); // said ONCE, not once per tick
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

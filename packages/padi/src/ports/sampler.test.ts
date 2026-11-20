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
import { Effect } from "effect";

function effectScan(
  fn: (pids: readonly number[]) => Promise<PortScan>,
): (pids: readonly number[]) => Effect.Effect<PortScan, PortScanError> {
  return (pids) =>
    Effect.tryPromise({
      try: () => fn(pids),
      catch: (err) => err as PortScanError,
    });
}

const quietLog = pino({ level: "silent" });

const ONE: PortScanTarget[] = [{ id: "A" as TerminalId, rootPid: 100 }];
const PORT: PortInfo = {
  port: 8080,
  name: "node",
  command: "node server.js",
  scope: "any",
  family: "v4",
};

const DAEMON: PortInfo = {
  port: 18440,
  name: "bun",
  command: "bun odu web-daemon",
  scope: "loopback",
  family: "v4",
};

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
    unattributable: [],
    ownerExited: [],
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function harness(
  opts: {
    targets?: PortScanTarget[];
    answer?: PortInfo[];
    answerRaw?: Map<number, PortInfo[] | "blind">;
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
    scan: effectScan(async () => {
      passes += 1;
      if (release !== undefined) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      if (failWith !== undefined) throw failWith;
      return scanOf(answer, elsewhere);
    }),
  });
  return {
    sampler,
    published,
    hostPublished,
    setElsewhere: (ports: PortInfo[]) => {
      elsewhere = ports;
    },
    lastPublished: (id: string) =>
      published.filter(([pid]) => pid === id).at(-1)?.[1],
    passes: () => passes,
    setAnswer: (ports: PortInfo[]) => {
      answer = new Map([[100, ports]]);
    },
    setAnswerRaw: (map: Map<number, PortInfo[]>) => {
      answer = map;
    },
    setFailure: (err: Error) => {
      failWith = err;
    },
    hold: () => {
      release = () => {};
    },
    finish: async () => {
      release?.();
      release = undefined;
      await settle();
    },
    seeded: settle,
    advance: async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      await settle();
    },
  };
}

function platformLog(errors: string[]): Logger {
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
    expect(h.passes()).toBe(4);
    h.sampler.dispose();
  });

  it("publishes an EMPTY set for a target whose ports are gone", async () => {
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
    const h = harness();
    await h.seeded();
    h.hold();
    await h.advance(PORT_SCAN_INTERVAL_MS);
    expect(h.passes()).toBe(2);

    await h.advance(PORT_SCAN_INTERVAL_MS * 2);
    expect(h.passes()).toBe(2);

    await h.finish();
    expect(h.passes()).toBe(3);
    h.sampler.dispose();
  });

  it("keeps watching the HOST at zero terminals, publishing no terminal", async () => {
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
    const h = harness({ answer: [PORT] });
    await h.seeded();

    h.setAnswerRaw(new Map());
    await h.advance(PORT_SCAN_INTERVAL_MS);

    expect(h.lastPublished("A")).toEqual([PORT]);
    expect(h.published.some(([, ports]) => ports.length === 0)).toBe(false);
    h.sampler.dispose();
  });

  it("publishes NOTHING from a pass that answered for only some targets", async () => {
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
    const fatal = new PortScanError(
      "unsupported-platform",
      "port scan: unsupported platform 'sunos'",
    );
    const h = harness({ fail: fatal });
    await h.seeded();
    expect(h.passes()).toBe(1);

    await h.advance(PORT_SCAN_INTERVAL_MS * 5);
    expect(h.passes()).toBe(1);
    expect(h.published).toEqual([]);
  });

  it("STOPS on a permanent failure discovered at a LATER pass too — the verdict is timing-independent", async () => {
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
    expect(h.passes()).toBe(2);

    await h.advance(PORT_SCAN_INTERVAL_MS * 5);
    expect(h.passes()).toBe(2);
  });

  it("recovers its cadence after a failed pass", async () => {
    const h = harness({ fail: new Error("nope") });
    await h.seeded();
    await h.advance(PORT_SCAN_INTERVAL_MS * 2);
    expect(h.passes()).toBe(3);
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
      scan: effectScan(async (pids) => {
        passes += 1;
        return scanOf(new Map(pids.map((p) => [p, []])), elsewhere);
      }),
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
    expect(h.lastPublished("B")).toBeUndefined();
    expect(h.hostPublished.at(-1)).toMatchObject({ status: "known" });
    h.sampler.dispose();
  });
});

describe("a sample belongs to the lifecycle that produced it", () => {
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
      scan: effectScan(async () => {
        if (release !== undefined) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return scanOf(new Map([[100, [PORT]]]));
      }),
    });

    await settle();
    targets[0] = { id: "A" as TerminalId, rootPid: 999 };
    release?.();
    release = undefined;
    await vi.advanceTimersByTimeAsync(0);
    await settle();

    expect(published).toEqual([]);
    sampler.dispose();
  });

  it("publishes normally when the lifecycle did not change under it", async () => {
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
      scan: effectScan(async (pids) => {
        if (fail) throw new PortScanError("blind", "EACCES");
        return scanOf(new Map(pids.map((p) => [p, [PORT]])));
      }),
    });
    await settle();
    expect(published).toHaveLength(1);

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
    const real = process.platform;
    Object.defineProperty(process, "platform", { value: "sunos" });
    try {
      const errors: string[] = [];
      let scans = 0;
      const sampler = createPortSampler({
        targets: () => [...ONE],
        rootPidOf: (id) => ONE.find((t) => t.id === id)?.rootPid,
        publish: () => {
          throw new Error("must not publish on an unsupported platform");
        },
        publishHost: () => {
          throw new Error("must not publish on an unsupported platform");
        },
        log: platformLog(errors),
        scan: effectScan(async () => {
          scans += 1;
          return scanOf(new Map());
        }),
      });
      await settle();
      await vi.advanceTimersByTimeAsync(PORT_SCAN_INTERVAL_MS * 5);

      expect(scans).toBe(0);
      expect(errors).toHaveLength(1);
      sampler.dispose();
    } finally {
      Object.defineProperty(process, "platform", { value: real });
    }
  });

  it("DOES scan on a supported platform (the control)", async () => {
    const h = harness();
    await h.seeded();
    expect(h.passes()).toBeGreaterThan(0);
    h.sampler.dispose();
  });
});

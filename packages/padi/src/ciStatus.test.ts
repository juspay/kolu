/**
 * padi's `ciStatus` source — the demand-driven odu session, the checkout fold,
 * and the frame it publishes.
 *
 * The stub is served over a REAL unix socket, at the path the daemon's own
 * address rule derives, so the suite exercises the whole chain kolu owns: the
 * session's dial (through odu's own `dialServiceSocket`), the board follow, the
 * nodes follow, and the frame. It speaks ODU'S schemas under odu's member names
 * (`service`, `runs` with `deltas`, `nodes`) — a fixture, not a second contract:
 * a name or a verb that drifted from odu's would fail here as an unknown member
 * rather than pass against a hand-rolled shape.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CiStatusFrame } from "@kolu/padi-client/surface";
import { LOCAL_LOCATION } from "@kolu/padi-client/surface";
import type { CollectionDeltasMsg } from "@kolu/surface/define";
import { defineSurface } from "@kolu/surface/define";
import type { SurfaceDispatch } from "@kolu/surface/link";
import {
  implementSurface,
  inMemoryStore,
  streamFromAbortableSource,
} from "@kolu/surface/server";
import {
  serveOverUnixSocket,
  type UnixSocketListener,
} from "@kolu/surface/unix-socket";
import { serviceSocketPath } from "@odu/service-client/socket";
import {
  NodesFrameSchema,
  RunRowSchema,
  ServiceCellSchema,
  UNKNOWN_SERVICE,
  type NodesFrame,
  type RunNode,
  type OduServiceClient,
  type RunRow,
} from "@odu/service-client/surface";
import { Schema, Stream } from "effect";
import type { Logger } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serviceOrigin } from "@odu/service-client/endpoint";
import {
  createCiStatusSource,
  type CiStatusSourceDeps,
  type Dialed,
} from "./ciStatus.ts";
import { bridgeStream } from "./terminalEndpoint/local.ts";
import { stubLog } from "./servePadi.testlib.ts";
import {
  registerTerminal,
  unregisterTerminal,
  type ActiveTerminalProcess,
} from "./terminal-registry.ts";

const TERMINAL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHECKOUT = "/home/dev/repo";
const OTHER = "/home/dev/other";

// ── the stub daemon ─────────────────────────────────────────────────────────

/** The three odu members kolu reads, with odu's own schemas. */
const stubSurface = defineSurface({
  cells: {
    service: { schema: ServiceCellSchema, default: UNKNOWN_SERVICE },
  },
  collections: {
    runs: {
      keySchema: Schema.String,
      schema: RunRowSchema,
      verbs: ["keys", "get", "deltas"],
    },
  },
  streams: {
    nodes: {
      inputSchema: Schema.Struct({ runId: Schema.String }),
      outputSchema: NodesFrameSchema,
    },
  },
});

/** One run's scripted nodes: what the test hands it, in order, until the
 *  subscription aborts. */
function scriptedNodes(): {
  push(frame: NodesFrame): void;
  frames(signal: AbortSignal): AsyncIterable<NodesFrame>;
} {
  const queued: NodesFrame[] = [];
  let wake: (() => void) | null = null;
  return {
    push(frame) {
      queued.push(frame);
      const woken = wake;
      wake = null;
      woken?.();
    },
    async *frames(signal) {
      while (!signal.aborted) {
        const next = queued.shift();
        if (next !== undefined) {
          yield next;
          continue;
        }
        const { promise, resolve } = Promise.withResolvers<void>();
        wake = resolve;
        await promise;
      }
    },
  };
}

interface Stub {
  socketPath: string;
  put(row: RunRow): void;
  nodes(runId: string, frame: NodesFrame): void;
  close(): Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

/** A stub odu service, listening where its own address rule says it would.
 *
 *  `protocolVersion` is a parameter because the contract check is the one
 *  decision that separates "a daemon this build cannot speak" from "no daemon
 *  at all". */
async function serveStub(protocolVersion = "1.4"): Promise<Stub> {
  const home = mkdtempSync(join(tmpdir(), "padi-odu-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  const socketPath = serviceSocketPath();

  const rows = new Map<string, RunRow>();
  const scripts = new Map<string, ReturnType<typeof scriptedNodes>>();
  const scriptFor = (runId: string): ReturnType<typeof scriptedNodes> => {
    let script = scripts.get(runId);
    if (script === undefined) {
      script = scriptedNodes();
      scripts.set(runId, script);
    }
    return script;
  };
  const runtime = implementSurface(stubSurface, {
    cells: {
      service: {
        store: inMemoryStore({
          ...UNKNOWN_SERVICE,
          identity: {
            ...UNKNOWN_SERVICE.identity,
            protocolVersion,
            // A daemon names the address it is bound on; a face that links to
            // its page dials that, so a stub that left it empty would be a
            // daemon no face could reach.
            origin: serviceOrigin(),
          },
        }),
      },
    },
    collections: {
      runs: {
        readAll: () => rows,
        upsert: (key, value) => {
          rows.set(key, value);
        },
        remove: (key) => {
          rows.delete(key);
        },
      },
    },
    streams: {
      nodes: {
        source: ({ runId }) =>
          streamFromAbortableSource((signal) =>
            scriptFor(runId).frames(signal),
          ),
      },
    },
  });

  const listener: UnixSocketListener = await serveOverUnixSocket({
    socketPath,
    group: stubSurface.group,
    handlers: runtime.handlers,
    log: stubLog,
  });
  if (listener.outcome.kind !== "listening") {
    throw new Error(
      `ciStatus stub could not bind ${socketPath}: ${listener.outcome.kind}`,
    );
  }

  const close = async (): Promise<void> => {
    listener.close();
    await runtime.close();
  };
  cleanups.push(async () => {
    await close();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });

  /** Publish a board row the way odu's own service does — through the
   *  framework's WRAPPED `upsert`, which is what emits a delta. Writing the Map
   *  directly would change what `readAll` answers without ever telling a
   *  subscriber. */
  const publish = (row: RunRow): void => {
    const seam = runtime.ctx.collections?.runs;
    if (
      seam === undefined ||
      !("upsert" in seam) ||
      seam.upsert === undefined
    ) {
      throw new Error(
        "the ciStatus stub must serve the runs collection's upsert",
      );
    }
    seam.upsert(row.runId, row);
  };

  return {
    socketPath,
    put: publish,
    nodes(runId, frame) {
      scriptFor(runId).push(frame);
    },
    close,
  };
}

/** Point `HOME` at an empty home for one test — the state of a machine where odu
 *  has never run, which is what makes the daemon's socket path derivable and
 *  unbound. */
function homeWithoutOdu(): void {
  const home = mkdtempSync(join(tmpdir(), "padi-odu-absent-"));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  cleanups.push(async () => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });
}

/** Seed the ONE terminal this suite subscribes for, with a git fact naming
 *  `checkout` — padi's registry is where the source reads it from, so the test
 *  seeds the registry rather than injecting a resolver. */
function seedTerminal(checkout: string | null): void {
  registerTerminal(TERMINAL_ID, {
    info: { id: TERMINAL_ID, pid: 1 },
    meta: {
      state: "active",
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      promptedAt: null,
      themeName: "rose",
      intent: null,
    },
    snapshot: {
      cwd: checkout ?? "/tmp",
      git:
        checkout === null
          ? { kind: "none" }
          : {
              kind: "repo",
              info: {
                repoRoot: checkout,
                repoName: "repo",
                worktreePath: checkout,
                branch: "main",
                isWorktree: false,
                mainRepoRoot: checkout,
                remoteUrl: null,
              },
            },
      pr: { kind: "absent" },
      agent: null,
      foreground: null,
      ports: { status: "unknown" },
    },
    // The registry entry's control surface is never reached by this member —
    // the source reads the snapshot alone.
    handle: {},
  } as unknown as ActiveTerminalProcess);
  cleanups.push(async () => {
    unregisterTerminal(TERMINAL_ID);
  });
}

// ── fixtures ────────────────────────────────────────────────────────────────

function row(overrides: Partial<RunRow> = {}): RunRow {
  return {
    runId: "run-1",
    repo: "dev/repo",
    repoRoot: CHECKOUT,
    branch: "main",
    sha: "0123456789abcdef0123456789abcdef01234567",
    dirty: false,
    seq: 1,
    pipeline: "ci",
    createdAt: 1_000,
    state: "running",
    settled: false,
    passed: false,
    outcome: null,
    actionable: false,
    unresolvedFailures: 0,
    scope: { selectors: [], platforms: [], noDeps: false },
    reportingDebt: 0,
    endpoint: null,
    parentRunId: null,
    cursor: "run-1:0",
    ...overrides,
  };
}

function node(id: string, status: RunNode["status"]): RunNode {
  return {
    id,
    status,
    attempt: 1,
    exitCode: null,
    startedAt: null,
    durationMs: null,
    host: "box-1",
    logKey: `run-1/linux/${id}`,
  };
}

function frame(
  order: string[],
  nodes: RunNode[],
  state: NodesFrame["state"] = "running",
): NodesFrame {
  return {
    order,
    nodes,
    state,
    done: false,
    env: {
      phase: "lanes",
      elapsedMs: null,
      lanes: [],
      hostsSource: null,
      commitUrl: null,
      owed: [],
    },
  };
}

/** One open subscription, with the frames it published so far. */
interface Sub {
  frames: CiStatusFrame[];
  stop(): Promise<void>;
}

/** One subscription through the source padi serves. The session dials odu's own
 *  socket path, which `serveStub`/`homeWithoutOdu` have pointed `HOME` at — so
 *  the dial, the address rule and the absence classification are all odu's. */
async function subscribe(): Promise<Sub> {
  const ci = createCiStatusSource({ log: stubLog });
  const frames: CiStatusFrame[] = [];
  const abort = new AbortController();
  const done = bridgeStream(
    ci.source({ terminalId: TERMINAL_ID }),
    abort.signal,
    (item) => frames.push(item),
  );
  return {
    frames,
    stop: async () => {
      abort.abort();
      await done;
    },
  };
}

/** Await the first frame past `from` that `pick` accepts — the ACTUAL frame,
 *  retried rather than slept for. The failure names what did arrive. */
async function frameWhere(
  sub: Sub,
  from: number,
  label: string,
  pick: (frame: CiStatusFrame) => boolean,
): Promise<CiStatusFrame> {
  return vi.waitFor(
    () => {
      const found = sub.frames.slice(from).find(pick);
      if (found === undefined) {
        throw new Error(
          `${label} — frames seen: ${JSON.stringify(sub.frames.slice(from))}`,
        );
      }
      return found;
    },
    { timeout: 5_000 },
  );
}

const isStatus = (
  frame: CiStatusFrame,
): frame is Extract<CiStatusFrame, { kind: "status" }> =>
  frame.kind === "status";

describe("padi's ciStatus source", () => {
  it("answers none when nothing is serving the daemon's socket", async () => {
    homeWithoutOdu();
    seedTerminal(CHECKOUT);
    const sub = await subscribe();
    expect(await frameWhere(sub, 0, "no frame arrived", () => true)).toEqual({
      kind: "none",
    });
    await sub.stop();
  });

  it("publishes the checkout's latest run and its lanes, and follows a node delta", async () => {
    const stub = await serveStub();
    seedTerminal(CHECKOUT);
    stub.put(row());
    const sub = await subscribe();

    // The run's own frame arrives first (the board is read before its lanes
    // are), then the nodes follow's first frame re-states it WITH lanes.
    await frameWhere(
      sub,
      0,
      "the run's board frame never arrived",
      (f) => isStatus(f) && f.latest.run.runId === "run-1",
    );
    stub.nodes("run-1", frame(["build@linux"], [node("build@linux", "ok")]));
    const withLanes = await frameWhere(
      sub,
      0,
      "the lanes never arrived",
      (f) => isStatus(f) && f.latest.lanes.length > 0,
    );
    expect(withLanes).toMatchObject({
      kind: "status",
      latest: {
        run: { runId: "run-1", repoRoot: CHECKOUT },
        lanes: [{ id: "build@linux", status: "ok" }],
      },
      recent: [{ runId: "run-1" }],
    });

    // A lane transition is a NEW frame — the whole point of following `nodes`
    // rather than sampling the board.
    const mark = sub.frames.length;
    stub.nodes(
      "run-1",
      frame(["build@linux"], [node("build@linux", "failed")]),
    );
    const moved = await frameWhere(
      sub,
      mark,
      "the lane transition never arrived",
      (f) => isStatus(f) && f.latest.lanes[0]?.status === "failed",
    );
    expect(moved).toMatchObject({
      kind: "status",
      latest: { lanes: [{ id: "build@linux", status: "failed" }] },
    });
    await sub.stop();
  });

  it("swaps the lanes when a NEWER run of the checkout appears", async () => {
    const stub = await serveStub();
    seedTerminal(CHECKOUT);
    stub.put(row({ runId: "run-1", createdAt: 1_000 }));
    const sub = await subscribe();
    stub.nodes("run-1", frame(["a@linux"], [node("a@linux", "ok")]));
    await frameWhere(
      sub,
      0,
      "the first run's lanes never arrived",
      (f) => isStatus(f) && f.latest.lanes.length > 0,
    );

    const mark = sub.frames.length;
    stub.put(row({ runId: "run-2", createdAt: 2_000, seq: 2 }));
    stub.nodes("run-2", frame(["b@linux"], [node("b@linux", "running")]));
    const latest = await frameWhere(
      sub,
      mark,
      "the newer run never became the latest",
      (f) => isStatus(f) && f.latest.lanes[0]?.id === "b@linux",
    );
    expect(latest).toMatchObject({
      kind: "status",
      latest: { run: { runId: "run-2" }, lanes: [{ id: "b@linux" }] },
      recent: [{ runId: "run-2" }, { runId: "run-1" }],
    });
    await sub.stop();
  });

  it("answers none for a checkout with no runs of its own", async () => {
    const stub = await serveStub();
    seedTerminal(CHECKOUT);
    // A run of ANOTHER checkout: the board has rows, none of them ours.
    stub.put(row({ repoRoot: OTHER }));
    const sub = await subscribe();
    expect(await frameWhere(sub, 0, "no frame arrived", () => true)).toEqual({
      kind: "none",
    });
    await sub.stop();
  });

  it("FAILS the subscription when the daemon answers and cannot be read", async () => {
    // The distinction this module exists to keep: a daemon that answers with a
    // contract this build cannot read is a live problem, and reporting it as
    // absence would hide a broken install behind a blank panel. So the stream
    // FAILS — the Inspector draws that failure — rather than yielding `none`
    // forever.
    const stub = await serveStub("9.9");
    seedTerminal(CHECKOUT);
    stub.put(row());
    const error = vi.fn();
    const log = { ...stubLog, error } as unknown as Logger;
    const ci = createCiStatusSource({ log });
    const frames: CiStatusFrame[] = [];
    const failures: unknown[] = [];
    const abort = new AbortController();
    const done = bridgeStream(
      ci.source({ terminalId: TERMINAL_ID }),
      abort.signal,
      (f) => frames.push(f),
      (err) => failures.push(err),
    );
    await vi.waitFor(
      () => {
        if (failures.length === 0) {
          throw new Error("the subscription never failed");
        }
      },
      { timeout: 10_000 },
    );
    expect(String(failures[0])).toMatch(/speaks service contract 9\.9/);
    // …and it says so in the log, with the versions, for a machine nobody is
    // looking at.
    expect(
      error.mock.calls.some((call) =>
        String(call[1] ?? "").includes("refused this build"),
      ),
    ).toBe(true);
    // No `status` frame was ever painted from a daemon this build cannot read.
    expect(frames.every((frame) => frame.kind === "none")).toBe(true);
    abort.abort();
    await done;
    await ci.dispose();
  });
});

// ── the session's own lifecycle ─────────────────────────────────────────────
//
// These cases are about the SESSION rather than the wire: how many times it
// dials, when it lets a link go, and what a subscriber sees when a link drops.
// The face is built here instead of over a socket because a link that DROPS on
// command is not something a real daemon can be asked for.

/** A dialled connection over a face this suite controls: one board snapshot per
 *  dial, then a runs stream that STAYS OPEN until the test drops it, and a nodes
 *  follow that yields nothing. A stream that ended by itself would make every
 *  fake link look like a dropped one, which is a fact about the fixture rather
 *  than about the session. */
function fakeDial(perDial: (dial: number) => RunRow[]): {
  dial: () => Promise<Dialed>;
  dials: () => number;
  disposals: () => number;
  /** End the current link's runs stream — what a dropped link looks like. */
  drop: () => void;
} {
  let dials = 0;
  let disposals = 0;
  /** Resolved by {@link drop}; each dial gets its own. */
  let release: () => void = () => {};
  return {
    dial: async () => {
      dials += 1;
      const rows = perDial(dials);
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const face = {
        surface: {
          runs: {
            deltas: () =>
              Stream.fromAsyncIterable<
                CollectionDeltasMsg<string, RunRow>,
                unknown
              >(
                (async function* runs() {
                  yield {
                    kind: "snapshot",
                    entries: rows.map((r) => [r.runId, r] as [string, RunRow]),
                  };
                  // Open until the test says the link dropped.
                  await held;
                })(),
                (err) => err,
              ),
          },
          nodes: { get: () => Stream.empty },
        },
      };
      return {
        dial: {
          kind: "connected",
          socketPath: "/tmp/fake-odu.sock",
          client: face as unknown as OduServiceClient,
          dispatch: {} as unknown as SurfaceDispatch,
          dispose: async () => {
            disposals += 1;
          },
        },
        // A daemon's own answer for where it is bound — the frame carries it.
        originPort: 18440,
      };
    },
    dials: () => dials,
    disposals: () => disposals,
    drop: () => release(),
  };
}

/** Open one subscription and hand back its frames, plus the first frame as a
 *  promise — a real signal to await instead of a timer. */
function openSubscription(ci: CiStatusSourceDeps): {
  frames: CiStatusFrame[];
  first: Promise<CiStatusFrame>;
  stop: () => void;
} {
  const frames: CiStatusFrame[] = [];
  let resolveFirst: (frame: CiStatusFrame) => void = () => {};
  const first = new Promise<CiStatusFrame>((resolve) => {
    resolveFirst = resolve;
  });
  const abort = new AbortController();
  void bridgeStream(
    ci.source({ terminalId: TERMINAL_ID }),
    abort.signal,
    (frame) => {
      frames.push(frame);
      resolveFirst(frame);
    },
    () => {},
  );
  return { frames, first, stop: () => abort.abort() };
}

/** Let every pending microtask run (fake timers do not advance microtasks). */
const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

/** The last STATUS frame a subscription saw — the board it is presently
 *  painting. Asking for the last frame instead would pin the interleaving
 *  between a board event and a link's own drop, which is not a promise this
 *  side makes: a `none` in that window says only that nobody is serving. */
function lastStatus(frames: CiStatusFrame[]) {
  const statuses = frames.filter(isStatus);
  const latest = statuses[statuses.length - 1];
  if (latest === undefined) {
    throw new Error(
      `no status frame arrived — frames: ${JSON.stringify(frames)}`,
    );
  }
  return latest;
}

describe("padi's ciStatus session", () => {
  it("dials only for subscribers, and only ONCE for many of them", async () => {
    const fake = fakeDial(() => [row()]);
    const ci = createCiStatusSource({ log: stubLog, dial: fake.dial });
    seedTerminal(CHECKOUT);

    // Nobody is looking: the session does not dial.
    await settle();
    expect(fake.dials()).toBe(0);

    const a = openSubscription(ci);
    const b = openSubscription(ci);
    await a.first;
    await b.first;
    expect(fake.dials()).toBe(1);

    a.stop();
    b.stop();
    await ci.dispose();
  });

  it("lets the link go only after the retire grace, not on the last unsubscribe", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const fake = fakeDial(() => [row()]);
      const ci = createCiStatusSource({ log: stubLog, dial: fake.dial });
      seedTerminal(CHECKOUT);
      const sub = openSubscription(ci);
      await sub.first;
      expect(fake.disposals()).toBe(0);

      // The last subscriber leaves: the session RETIRES, it does not die — the
      // Inspector re-keys its subscription onto the focused pane, so a focus
      // switch must not rebuild the dial (#2286's lesson).
      sub.stop();
      await settle();
      expect(fake.disposals()).toBe(0);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(fake.disposals()).toBe(1);
      await ci.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-dials after a drop and opens the new link's board FRESH", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      // The first link's board holds one run; the second link's holds another.
      // A session that kept the old board would paint both.
      const fake = fakeDial((dial) =>
        dial === 1 ? [row({ runId: "run-1" })] : [row({ runId: "run-2" })],
      );
      const ci = createCiStatusSource({ log: stubLog, dial: fake.dial });
      seedTerminal(CHECKOUT);
      const sub = openSubscription(ci);
      await sub.first;
      expect(lastStatus(sub.frames)).toMatchObject({
        kind: "status",
        latest: { run: { runId: "run-1" } },
      });

      // The link drops. The session re-dials on its own ladder and the new
      // snapshot REPLACES the board.
      fake.drop();
      await vi.advanceTimersByTimeAsync(5_000);
      await settle();
      expect(fake.dials()).toBe(2);
      expect(lastStatus(sub.frames)).toMatchObject({
        kind: "status",
        latest: { run: { runId: "run-2" } },
        recent: [{ runId: "run-2" }],
      });
      sub.stop();
      await ci.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

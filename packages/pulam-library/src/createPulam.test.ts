/**
 * `createPulam` — pins that the ONE assembly returns the full served-surface
 * deps with a LIVE activity source over its own tracker (not the quiet stub), and
 * keeps the awareness write target injected verbatim. The per-terminal sensor
 * behaviour (driven by a real kaval) is covered end-to-end by the pulam daemon's
 * integration test; this is the fast, kaval-free assembly assertion — the
 * `createPulam` twin of `serveTerminalWorkspace.test.ts`.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PtyHostClient, PtyHostListEntry } from "kaval";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AwarenessCollectionCtx, createPulam } from "./createPulam.ts";
import type { TerminalWorkspaceEndpoint } from "./endpoint.ts";
import { createTerminalWorkspaceEndpoint } from "./endpoint.ts";
import type { AwarenessValue, TerminalId } from "./schema.ts";
import {
  type AwarenessCollectionDeps,
  quietActivity,
} from "./serveTerminalWorkspace.ts";

// `start` is never called here, so kaval is never touched — a bare stub suffices.
const stubKaval = {} as unknown as PtyHostClient;
const stubEndpoint = {} as TerminalWorkspaceEndpoint;
const stubLog = pino({ level: "silent" });
const stubAwareness: AwarenessCollectionDeps = {
  readAll: () => new Map(),
  upsert: () => {},
  remove: () => {},
};

/** The `activity` stream dep is a union (a `source` thunk OR a read/install
 *  shape); createPulam always builds the `source` form, so narrow to it. */
function activitySource(pulam: ReturnType<typeof createPulam>) {
  const activity = pulam.served.streams?.activity;
  if (!activity || !("source" in activity))
    throw new Error("createPulam: expected a source-style activity dep");
  return activity.source;
}

describe("createPulam — the ONE pulam-library assembly", () => {
  it("returns the full served-surface deps with the injected backing + a deferred start", () => {
    const pulam = createPulam({
      kaval: stubKaval,
      awareness: stubAwareness,
      endpoint: stubEndpoint,
      log: stubLog,
    });

    // It assembles through the shared `serveTerminalWorkspace` factory — the full
    // skeleton, no second hand-rolled copy:
    expect(pulam.served.cells?.version?.store).toBeDefined();
    expect(pulam.served.streams?.subscribeRepoChange).toBeDefined();
    expect(pulam.served.streams?.subscribeFileChange).toBeDefined();
    expect(pulam.served.procedures?.fs).toBeDefined();
    expect(pulam.served.procedures?.git).toBeDefined();
    expect("channel" in pulam.served).toBe(false);

    // The awareness write target is injected through verbatim (identity):
    expect(pulam.served.collections?.awareness).toBe(stubAwareness);

    // …and the activity source is createPulam's OWN live source over its tracker,
    // NOT the quiet stub a tap-less home (kolu today) injects.
    expect(pulam.served.streams?.activity).toBeDefined();
    expect(pulam.served.streams?.activity).not.toBe(quietActivity);

    // The sensor lifecycle is deferred to `start` (the home implements the surface
    // first, then hands back the broadcasting collection handle).
    expect(typeof pulam.start).toBe("function");
  });

  it("gives each instance its own activity source (no shared per-instance state)", () => {
    const make = () =>
      createPulam({
        kaval: stubKaval,
        awareness: stubAwareness,
        endpoint: stubEndpoint,
        log: stubLog,
      });
    expect(make().served.streams?.activity).not.toBe(
      make().served.streams?.activity,
    );
  });
});

describe("createPulam — fail-fast lifecycle guards", () => {
  const make = () =>
    createPulam({
      kaval: stubKaval,
      awareness: stubAwareness,
      endpoint: stubEndpoint,
      log: stubLog,
    });

  it("isStarted() is false until start() runs (the serve path can assert it)", () => {
    expect(make().isStarted()).toBe(false);
  });

  it("the activity stream refuses to be subscribed before start() (served-but-never-started fails loud)", () => {
    const source = activitySource(make());
    expect(() => source({}, new AbortController().signal)).toThrow(
      /before start\(\)/,
    );
  });
});

// ── A kaval-stubbed harness driving createPulam.start() at the LIBRARY level ──
// createPulam owns the per-terminal loop (watchTerminal: seed → cwd-persist → the
// raw-output activity tap; reconcile: add/remove). The pulam daemon's integration
// test covers it from the consumer; this drives it BESIDE the code with a fake
// PtyHostClient — no daemon, no socket. Every fake stream is bound to a master
// abort so `start()`'s teardown can never hang the test.

type AttachFrame = { kind: "snapshot" | "delta"; data: string };

/** A controllable async stream standing in for one kaval per-terminal tap. `push`
 *  emits to the live subscriber; iteration ends on the per-call signal OR the
 *  test's master signal. */
function fakeTap<T>(master: AbortSignal) {
  const buffer: T[] = [];
  let wake: (() => void) | null = null;
  const drain = (): void => {
    const w = wake;
    wake = null;
    w?.();
  };
  master.addEventListener("abort", drain, { once: true });
  return {
    push(v: T): void {
      buffer.push(v);
      drain();
    },
    iterable(signal?: AbortSignal): AsyncIterable<T> {
      signal?.addEventListener("abort", drain, { once: true });
      return {
        async *[Symbol.asyncIterator]() {
          while (!master.aborted && !signal?.aborted) {
            const head = buffer.shift();
            if (head !== undefined) {
              yield head;
              continue;
            }
            await new Promise<void>((r) => {
              wake = r;
            });
          }
        },
      };
    },
  };
}

function fakeKaval(master: AbortSignal) {
  let entries: PtyHostListEntry[] = [];
  const cwd = new Map<string, ReturnType<typeof fakeTap<{ cwd: string }>>>();
  const attach = new Map<string, ReturnType<typeof fakeTap<AttachFrame>>>();
  const tapFor = <T>(
    m: Map<string, ReturnType<typeof fakeTap<T>>>,
    id: string,
  ): ReturnType<typeof fakeTap<T>> => {
    let t = m.get(id);
    if (!t) {
      t = fakeTap<T>(master);
      m.set(id, t);
    }
    return t;
  };
  // title / commandRun / foreground are wired but never emit in this test.
  const silent = () => ({
    get: async (_i: { id: string }, o?: { signal?: AbortSignal }) =>
      fakeTap<unknown>(master).iterable(o?.signal),
  });
  const client = {
    surface: {
      terminal: {
        list: async () => ({ entries }),
        getScreenText: async () => ({ text: "" }),
      },
      cwd: {
        get: async (i: { id: string }, o?: { signal?: AbortSignal }) =>
          tapFor(cwd, i.id).iterable(o?.signal),
      },
      title: silent(),
      commandRun: silent(),
      foreground: silent(),
      terminalAttach: {
        get: async (i: { id: string }, o?: { signal?: AbortSignal }) =>
          tapFor(attach, i.id).iterable(o?.signal),
      },
    },
  } as unknown as PtyHostClient;
  return {
    client,
    setEntries(e: PtyHostListEntry[]): void {
      entries = e;
    },
    cwdTap: (id: string) => tapFor(cwd, id),
    attachTap: (id: string) => tapFor(attach, id),
  };
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function waitUntil(
  pred: () => boolean | Promise<boolean>,
  ms = 2000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await sleep(10);
  }
  throw new Error("waitUntil: condition never held");
}

describe("createPulam — start() drives the per-terminal loop (kaval-stubbed)", () => {
  let master: AbortController;
  let stop: (() => void) | null = null;

  beforeEach(() => {
    master = new AbortController();
    stop = null;
  });
  afterEach(() => {
    stop?.();
    stop = null;
    master.abort(); // close every fake stream so the test can't hang
  });

  it("start() throws if called twice — no double-watch", async () => {
    const kaval = fakeKaval(master.signal); // no entries → a trivial reconcile
    const pulam = createPulam({
      kaval: kaval.client,
      awareness: stubAwareness,
      endpoint: createTerminalWorkspaceEndpoint(stubLog),
      log: stubLog,
      pollIntervalMs: 10_000,
    });
    const collection: AwarenessCollectionCtx = {
      upsert: () => {},
      remove: () => {},
    };
    stop = await pulam.start(collection);
    await expect(pulam.start(collection)).rejects.toThrow(/called twice/);
  });

  it("seeds → persists cwd → lights activity → removes on departure", async () => {
    const tmpCwd = mkdtempSync(join(tmpdir(), "createPulam-test-"));
    const id = "term-1" as TerminalId;
    const entry = {
      id,
      pid: 4321,
      cwd: tmpCwd,
      lastActivity: 0,
    } as unknown as PtyHostListEntry;

    const upserts: Array<{ id: TerminalId; value: AwarenessValue }> = [];
    const removes: TerminalId[] = [];
    const collection: AwarenessCollectionCtx = {
      upsert: (k, v) => upserts.push({ id: k, value: v }),
      remove: (k) => removes.push(k),
    };

    const kaval = fakeKaval(master.signal);
    const pulam = createPulam({
      kaval: kaval.client,
      awareness: stubAwareness,
      endpoint: createTerminalWorkspaceEndpoint(stubLog),
      log: stubLog,
      pollIntervalMs: 20,
    });

    kaval.setEntries([entry]);
    stop = await pulam.start(collection); // initial reconcile → watchTerminal(entry)

    // (1) terminal appears → the SEEDED value is published first (before sensors).
    expect(upserts[0]?.id).toBe(id);
    expect(upserts[0]?.value.cwd).toBe(tmpCwd);
    expect(upserts[0]?.value.git).toBeNull();
    expect(upserts[0]?.value.pr.kind).toBe("pending");

    // (2) a cwd tap fires → the persisted cwd updates.
    const moved = join(tmpCwd, "sub");
    kaval.cwdTap(id).push({ cwd: moved });
    await waitUntil(() => upserts.some((u) => u.value.cwd === moved));

    // (3) a raw-output delta → the live activity set lights (snapshot frame skipped).
    kaval.attachTap(id).push({ kind: "snapshot", data: "screen" });
    kaval.attachTap(id).push({ kind: "delta", data: "new bytes" });
    await waitUntil(async () => {
      const ac = new AbortController();
      try {
        for await (const set of activitySource(pulam)({}, ac.signal)) {
          return set.includes(id);
        }
        return false;
      } finally {
        ac.abort();
      }
    });

    // (4) the terminal departs → reconcile stops it and removes it from the set.
    kaval.setEntries([]);
    await waitUntil(() => removes.includes(id));
  });
});

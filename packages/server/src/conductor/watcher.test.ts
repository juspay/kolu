import { type PadiSurfaceClient, padiClientOver } from "@kolu/padi-client/dial";
import {
  type PadiRoster,
  type PadiTerminal,
  type PadiUrgency,
  padiSurfaceSibling,
} from "@kolu/padi-client/surface";
import {
  composeTerminalMetadata,
  LOCAL_LOCATION,
} from "@kolu/padi-client/vocab";
import { surfaceTag } from "@kolu/surface/define";
import { directDispatch } from "@kolu/surface/links/direct";
import type { SurfaceHandlers } from "@kolu/surface/server";
import type { PrResult } from "@kolu/terminal-vocab/schema";
import { Effect, Queue, Stream } from "effect";
import type { ConductorHost, PrWatch, WatchObservation } from "kolu-conductor";
import type { FleetHosts } from "kolu-mcp";
import type { WorkId } from "kolu-work";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";
import { startConductorWatcher } from "./watcher.ts";

const LOCAL = "local";
const BOX = "remote:box";
const PLANNER = "11111111-1111-4111-8111-111111111111";
const SPLIT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

const log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as Logger;

const QUIET: PadiUrgency = {
  awaitingIds: [],
  finishedIds: [],
  workingIds: [],
  lingerIds: [],
  settled: true,
};

interface Cell<T> {
  set(next: T): void;
  held(): number;
  stream(): Stream.Stream<T>;
}

function cell<T>(initial: T): Cell<T> {
  let current = initial;
  const subs = new Set<(value: T) => void>();
  return {
    set(next: T): void {
      current = next;
      for (const sub of subs) sub(next);
    },
    held: () => subs.size,
    stream: (): Stream.Stream<T> =>
      Stream.callback<T>((queue) =>
        Effect.gen(function* () {
          Queue.offerUnsafe(queue, current);
          const sub = (value: T): void => {
            Queue.offerUnsafe(queue, value);
          };
          subs.add(sub);
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              subs.delete(sub);
            }),
          );
        }),
      ),
  };
}

const record = (over: { parentId?: string; intent?: string }): PadiTerminal =>
  composeTerminalMetadata(
    {
      state: "active",
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      promptedAt: null,
      ...(over.parentId === undefined ? {} : { parentId: over.parentId }),
      ...(over.intent === undefined ? {} : { intent: over.intent }),
    },
    {
      cwd: "/tmp",
      git: { kind: "none" },
      pr: { kind: "pending" },
      agent: null,
      foreground: null,
      ports: { status: "unknown" },
    },
  );

interface FakePadi {
  readonly client: PadiSurfaceClient;
  readonly urgency: Cell<PadiUrgency>;
  readonly roster: Cell<PadiRoster>;
  readonly pr: Cell<PrResult>;
  prAsked(): ReadonlyArray<{ repoPath: string; branch: string }>;
  keysRead(): number;
  held(): number;
}

function fakePadi(
  holds: Record<string, { parentId?: string; intent?: string }>,
  options: {
    silentRoster?: boolean;
    settling?: boolean;
    census?: readonly string[];
  } = {},
): FakePadi {
  const records = new Map(
    Object.entries(holds).map(([id, over]) => [id, cell(record(over))]),
  );
  const urgency = cell<PadiUrgency>(QUIET);
  const ids = options.census ?? [...records.keys()];
  const roster = cell<PadiRoster>(
    options.settling === true
      ? { kind: "settling" }
      : { kind: "established", at: 1, ids },
  );
  let keysRead = 0;
  const pr = cell<PrResult>({ kind: "pending" });
  const prAsked: Array<{ repoPath: string; branch: string }> = [];
  const at = (member: string, verb: string): string =>
    surfaceTag(padiSurfaceSibling.tagPrefix, member, verb);
  const handlers = {
    [at("urgency", "get")]: () => urgency.stream(),
    [at("roster", "get")]: () =>
      options.silentRoster === true ? Stream.never : roster.stream(),
    [at("terminals", "keys")]: () => {
      keysRead += 1;
      return Stream.make([...records.keys()]);
    },
    [at("terminals", "get")]: ({ key }: { key: string }) =>
      records.get(key)?.stream() ?? Stream.never,
    [at("pullRequest", "get")]: (input: {
      repoPath: string;
      branch: string;
    }) => {
      prAsked.push(input);
      return pr.stream();
    },
  } as unknown as SurfaceHandlers;
  return {
    client: padiClientOver(directDispatch({ handlers })).padi,
    urgency,
    roster,
    pr,
    prAsked: () => prAsked,
    keysRead: () => keysRead,
    held: () =>
      urgency.held() +
      roster.held() +
      pr.held() +
      [...records.values()].reduce((sum, one) => sum + one.held(), 0),
  };
}

function fakeHosts(entries: Record<string, PadiSurfaceClient | null>): {
  hosts: FleetHosts;
  connect(key: string, client: PadiSurfaceClient): void;
} {
  const live = new Map(Object.entries(entries));
  const subs = new Set<() => void>();
  return {
    hosts: {
      keys: () => [...live.keys()],
      display: (key) => `the ${key} machine`,
      padi: (key) => live.get(key) ?? null,
      state: (key) => (live.get(key) == null ? "warming" : "connected"),
      subscribe: (cb) => {
        subs.add(cb);
        return () => subs.delete(cb);
      },
    },
    connect(key, client) {
      live.set(key, client);
      for (const cb of [...subs]) cb();
    },
  };
}

function fakeConductor(
  members: string[],
  refuse?: () => never,
  initial: ReadonlyArray<PrWatch> = [],
): {
  host: () => ConductorHost;
  readonly seen: WatchObservation[];
  readonly readings: Array<{ work: WorkId; pr: PrResult }>;
  setWatches(next: ReadonlyArray<PrWatch>): void;
} {
  const seen: WatchObservation[] = [];
  const readings: Array<{ work: WorkId; pr: PrResult }> = [];
  let watches = initial;
  const host = {
    memberRefs: () => (refuse === undefined ? members : refuse()),
    prWatches: () => (refuse === undefined ? watches : refuse()),
    observe: (next: ReadonlyArray<WatchObservation>) => {
      seen.push(...next);
    },
    observedPr: (work: WorkId, pr: PrResult) => {
      readings.push({ work, pr });
    },
  } as unknown as ConductorHost;
  return {
    host: () => host,
    seen,
    readings,
    setWatches: (next) => {
      watches = next;
    },
  };
}

describe("the conductor's watch, as wiring", () => {
  it("reports a member terminal on a connected host, and subscribes nothing above it", async () => {
    const local = fakePadi({
      [PLANNER]: { intent: "plan the cutover" },
      [SPLIT]: { parentId: PLANNER, intent: "write the migration" },
    });
    const fleet = fakeHosts({ [LOCAL]: local.client });
    const conductor = fakeConductor([`${LOCAL}/${SPLIT}`]);
    const watcher = startConductorWatcher({
      hosts: fleet.hosts,
      conductor: conductor.host,
      log,
    });
    local.urgency.set({ ...QUIET, awaitingIds: [SPLIT] });
    try {
      await vi.waitFor(() => {
        const last = conductor.seen.at(-1);
        expect(last?.level).toBe("asking");
        expect(last?.terminalId).toBe(SPLIT);
        expect(last?.hostName).toBe(`the ${LOCAL} machine`);
        expect(local.held()).toBe(3);
        expect(local.keysRead()).toBe(0);
      });
    } finally {
      await watcher.dispose();
    }
  });

  it("opens no leg on a host that is not connected, and opens one when it arrives", async () => {
    const local = fakePadi({ [OTHER]: { intent: "the other one" } });
    const box = fakePadi({ [SPLIT]: { intent: "write the migration" } });
    const fleet = fakeHosts({ [LOCAL]: local.client, [BOX]: null });
    const conductor = fakeConductor([`${LOCAL}/${OTHER}`, `${BOX}/${SPLIT}`]);
    const watcher = startConductorWatcher({
      hosts: fleet.hosts,
      conductor: conductor.host,
      log,
    });
    local.urgency.set({ ...QUIET, workingIds: [OTHER] });
    box.urgency.set({ ...QUIET, workingIds: [SPLIT] });
    try {
      await vi.waitFor(() => {
        expect(conductor.seen.at(-1)?.terminalId).toBe(OTHER);
      });
      expect(box.held()).toBe(0);
      expect(conductor.seen.some((one) => one.host === BOX)).toBe(false);

      fleet.connect(BOX, box.client);
      await vi.waitFor(() => {
        expect(
          conductor.seen.filter((one) => one.host === BOX).at(-1)?.level,
        ).toBe("working");
      });
    } finally {
      await watcher.dispose();
    }
  });

  it("says nothing about a host whose ROSTER has not answered yet", async () => {
    const quiet = fakePadi(
      { [SPLIT]: { intent: "write the migration" } },
      { silentRoster: true },
    );
    const local = fakePadi({ [OTHER]: { intent: "the other one" } });
    const fleet = fakeHosts({ [LOCAL]: local.client, [BOX]: quiet.client });
    const conductor = fakeConductor([`${LOCAL}/${OTHER}`, `${BOX}/${SPLIT}`]);
    const watcher = startConductorWatcher({
      hosts: fleet.hosts,
      conductor: conductor.host,
      log,
    });
    local.urgency.set({ ...QUIET, workingIds: [OTHER] });
    quiet.urgency.set({ ...QUIET, finishedIds: [SPLIT] });
    try {
      await vi.waitFor(() => {
        expect(conductor.seen.at(-1)?.terminalId).toBe(OTHER);
        expect(quiet.held()).toBeGreaterThan(0);
      });
      expect(conductor.seen.some((one) => one.host === BOX)).toBe(false);
    } finally {
      await watcher.dispose();
    }
  });

  it("says nothing about a host that has NOT FINISHED ADOPTING — even about a member missing from its roster", async () => {
    const fresh = fakePadi({}, { settling: true });
    const local = fakePadi({ [OTHER]: { intent: "the other one" } });
    const fleet = fakeHosts({ [LOCAL]: local.client, [BOX]: fresh.client });
    const conductor = fakeConductor([`${LOCAL}/${OTHER}`, `${BOX}/${SPLIT}`]);
    const watcher = startConductorWatcher({
      hosts: fleet.hosts,
      conductor: conductor.host,
      log,
    });
    local.urgency.set({ ...QUIET, workingIds: [OTHER] });
    try {
      await vi.waitFor(() => {
        expect(conductor.seen.at(-1)?.terminalId).toBe(OTHER);
        expect(fresh.held()).toBeGreaterThan(0);
      });
      expect(conductor.seen.some((one) => one.host === BOX)).toBe(false);

      fresh.roster.set({ kind: "established", at: 2, ids: [] });
      await vi.waitFor(() => {
        const last = conductor.seen.filter((one) => one.host === BOX).at(-1);
        expect(last?.level).toBe("gone");
        expect(last?.terminalId).toBe(SPLIT);
      });
    } finally {
      await watcher.dispose();
    }
  });

  it("says nothing about a host whose urgency is not yet evidence — a redeploy still reading its survivors", async () => {
    const box = fakePadi({ [SPLIT]: { intent: "write the migration" } });
    box.urgency.set({ ...QUIET, settled: false });
    const local = fakePadi({ [OTHER]: { intent: "the other one" } });
    const fleet = fakeHosts({ [LOCAL]: local.client, [BOX]: box.client });
    const conductor = fakeConductor([`${LOCAL}/${OTHER}`, `${BOX}/${SPLIT}`]);
    const watcher = startConductorWatcher({
      hosts: fleet.hosts,
      conductor: conductor.host,
      log,
    });
    local.urgency.set({ ...QUIET, workingIds: [OTHER] });
    try {
      await vi.waitFor(() => {
        expect(conductor.seen.at(-1)?.terminalId).toBe(OTHER);
        expect(box.held()).toBeGreaterThan(0);
      });
      expect(conductor.seen.some((one) => one.host === BOX)).toBe(false);

      box.urgency.set({ ...QUIET, finishedIds: [SPLIT] });
      await vi.waitFor(() => {
        const last = conductor.seen.filter((one) => one.host === BOX).at(-1);
        expect(last?.level).toBe("stopped");
      });
    } finally {
      await watcher.dispose();
    }
  });

  it("does NOT say gone about a member the roster holds but no record has arrived for", async () => {
    const mirror = fakePadi({}, { census: [SPLIT] });
    const fleet = fakeHosts({ [BOX]: mirror.client });
    const conductor = fakeConductor([`${BOX}/${SPLIT}`]);
    const watcher = startConductorWatcher({
      hosts: fleet.hosts,
      conductor: conductor.host,
      log,
    });
    mirror.urgency.set({ ...QUIET, workingIds: [SPLIT] });
    try {
      await vi.waitFor(() => {
        expect(conductor.seen.at(-1)?.terminalId).toBe(SPLIT);
      });
      expect(conductor.seen.some((one) => one.level === "gone")).toBe(false);
    } finally {
      await watcher.dispose();
    }
  });

  it("SURVIVES a store it cannot read — it opens nothing, and the watch is still there when it can", async () => {
    const local = fakePadi({ [SPLIT]: { intent: "write the migration" } });
    const fleet = fakeHosts({ [LOCAL]: local.client });
    let readable = false;
    const conductor = fakeConductor([`${LOCAL}/${SPLIT}`], () => {
      if (!readable)
        throw new Error(
          "the saved works are in a shape this build does not understand",
        );
      throw new Error("unreachable");
    });
    const watcher = startConductorWatcher({
      hosts: fleet.hosts,
      conductor: conductor.host,
      log,
    });
    try {
      local.urgency.set({ ...QUIET, workingIds: [SPLIT] });
      await vi.waitFor(() => {
        expect(local.held()).toBe(0);
      });
      expect(conductor.seen).toEqual([]);

      readable = true;
      const recovered = fakeConductor([`${LOCAL}/${SPLIT}`]);
      const second = startConductorWatcher({
        hosts: fleet.hosts,
        conductor: recovered.host,
        log,
      });
      try {
        await vi.waitFor(() => {
          expect(recovered.seen.at(-1)?.terminalId).toBe(SPLIT);
        });
      } finally {
        await second.dispose();
      }
    } finally {
      await watcher.dispose();
    }
  });

  it("lets every subscription go when it is disposed", async () => {
    const local = fakePadi({
      [PLANNER]: { intent: "plan the cutover" },
      [SPLIT]: { parentId: PLANNER, intent: "write the migration" },
    });
    const fleet = fakeHosts({ [LOCAL]: local.client });
    const conductor = fakeConductor([
      `${LOCAL}/${PLANNER}`,
      `${LOCAL}/${SPLIT}`,
    ]);
    const watcher = startConductorWatcher({
      hosts: fleet.hosts,
      conductor: conductor.host,
      log,
    });
    local.urgency.set({ ...QUIET, workingIds: [SPLIT] });
    await vi.waitFor(() => {
      expect(conductor.seen.length).toBeGreaterThan(0);
      expect(local.held()).toBe(4);
    });
    await watcher.dispose();
    await vi.waitFor(() => {
      expect(local.held()).toBe(0);
    });
  });

  it("watches a work's BRANCH on its host, with no member terminal at all", async () => {
    const local = fakePadi({});
    const fleet = fakeHosts({ [LOCAL]: local.client });
    const conductor = fakeConductor([], undefined, [
      {
        work: "branch:local/%2Fsrv%2Frepo/fix-the-parser" as WorkId,
        host: LOCAL,
        repo: "/srv/repo",
        branch: "fix-the-parser",
      },
    ]);
    const watcher = startConductorWatcher({
      hosts: fleet.hosts,
      conductor: conductor.host,
      log,
    });
    try {
      await vi.waitFor(() => {
        expect(local.prAsked()).toEqual([
          { repoPath: "/srv/repo", branch: "fix-the-parser" },
        ]);
      });
      local.pr.set({ kind: "unsupported" });
      await vi.waitFor(() => {
        expect(conductor.readings.at(-1)).toEqual({
          work: "branch:local/%2Fsrv%2Frepo/fix-the-parser",
          pr: { kind: "unsupported" },
        });
      });
      expect(conductor.seen).toEqual([]);
    } finally {
      await watcher.dispose();
    }
    await vi.waitFor(() => {
      expect(local.held()).toBe(0);
    });
  });

  it("concludes NOTHING about the pull request of a work on an unreachable host", async () => {
    const local = fakePadi({});
    const box = fakePadi({});
    const fleet = fakeHosts({ [LOCAL]: local.client, [BOX]: null });
    const here: PrWatch = {
      work: "branch:local/%2Fsrv%2Frepo/here" as WorkId,
      host: LOCAL,
      repo: "/srv/repo",
      branch: "here",
    };
    const away: PrWatch = {
      work: "branch:remote%3Abox/%2Fsrv%2Frepo/away" as WorkId,
      host: BOX,
      repo: "/srv/repo",
      branch: "away",
    };
    const conductor = fakeConductor([], undefined, [here, away]);
    const watcher = startConductorWatcher({
      hosts: fleet.hosts,
      conductor: conductor.host,
      log,
    });
    try {
      local.pr.set({ kind: "absent" });
      await vi.waitFor(() => {
        expect(conductor.readings.at(-1)).toEqual({
          work: here.work,
          pr: { kind: "absent" },
        });
      });
      expect(
        conductor.readings.filter((one) => one.work === away.work),
      ).toEqual([]);
      expect(box.prAsked()).toEqual([]);
      expect(conductor.seen).toEqual([]);

      box.pr.set({ kind: "pending" });
      fleet.connect(BOX, box.client);
      await vi.waitFor(() => {
        expect(box.prAsked()).toEqual([
          { repoPath: "/srv/repo", branch: "away" },
        ]);
      });
    } finally {
      await watcher.dispose();
    }
  });

  it("opens a work's PR leg when the SCOPE moves, with no member anywhere", async () => {
    const local = fakePadi({});
    const fleet = fakeHosts({ [LOCAL]: local.client });
    const conductor = fakeConductor([]);
    const watcher = startConductorWatcher({
      hosts: fleet.hosts,
      conductor: conductor.host,
      log,
    });
    const back: PrWatch = {
      work: "branch:local/%2Fsrv%2Frepo/fix-the-parser" as WorkId,
      host: LOCAL,
      repo: "/srv/repo",
      branch: "fix-the-parser",
    };
    try {
      expect(local.prAsked()).toEqual([]);

      conductor.setWatches([back]);
      watcher.scopeMoved();

      await vi.waitFor(() => {
        expect(local.prAsked()).toEqual([
          { repoPath: "/srv/repo", branch: "fix-the-parser" },
        ]);
      });
      local.pr.set({ kind: "pending" });
      await vi.waitFor(() => {
        expect(conductor.readings.at(-1)).toEqual({
          work: back.work,
          pr: { kind: "pending" },
        });
      });
      expect(conductor.seen).toEqual([]);
    } finally {
      await watcher.dispose();
    }
  });
});

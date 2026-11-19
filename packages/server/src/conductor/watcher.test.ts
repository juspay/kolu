/**
 * THE WATCH'S WIRING — which legs exist, when, and what reaches the
 * conversation off them.
 *
 * What a leg's frames MEAN is a function now, and it is tested by calling it
 * (`kolu-conductor`'s `readings.test.ts`). What is left here can only be seen
 * by running the streams: that a leg exists for a CONNECTED host holding a
 * MEMBER of a work in progress and for no other — and for the member alone,
 * with nothing above it subscribed — that a host arriving opens one without
 * anybody asking, that nothing is said before padi's fold and its roster have
 * both answered, and that a dispose really lets the subscriptions go.
 *
 * Each fake padi is a HANDLER RECORD at padi's own wire tags, dialled through
 * the real `padiClientOver` — the same client kolu-server hands the fleet face.
 * An object cast to `PadiSurfaceClient` would make this file prove something
 * about a client it invented, which is the trap `kolu-mcp`'s fleet fixture
 * states at length: a cast cannot fail, so a watch dialling a member nothing is
 * bound at would look exactly like one that works.
 *
 * Every claim about SILENCE is anchored on something that did happen — another
 * host's reading, or the count of subscriptions a fake padi is holding — rather
 * than on a delay. A watch that was going to speak about the wrong host would
 * have had to open a subscription on it first, and that is a fact this fixture
 * can read.
 */

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

/** A value that can be read now and re-read on every change — padi's own
 *  snapshot-then-deltas contract, which is what every member here serves.
 *  `held` is how many subscriptions are standing on it, which is what makes a
 *  leg that was never opened and a teardown that really happened observable. */
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

/** A record the way padi composes one, so the walk reads a real shape. */
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
  /** This padi's own word for whether its roster is a census — the standing AND
   *  the ids, one cell, which is what the watch reads to decide whether `gone`
   *  is a word it may use about this host. */
  readonly roster: Cell<PadiRoster>;
  /** What this host says about the branch it is asked about — the `pullRequest`
   *  stream, one cell for however many branches the test asks about (no test
   *  here asks about two). */
  readonly pr: Cell<PrResult>;
  /** Every `(repoPath, branch)` a leg asked this host about. */
  prAsked(): ReadonlyArray<{ repoPath: string; branch: string }>;
  /** How many times anything asked the `terminals` collection for its KEYS.
   *  Zero, for every leg: the census is the roster's. */
  keysRead(): number;
  /** How many standing subscriptions this padi is serving right now. */
  held(): number;
}

/** One host's padi, at the tags padi's own face dials. `silentRoster` is the
 *  host that is answering and has not said which terminals it has yet;
 *  `settling` is the host that has not finished ADOPTING them — a fresh daemon
 *  mid-boot, or one recycling its kaval. `census` states the ids the roster
 *  carries when they are not simply the ids it has records for — the shape a
 *  PROJECTION serves while its `terminals` collection is still folding. */
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
  // Established by default, carrying the ids this host holds: the ordinary case
  // is a padi that booted, adopted its terminals and said which, which is when
  // a reading means anything.
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
    // COUNTED, NOT USED. The census rides the roster cell; a leg that read the
    // collection's keys beside it would be back to two members for one answer
    // (#2376), so the test asserts this stays at zero rather than trusting the
    // reading to look right.
    [at("terminals", "keys")]: () => {
      keysRead += 1;
      return Stream.make([...records.keys()]);
    },
    [at("terminals", "get")]: ({ key }: { key: string }) =>
      records.get(key)?.stream() ?? Stream.never,
    // THE WORK'S OWN QUESTION: what does the forge say about this branch in
    // this repository? Asked of the HOST, with no terminal in it.
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

/** kolu-server's host map, as the port it hands in — membership and
 *  reachability on one callback, which is what the real one folds. */
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

/** The conversation, as the watch reaches it: the member refs to scope by and
 *  a sink for the readings. Nothing else of `ConductorHost` is touched — which
 *  is itself the claim, since a watch that started the agent merely to read
 *  membership would be a subprocess nobody asked for. */
function fakeConductor(
  members: string[],
  /** What `memberRefs` does instead of answering — the store this build cannot
   *  decode (`UnreadablePersisted`), raised where the watch reads membership. */
  refuse?: () => never,
  /** The works in progress whose branches are watched — the PR watch's scope,
   *  which is NOT derived from the members: a work with none is watched. */
  initial: ReadonlyArray<PrWatch> = [],
): {
  host: () => ConductorHost;
  readonly seen: WatchObservation[];
  /** Every work-level pull-request reading the watch handed over. */
  readonly readings: Array<{ work: WorkId; pr: PrResult }>;
  /** Move the scope, the way a work opening or coming back does. The watch is
   *  told separately (`scopeMoved`), because it RE-READS the scope rather
   *  than being handed the new list. */
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
        // THE PARENT IS NOT READ. It is a terminal on this host and the
        // member's own `child-of` edge points at it, and it is not a member —
        // membership is stated now, so the ancestor walk that used to open a
        // subscription per link has nothing to find out. Three standing reads:
        // the urgency fold, the ROSTER (the standing and the census, one cell)
        // and the one member's record.
        expect(local.held()).toBe(3);
        // And the `terminals` collection's KEYS are not among them: the two
        // halves of "is that id here?" ride one member, or a projection can
        // deliver them apart (#2376).
        expect(local.keysRead()).toBe(0);
      });
    } finally {
      await watcher.dispose();
    }
  });

  it("opens no leg on a host that is not connected, and opens one when it arrives", async () => {
    // DISCONNECTED IS NOT GONE. A host that is not answering says nothing
    // about its terminals, and a `gone` here would tell the Conductor that a
    // machine's work died when all that happened is that it stopped answering.
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
      // The connected host's reading is the proof the watch has run a whole
      // generation of legs...
      await vi.waitFor(() => {
        expect(conductor.seen.at(-1)?.terminalId).toBe(OTHER);
      });
      // ...and the absent host is holding nothing at all.
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
    // `gone` is decidable only against a roster that was actually read, so a
    // host whose roster has not landed is not reported about at all — even
    // though its fold and its record have both arrived and its leg is open.
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
        // Its leg IS open — this is a host that is answering, not one that is
        // away — and it has still said nothing.
        expect(quiet.held()).toBeGreaterThan(0);
      });
      expect(conductor.seen.some((one) => one.host === BOX)).toBe(false);
    } finally {
      await watcher.dispose();
    }
  });

  it("says nothing about a host that has NOT FINISHED ADOPTING — even about a member missing from its roster", async () => {
    // #2376, end to end over the wire. The host is answering, its roster has
    // landed and the member is NOT in it — which used to be the whole of
    // "gone". Here padi says that list is not a census yet (a fresh daemon
    // serving its pre-adopt registry, or one recycling its kaval), so the
    // watch withholds, and the work keeps its members.
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

      // And the moment it HAS adopted — with the member still not in its
      // roster — the same absence becomes news, because now it is evidence.
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

  it("does NOT say gone about a member the roster holds but no record has arrived for", async () => {
    // #2376's SECOND half, which the roster standing alone did not close. This
    // leg reads kolu-server's per-host MIRROR of padi, and that mirror marks
    // its session connected on the first folded CELL frame — so a leg opened
    // in that instant was told `established` by the cell while the `terminals`
    // collection it also mirrors had folded NOTHING. Reading the ids off the
    // collection made every member of every work `gone` 11 ms after a redeploy
    // reconnected, with the terminals adopted and alive under the same ids.
    //
    // Here the host holds the member in its CENSUS and has no record for it at
    // all. The member is present; only its details are late.
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
    // A throw out of `memberRefs` is a DEFECT inside the stream that IS the
    // watch: it killed the fiber, and nothing re-opens one ("nothing will wake
    // the Conductor until kolu-server restarts", seen in an e2e whose store was
    // seeded unreadable). An unreadable store means kolu does not know who the
    // members are — a watch with nothing to watch, not a dead one.
    const local = fakePadi({ [SPLIT]: { intent: "write the migration" } });
    const fleet = fakeHosts({ [LOCAL]: local.client });
    let readable = false;
    const conductor = fakeConductor([`${LOCAL}/${SPLIT}`], () => {
      if (!readable)
        throw new Error(
          "the saved works are in a shape this build does not understand",
        );
      // Unreachable once `readable` flips — the fixture's refusal is consulted
      // on every read, so the recovery below really is a re-read.
      throw new Error("unreachable");
    });
    const watcher = startConductorWatcher({
      hosts: fleet.hosts,
      conductor: conductor.host,
      log,
    });
    try {
      local.urgency.set({ ...QUIET, workingIds: [SPLIT] });
      // Nothing is watched and nothing is said — and the proof the watch is
      // ALIVE is the next move being answered at all.
      await vi.waitFor(() => {
        expect(local.held()).toBe(0);
      });
      expect(conductor.seen).toEqual([]);

      // The store becomes readable (round 3's recovery) and the next membership
      // move re-reads it: the leg opens and the member is reported.
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
      // The fold, the roster standing, and one record per MEMBER — two members
      // of one work here, which is the shape a waterfall has.
      expect(local.held()).toBe(4);
    });
    await watcher.dispose();
    // One interrupt takes the legs and the host-map subscription with it: a
    // shutdown that left a standing read would keep this process's padi links
    // open after kolu stopped watching.
    await vi.waitFor(() => {
      expect(local.held()).toBe(0);
    });
  });

  it("watches a work's BRANCH on its host, with no member terminal at all", async () => {
    // THE WHOLE POINT (#2376): the Conductor merges and closes its terminals
    // seconds later, so the work that is about to end has nobody in it. The
    // leg is opened for the WORK, off its key, and the forge's reading reaches
    // the conversation.
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
        // Every reading reaches the conversation as it stands — what it MEANS
        // (this one means nothing) is decided there, against the timeline.
        expect(conductor.readings.at(-1)).toEqual({
          work: "branch:local/%2Fsrv%2Frepo/fix-the-parser",
          pr: { kind: "unsupported" },
        });
      });
      // Nothing was said about any terminal: there is no member here.
      expect(conductor.seen).toEqual([]);
    } finally {
      await watcher.dispose();
    }
    await vi.waitFor(() => {
      expect(local.held()).toBe(0);
    });
  });

  it("concludes NOTHING about the pull request of a work on an unreachable host", async () => {
    // A machine kolu cannot reach is not a machine whose pull request is
    // closed. No leg, no frame, nothing handed over — and the moment it comes
    // back, the reading arrives. The LOCAL work is the proof the watch ran a
    // whole generation of legs while the box's said nothing.
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
      // ... and NOTHING about the work on the machine that is not answering.
      expect(
        conductor.readings.filter((one) => one.work === away.work),
      ).toEqual([]);
      expect(box.prAsked()).toEqual([]);
      expect(conductor.seen).toEqual([]);

      // It comes back, and the leg is opened with it.
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
    // THE REOPEN HOLE (#2376). A work that ends drops its members in the same
    // step, so bringing one back — the card's Reopen, or `work_open` on the
    // same key — moves no membership at all. If the only signal the watch
    // listened to were a membership one, this leg would never open and the
    // forge's merge or close would have nobody watching for it.
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
      // Nothing in flight, nobody on the host: no leg, which is what makes
      // the one below attributable to the scope move alone.
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

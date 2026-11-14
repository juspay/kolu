/**
 * THE WATCH'S WIRING — which legs exist, when, and what reaches the
 * conversation off them.
 *
 * What a leg's frames MEAN is a function now, and it is tested by calling it
 * (`kolu-conductor`'s `readings.test.ts`). What is left here can only be seen
 * by running the streams: that a leg exists for a CONNECTED host holding a
 * watched terminal and for no other, that a host arriving opens one without
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
import { Effect, Queue, Stream } from "effect";
import type { ConductorHost, WatchObservation } from "kolu-conductor";
import type { FleetHosts } from "kolu-mcp";
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
  /** How many standing subscriptions this padi is serving right now. */
  held(): number;
}

/** One host's padi, at the tags padi's own face dials. `silentRoster` is the
 *  host that is answering and has not said which terminals it has yet. */
function fakePadi(
  holds: Record<string, { parentId?: string; intent?: string }>,
  options: { silentRoster?: boolean } = {},
): FakePadi {
  const records = new Map(
    Object.entries(holds).map(([id, over]) => [id, cell(record(over))]),
  );
  const urgency = cell<PadiUrgency>(QUIET);
  const at = (member: string, verb: string): string =>
    surfaceTag(padiSurfaceSibling.tagPrefix, member, verb);
  const handlers = {
    [at("urgency", "get")]: () => urgency.stream(),
    [at("terminals", "keys")]: () =>
      options.silentRoster === true
        ? Stream.never
        : Stream.make([...records.keys()]),
    [at("terminals", "get")]: ({ key }: { key: string }) =>
      records.get(key)?.stream() ?? Stream.never,
  } as unknown as SurfaceHandlers;
  return {
    client: padiClientOver(directDispatch({ handlers })).padi,
    urgency,
    held: () =>
      urgency.held() +
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

/** The conversation, as the watch reaches it: a list to scope by and a sink
 *  for the readings. Nothing else of `ConductorHost` is touched — which is
 *  itself the claim, since a watch that started the agent merely to read the
 *  list would be a subprocess nobody asked for. */
function fakeConductor(watched: string[]): {
  host: () => ConductorHost;
  readonly seen: WatchObservation[];
} {
  const seen: WatchObservation[] = [];
  const host = {
    watched: () => watched,
    observe: (next: ReadonlyArray<WatchObservation>) => {
      seen.push(...next);
    },
  } as unknown as ConductorHost;
  return { host: () => host, seen };
}

describe("the conductor's watch, as wiring", () => {
  it("reports a watched terminal on a connected host, with the work it is in", async () => {
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
        // The PLANNER was never on the watch list: the lineage recursion
        // subscribed it off the split's own parent edge, which is the only way
        // the piece of work gets a heading on a machine nobody has a browser
        // open on.
        expect(last?.root).toEqual({
          ref: `${LOCAL}/${PLANNER}`,
          name: "plan the cutover",
        });
        expect(last?.hostName).toBe(`the ${LOCAL} machine`);
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
    // host whose keys have not landed is not reported about at all — even
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

  it("lets every subscription go when it is disposed", async () => {
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
    local.urgency.set({ ...QUIET, workingIds: [SPLIT] });
    await vi.waitFor(() => {
      expect(conductor.seen.length).toBeGreaterThan(0);
      // The fold, the watched record and the ancestor the lineage found.
      expect(local.held()).toBe(3);
    });
    await watcher.dispose();
    // One interrupt takes the legs, the lineages and the host-map subscription
    // with it: a shutdown that left a standing read would keep this process's
    // padi links open after kolu stopped watching.
    await vi.waitFor(() => {
      expect(local.held()).toBe(0);
    });
  });
});

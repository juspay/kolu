/**
 * The FLEET face over a two-host fixture — the projection's whole contract,
 * driven through a real served MCP face.
 *
 * Two fake padis behind a fake {@link FleetHosts}, because every claim this
 * face makes is about N hosts and none of them is observable with one: that an
 * id is host-qualified, that a call lands on the RIGHT machine, that two
 * queues merge into one ordered drain, that a host arriving mid-watch flows in
 * and a host leaving says `gone`, and that a host which is not connected is
 * refused BY NAME rather than answered with an empty list.
 *
 * WHAT THE FIXTURE IS, AND WHAT IT IS NOT — stated here because the previous
 * version of this sentence is the reason a production bug lived behind a green
 * suite. Each host's padi used to be a hand-written object literal cast to
 * `PadiSurfaceClient`. A cast makes ANY shape a padi client, so the thing this
 * file exercised was the fleet face against a client the file itself had
 * invented — and kolu-server's real client, built by `padiClientOver` over a
 * surface it was never bound to, failed every terminal-level call in
 * production (`no handler bound at "surface/padi/terminals/keys"`) while this
 * suite stayed green.
 *
 * So each padi here is now a HANDLER RECORD at padi's own wire tags, dialled
 * through the real `padiClientOver` + `directDispatch`. That pins the FACE
 * half end to end: the tag each member is dialled at, the face walk that mints
 * them, and the fail-loud resolver that refuses a tag nothing is bound at. A
 * member renamed in `padiSurface` now breaks this file instead of passing.
 *
 * The half it still cannot pin is kolu-server's MOUNTING — which handlers the
 * client is pointed at, and whether a host's calls carry the host-map's
 * `{ mapKey, input }` envelope. That needs `padiHostMap` + `serveHostMap`,
 * which live behind kolu-server's dependencies, so it is pinned where the
 * mounting lives: `packages/server/src/fleet/fleetHosts.test.ts`, whose
 * fixture serves the real map over a stub pool and calls a terminal member
 * through it.
 */

import { type PadiSurfaceClient, padiClientOver } from "@kolu/padi-client/dial";
import {
  type PadiTerminal,
  type PadiUrgency,
  type PadiWatchEvent,
  padiSurface,
  padiSurfaceSibling,
  TerminalNotActive,
  WatchSubscriptionNotFound,
} from "@kolu/padi-client/surface";
import { surfaceTag } from "@kolu/surface/define";
import { directDispatch } from "@kolu/surface/links/direct";
import type { SurfaceHandlers } from "@kolu/surface/server";
import { resolveExpose } from "@kolu/surface-mcp";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { Effect, Queue, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KOLU_FLEET_EXPOSE, KOLU_MCP_EXPOSE } from "../expose.ts";
import { KOLU_MCP_TOOLS } from "../tools.ts";
import { FLEET_SETTLE_CAP_MS, KOLU_FLEET_TOOL_NAMES } from "./lift.ts";
import { fleetSurface } from "./fleetSurface.ts";
import type { FleetHosts } from "./hosts.ts";
import { serveKoluFleetMcp } from "./serve.ts";
import type {
  FleetWatchEntry,
  FleetWatchJoin,
  FleetWatchList,
} from "./watchList.ts";

const ALPHA_1 = "11111111-1111-4111-8111-111111111111" as TerminalId;
const ALPHA_2 = "22222222-2222-4222-8222-222222222222" as TerminalId;
const BETA_1 = "33333333-3333-4333-8333-333333333333" as TerminalId;

/** A value with subscribers, as a snapshot-then-change `Stream` — the shape
 *  every padi cell and collection-keys member has on the wire. */
interface Cell<T> {
  readonly value: T;
  set(next: T): void;
  stream(): Stream.Stream<T>;
}

function cell<T>(initial: T): Cell<T> {
  let current = initial;
  const subs = new Set<(value: T) => void>();
  return {
    get value(): T {
      return current;
    },
    set(next: T): void {
      current = next;
      for (const sub of subs) sub(next);
    },
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

/** What padi serves as a terminal record — and it carries NO `id`: on a face
 *  that serves one machine the collection KEY is the identity, which is
 *  precisely why the fleet face has to put an addressable one on the row. */
const terminalRecord = (title: string, parentId?: TerminalId): PadiTerminal =>
  ({
    state: "active",
    title,
    agent: null,
    ...(parentId === undefined ? {} : { parentId }),
  }) as unknown as PadiTerminal;

/** The same record with a live agent in it — what `agent_say` reads to decide
 *  whose keys to press. */
const withAgent = (title: string, kind: string, state: string): PadiTerminal =>
  ({
    state: "active",
    title,
    agent: { kind, state },
  }) as unknown as PadiTerminal;

const EMPTY_URGENCY: PadiUrgency = {
  awaitingIds: [],
  finishedIds: [],
  workingIds: [],
  lingerIds: [],
};

interface FakePadi {
  readonly client: PadiSurfaceClient;
  readonly calls: string[];
  add(id: TerminalId, title: string, parentId?: TerminalId): void;
  /** Put a live agent of `kind` in `state` into that terminal's record. */
  runAgent(id: TerminalId, kind: string, state: string): void;
  /** Arm that terminal's agent to BEGIN WORKING when a submit key (`\r`)
   *  reaches it — a TUI accepting a prompt, which is what `agent_say`'s "did
   *  it take" wait watches for. */
  startsWorkingOnSubmit(id: TerminalId, kind: string): void;
  /** Put that terminal to sleep IN ITS RECORD — padi's `state` arm, which is
   *  what any reader of the roster sees (distinct from `sleep`, which is the
   *  screen-read gate). */
  park(id: TerminalId, state: "sleeping" | "parked"): void;
  remove(id: TerminalId): void;
  /** Queue a settle event and ring the pulse, as padi's registry would. */
  fire(id: TerminalId, kind: "asking" | "finished" | "gone"): void;
  setUrgency(next: PadiUrgency): void;
  /** Make this padi REFUSE every `watch.open` — a host that is answering but
   *  cannot carry a subscription (a padi mid-restart, a registry at its cap).
   *  `null` restores it. */
  refuseWatchOpen(why: string | null): void;
  /** Make `lifecycle.sendInput` fail — how a create stops PARTWAY with a real
   *  terminal already on the canvas. */
  refuseSendInput(why: string | null): void;
  /** Make this padi's SCREEN READS answer the active-terminal gate's dormant
   *  refusal — what a terminal that has been put to sleep answers (kolu#2361).
   *  `null` restores it. */
  sleep(id: TerminalId | null): void;
  /** Drop every subscription this padi holds, keeping the client — a padi
   *  that RESTARTED under a mirror that never dropped, so nothing upstream
   *  observed a disconnect and the next drain finds no such queue. */
  forgetWatches(): void;
  readonly openedWatches: string[];
  readonly closedWatches: string[];
}

function fakePadi(host: string, seeded: readonly TerminalId[]): FakePadi {
  const calls: string[] = [];
  // One cell PER RECORD, because a collection `get` is a live stream on the
  // wire: a terminal whose agent starts working while something is watching
  // it publishes that, and a fixture that answered one frame and completed
  // would make every state change after the first unobservable.
  const records = new Map<TerminalId, Cell<PadiTerminal>>(
    seeded.map((id) => [id, cell(terminalRecord(`${host} ${id.slice(0, 4)}`))]),
  );
  const keys = cell<TerminalId[]>([...records.keys()]);
  const urgency = cell<PadiUrgency>(EMPTY_URGENCY);
  const pulse = cell<{ seq: number }>({ seq: 0 });
  const queue: PadiWatchEvent[] = [];
  const openedWatches: string[] = [];
  const closedWatches: string[] = [];
  /** Open subscription names → the watermark each has acknowledged. */
  const open = new Map<string, number>();
  let seq = 0;
  let watchOpenRefusal: string | null = null;
  let sendInputRefusal: string | null = null;
  /** Terminals whose agent begins WORKING when its submit key arrives, by the
   *  agent kind that is in them. */
  const startsOnSubmit = new Map<TerminalId, string>();
  /** The one terminal this padi reports as ASLEEP, if any. */
  let sleeping: TerminalId | null = null;

  /** ONE host's padi, as a HANDLER RECORD at the tags padi's own face dials —
   *  `surfaceTag(padiSurfaceSibling.tagPrefix, member, verb)`, minted by the
   *  framework from padi's own sibling, never typed out here. Every member
   *  this fixture serves therefore has to exist, at its real name, in the real
   *  surface. */
  const at = (member: string, verb: string): string =>
    surfaceTag(padiSurfaceSibling.tagPrefix, member, verb);
  const handlers = {
    [at("identity", "get")]: () =>
      Stream.make({
        commit: `${host}-commit`,
        surfaceVersion: "7.0",
        startedAt: 1000,
      }),
    [at("status", "get")]: () => Stream.make({}),
    [at("urgency", "get")]: () => urgency.stream(),
    [at("terminals", "keys")]: () => keys.stream(),
    [at("terminals", "get")]: ({ key }: { key: TerminalId }) => {
      const record = records.get(key);
      return record === undefined ? Stream.never : record.stream();
    },
    [at("screen", "text")]: (input: { id: TerminalId }) =>
      Effect.suspend(() => {
        calls.push(`screen.text:${input.id}`);
        // padi's active-terminal gate: a dormant record is refused by name,
        // never as "not found" (kolu#2361).
        return input.id === sleeping
          ? Effect.fail(
              new TerminalNotActive({ id: input.id, state: "sleeping" }),
            )
          : Effect.succeed(`screen of ${host}/${input.id}`);
      }),
    [at("screen", "history")]: (input: { id: TerminalId; max: number }) =>
      Effect.sync(() => {
        calls.push(`screen.history:${input.id}`);
        return { kind: "ok", chunk: host, topLine: 1, exhausted: true };
      }),
    [at("lifecycle", "create")]: (input: unknown) =>
      Effect.sync(() => {
        calls.push(`lifecycle.create:${JSON.stringify(input)}`);
        return { id: BETA_1, pid: 77 };
      }),
    [at("lifecycle", "kill")]: (input: { id: TerminalId }) =>
      Effect.sync(() => {
        calls.push(`lifecycle.kill:${input.id}`);
        return { id: input.id, pid: 42 };
      }),
    [at("lifecycle", "sendInput")]: (input: unknown) =>
      Effect.suspend(() => {
        calls.push(`lifecycle.sendInput:${JSON.stringify(input)}`);
        if (sendInputRefusal !== null) {
          return Effect.fail(new Error(sendInputRefusal));
        }
        // A submit KEY landing on an agent that was armed to start: what a
        // real TUI does a beat after its Enter, and the only way an
        // in-process fixture can let `agent_say`'s "did it take" wait observe
        // the thing it is there to observe.
        const { id, data } = input as { id: TerminalId; data: string };
        const starting = startsOnSubmit.get(id);
        const record = records.get(id);
        if (data === "\r" && starting !== undefined && record !== undefined) {
          record.set(withAgent(`${host} agent`, starting, "thinking"));
        }
        return Effect.void;
      }),
    [at("git", "getStatus")]: (input: { repoPath: string }) =>
      Effect.sync(() => {
        calls.push(`git.getStatus:${input.repoPath}`);
        return { files: [], branch: host };
      }),
    // padi's own rule, because the fleet leans on it: a FRESH subscription
    // starts acknowledged at the daemon's current sequence (it reports what
    // happens next), and a RE-ATTACH keeps the watermark it had — which is
    // what makes a reconnect hand over what was queued while the link was
    // down instead of skipping it.
    [at("watch", "open")]: (input: { name: string }) =>
      Effect.suspend(() => {
        openedWatches.push(input.name);
        if (watchOpenRefusal !== null) {
          return Effect.fail(new Error(watchOpenRefusal));
        }
        const held = open.get(input.name);
        const acknowledged = held ?? seq;
        open.set(input.name, acknowledged);
        return Effect.succeed({
          name: input.name,
          acknowledged,
          reattached: held !== undefined,
        });
      }),
    [at("watch", "drain")]: (input: { name: string; after?: number }) =>
      Effect.suspend(() => {
        const held = open.get(input.name);
        if (held === undefined) {
          return Effect.fail(
            new WatchSubscriptionNotFound({
              name: input.name,
              known: [...open.keys()],
            }),
          );
        }
        const after = input.after ?? held;
        open.set(input.name, after);
        const events = queue.filter((event) => event.seq > after);
        return Effect.succeed({
          events,
          dropped: 0,
          ackAfter: events.at(-1)?.seq ?? seq,
        });
      }),
    [at("watch", "close")]: (input: { name: string }) =>
      Effect.suspend(() => {
        if (!open.has(input.name)) {
          return Effect.fail(
            new WatchSubscriptionNotFound({
              name: input.name,
              known: [...open.keys()],
            }),
          );
        }
        closedWatches.push(input.name);
        open.delete(input.name);
        return Effect.succeed({});
      }),
    // The output feed `agent_say`'s settle (and every `wait_*`) subscribes to.
    // ONE snapshot frame and then silence, which is a terminal that has
    // finished redrawing — so the idle window fires instead of the call
    // spending its whole cap.
    [at("terminalAttach", "get")]: () =>
      Stream.make({ kind: "snapshot", data: `screen of ${host}` }),
    [at("watchPulse", "get")]: () => pulse.stream(),
  } as unknown as SurfaceHandlers;

  // THE REAL FACE WALK — `padiClientOver`, the one kolu-server hands the fleet
  // face, over an in-process dispatch into the record above. A hand-built
  // object cast to `PadiSurfaceClient` is what this used to be, and it is
  // exactly what let the production bug ship: the cast makes any shape a padi
  // client, so a face that dials tags nothing is bound at looks identical to
  // one that works. Built this way the fixture cannot pass unless padi's face
  // and this padi's handlers agree on every tag.
  const client = padiClientOver(directDispatch({ handlers })).padi;

  return {
    client,
    calls,
    openedWatches,
    closedWatches,
    runAgent(id, kind, state) {
      const held = records.get(id);
      const next = withAgent(`${host} agent`, kind, state);
      if (held === undefined) records.set(id, cell(next));
      else held.set(next);
      keys.set([...records.keys()]);
    },
    startsWorkingOnSubmit(id, kind) {
      startsOnSubmit.set(id, kind);
    },
    park(id, state) {
      const held = records.get(id);
      const dormant = {
        state,
        title: `${host} parked`,
        agent: null,
      } as unknown as PadiTerminal;
      if (held === undefined) records.set(id, cell(dormant));
      else held.set(dormant);
      keys.set([...records.keys()]);
    },
    add(id, title, parentId) {
      const held = records.get(id);
      const next = terminalRecord(title, parentId);
      if (held === undefined) records.set(id, cell(next));
      else held.set(next);
      keys.set([...records.keys()]);
    },
    remove(id) {
      records.delete(id);
      keys.set([...records.keys()]);
    },
    fire(id, kind) {
      seq += 1;
      queue.push({ seq, id, kind, at: Date.now() } as PadiWatchEvent);
      pulse.set({ seq });
    },
    setUrgency(next) {
      urgency.set(next);
    },
    refuseWatchOpen(why) {
      watchOpenRefusal = why;
    },
    refuseSendInput(why) {
      sendInputRefusal = why;
    },
    sleep(id) {
      sleeping = id;
    },
    forgetWatches() {
      open.clear();
      queue.length = 0;
      seq = 0;
    },
  };
}

/** kolu-server's host map, as a test holds it: a mutable roster of states. */
function fakeFleet(
  seed: readonly {
    key: string;
    display: string;
    padi: FakePadi | null;
    state?: "warming" | "connected" | "failed";
  }[],
) {
  const rows = new Map(
    seed.map((one) => [
      one.key,
      {
        display: one.display,
        padi: one.padi,
        state: one.state ?? ("connected" as const),
      },
    ]),
  );
  const subs = new Set<() => void>();
  const moved = (): void => {
    for (const sub of subs) sub();
  };
  const hosts: FleetHosts = {
    keys: () => [...rows.keys()],
    display: (key) => rows.get(key)?.display ?? key,
    padi: (key) => rows.get(key)?.padi?.client ?? null,
    state: (key) => rows.get(key)?.state ?? "failed",
    subscribe: (cb) => {
      subs.add(cb);
      return () => {
        subs.delete(cb);
      };
    },
  };
  return {
    hosts,
    join(key: string, display: string, padi: FakePadi): void {
      rows.set(key, { display, padi, state: "connected" });
      moved();
    },
    leave(key: string): void {
      rows.delete(key);
      moved();
    },
    setState(key: string, state: "warming" | "connected" | "failed"): void {
      const row = rows.get(key);
      if (row !== undefined) {
        rows.set(key, { ...row, state, padi: null });
        moved();
      }
    },
  };
}

/** The one text body a `resources/read` answers with, as JSON. The SDK types
 *  `contents` as text-or-blob; every resource this face serves is text, so the
 *  read is narrowed here once rather than at each assertion. */
const jsonOf = (result: {
  readonly contents: readonly Record<string, unknown>[];
}): unknown => JSON.parse(String(result.contents[0]?.text));

/** kolu-server's watch list, as a test holds it: add-ordered, idempotent,
 *  in memory, recording HOW each entry joined, every terminal the conductor
 *  has spoken to, and what the server's watcher last SAW in each one. The real
 *  one is persisted with the conversation and read by that watcher — this face
 *  moves it and serves it back, which is exactly what these tests are about. */
function fakeWatchList(): FleetWatchList & {
  joinOf(ref: string): FleetWatchJoin | undefined;
  /** The refs on the list, which is what most of these cases assert. */
  refs(): string[];
  /** What the SERVER's watcher does between turns: it reads a watched
   *  terminal and writes back what it found. Nothing on this face does it, and
   *  the `watched` resource has to show it. */
  sawIn(ref: string, name: string, agent: string | null): void;
  readonly saids: string[];
  /** Every `closed` the face told the list, in order. */
  readonly closeds: string[];
} {
  const entries = new Map<string, FleetWatchEntry>();
  const listeners = new Set<() => void>();
  const saids: string[] = [];
  const closeds: string[] = [];
  const moved = (): void => {
    for (const one of listeners) one();
  };
  return {
    entries: () => [...entries.values()],
    subscribe(cb) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    watch(ref, joined) {
      if (entries.has(ref)) return;
      entries.set(ref, { ref, name: null, agent: null, joined });
      moved();
    },
    unwatch(ref) {
      if (!entries.delete(ref)) return false;
      moved();
      return true;
    },
    said(ref) {
      saids.push(ref);
    },
    closed(ref) {
      closeds.push(ref);
      if (entries.delete(ref)) moved();
    },
    joinOf: (ref) => entries.get(ref)?.joined,
    refs: () => [...entries.keys()],
    sawIn(ref, name, agent) {
      const entry = entries.get(ref);
      if (entry === undefined) return;
      entries.set(ref, { ...entry, name, agent });
      moved();
    },
    saids,
    closeds,
  };
}

/** The two-host fixture, at module scope so both suites raise it. */
function twoHostFleet() {
  const alpha = fakePadi("local", [ALPHA_1, ALPHA_2]);
  const beta = fakePadi("remote:box", [BETA_1]);
  const fleet = fakeFleet([
    { key: "local", display: "this machine", padi: alpha },
    { key: "remote:box", display: "box", padi: beta },
  ]);
  return { alpha, beta, fleet };
}

describe("the fleet face over two hosts", () => {
  let teardown: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await teardown?.();
    teardown = undefined;
  });

  async function servedFleet(hosts: FleetHosts): Promise<Client> {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveKoluFleetMcp({
      hosts,
      transport: serverTransport,
      serverInfo: { name: "kolu-fleet", version: "0.0.0-test" },
      // These cases are about addressing, not about the watch list — it is
      // handed a working one and never read.
      watchList: fakeWatchList(),
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    teardown = async () => {
      await mcp.close();
      await close();
    };
    return mcp;
  }

  const twoHosts = twoHostFleet;

  it("`terminals` lists every host's terminals, host-qualified, local first", async () => {
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const keys = jsonOf(
      await mcp.readResource({ uri: "surface://collections/terminals" }),
    );
    expect(keys).toEqual([
      `local/${ALPHA_1}`,
      `local/${ALPHA_2}`,
      `remote:box/${BETA_1}`,
    ]);
  });

  it("a terminal record is read from the host that owns it, and SAYS so", async () => {
    const { beta, fleet } = twoHosts();
    // A split living inside another terminal on the same host — the one place
    // a record carries a second id of its own.
    beta.add(BETA_1, "box worker", ALPHA_1);
    const mcp = await servedFleet(fleet.hosts);
    // The id segment is percent-encoded: a fleet reference carries a slash, and
    // the adapter addresses a collection item by SEGMENT.
    const record = jsonOf(
      await mcp.readResource({
        uri: `surface://collections/terminals/${encodeURIComponent(`remote:box/${BETA_1}`)}`,
      }),
    ) as { id: string; parentId: string; host: string; title: string };
    expect(record.title).toBe("box worker");
    // Every id on the row is one the TOOLS on this face accept. A bare `id`
    // here is a row an agent reads and cannot act on: `lifecycle_kill` refuses
    // it as "not a fleet terminal reference".
    expect(record.id).toBe(`remote:box/${BETA_1}`);
    expect(record.parentId).toBe(`remote:box/${ALPHA_1}`);
    expect(record.host).toBe("remote:box");
    const killed = await mcp.callTool({
      name: "lifecycle_kill",
      arguments: { id: record.id },
    });
    expect(killed.isError ?? false, JSON.stringify(killed.content)).toBe(false);
  });

  it("pins the SDK internal a record read is lifted from — a bump that moves it fails HERE", async () => {
    // Serving this face LIFTS the adapter's own `resources/read` out of the
    // SDK's private `_requestHandlers` map (`./recordRead.ts`), because the
    // SDK publishes no getter for a registered handler. An SDK that keeps it
    // somewhere else makes the next line THROW, naming the assumption — in
    // `ci::unit`, rather than at a person's kolu-server boot, where the first
    // symptom would be a Conductor that can read no terminal's record at all.
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    // And what was lifted is the adapter's real reader: the record this face
    // re-addressed and handed on comes back answered.
    expect(
      jsonOf(
        await mcp.readResource({
          uri: `surface://collections/terminals/local/${ALPHA_1}`,
        }),
      ),
      "the face served, so the delegate was found — but the record read did not come back through it",
    ).toMatchObject({ id: `local/${ALPHA_1}` });
  });

  it("reads a record at the reference the face hands out — local and remote, unescaped", async () => {
    // THE BUG a human hit in a real session: a reference is `host/id`, so the
    // URI an agent writes by pasting one after the collection has a slash in
    // its last part — which the adapter's segment rule reads as a SIBLING's
    // collection and refuses as an unknown resource. Reading one terminal's
    // record therefore never worked on this face, while the standing prompt
    // tells the Conductor to do exactly that before it reads a screen. Both
    // arms, because `local/<id>` carries the slash too.
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const asked = (ref: string) => `surface://collections/terminals/${ref}`;

    const localUri = asked(`local/${ALPHA_1}`);
    const local = await mcp.readResource({ uri: localUri });
    expect(jsonOf(local)).toMatchObject({
      id: `local/${ALPHA_1}`,
      host: "local",
    });
    // The answer comes back at the address the caller WROTE — an agent handed
    // a different one reads it as a second, secret spelling.
    expect(local.contents[0]?.uri).toBe(localUri);

    expect(
      jsonOf(await mcp.readResource({ uri: asked(`remote:box/${BETA_1}`) })),
    ).toMatchObject({ id: `remote:box/${BETA_1}`, host: "remote:box" });
  });

  it("refuses a reference that names nothing, and says what a record address looks like", async () => {
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const uri = `surface://collections/terminals/local/${BETA_1}`;
    const refusal = await mcp.readResource({ uri }).then(
      () => null,
      (e: unknown) => String(e),
    );
    // A reference for a terminal that is not on the host it names is an
    // answer, not a crash — and the sentence has to carry both halves: that
    // there is no such record, and the shape of an address that would have
    // one.
    expect(refusal).toContain("no terminal record at");
    expect(refusal).toContain(uri);
    expect(refusal).toContain('"surface://collections/terminals/<host>/<id>"');
  });

  it("refuses an address this face does not serve by teaching the record address", async () => {
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const refusal = await mcp
      .readResource({ uri: "surface://cells/screens" })
      .then(
        () => null,
        (e: unknown) => String(e),
      );
    expect(refusal).toContain("unknown resource");
    expect(refusal).toContain('"surface://collections/terminals/<host>/<id>"');
    // And it names what IS there, so the next read is a right one.
    expect(refusal).toContain('"surface://cells/hosts"');
  });

  it("`hosts` answers the whole roster — every host and its facts — in ONE read", async () => {
    // The question an agent asks first is "which hosts can I use", and the
    // answer has to arrive whole. As a COLLECTION this resource was its key
    // set: five strings, and a per-host template URI an agent had to guess at
    // to learn anything else. One read, every row.
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    expect(
      jsonOf(await mcp.readResource({ uri: "surface://cells/hosts" })),
    ).toEqual([
      {
        host: "local",
        display: "this machine",
        state: "connected",
        commit: "local-commit",
        surfaceVersion: "7.0",
        startedAt: 1000,
      },
      {
        host: "remote:box",
        display: "box",
        state: "connected",
        commit: "remote:box-commit",
        surfaceVersion: "7.0",
        startedAt: 1000,
      },
    ]);
  });

  it("`urgency` concatenates every host's ids, host-qualified", async () => {
    const { alpha, beta, fleet } = twoHosts();
    alpha.setUrgency({ ...EMPTY_URGENCY, awaitingIds: [ALPHA_2] });
    beta.setUrgency({ ...EMPTY_URGENCY, awaitingIds: [BETA_1] });
    const mcp = await servedFleet(fleet.hosts);
    expect(
      jsonOf(await mcp.readResource({ uri: "surface://cells/urgency" })),
    ).toEqual({
      awaitingIds: [`local/${ALPHA_2}`, `remote:box/${BETA_1}`],
      finishedIds: [],
      workingIds: [],
      lingerIds: [],
    });
  });

  it("a tool call lands on the host its reference names", async () => {
    const { alpha, beta, fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "screen_text",
      arguments: { id: `remote:box/${BETA_1}` },
    });
    expect(res.isError ?? false).toBe(false);
    expect(beta.calls).toEqual([`screen.text:${BETA_1}`]);
    expect(alpha.calls).toEqual([]);
  });

  it("a SLEEPING terminal is refused by name, with its id re-qualified", async () => {
    // The refusal an agent on this face actually reads. Two things have to be
    // true at once: it must say the terminal is ASLEEP (not "not found" — a
    // terminal it can see in the roster), and the id it names must be the
    // FLEET reference, in the prose as well as in the data, or the agent is
    // handed an id every tool on this face refuses.
    const { beta, fleet } = twoHosts();
    beta.sleep(BETA_1);
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "screen_text",
      arguments: { id: `remote:box/${BETA_1}` },
    });
    expect(res.isError).toBe(true);
    expect(String((res.content as { text: string }[])[0]?.text)).toContain(
      `Terminal remote:box/${BETA_1} is asleep — wake it before reading its screen`,
    );
    expect(res.structuredContent).toEqual({
      kind: "terminal-not-active",
      tag: "TerminalNotActive",
      id: `remote:box/${BETA_1}`,
      state: "sleeping",
    });
  });

  it("a lifted answer carries ids back host-qualified", async () => {
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "lifecycle_kill",
      arguments: { id: `local/${ALPHA_1}` },
    });
    expect(res.structuredContent).toEqual({
      id: `local/${ALPHA_1}`,
      pid: 42,
    });
  });

  it("`lifecycle_create` takes a host and answers a fleet reference", async () => {
    const { beta, fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "remote:box",
        placement: { kind: "toplevel" },
      },
    });
    expect(res.isError ?? false).toBe(false);
    expect(res.structuredContent).toMatchObject({
      id: `remote:box/${BETA_1}`,
      pid: 77,
    });
    expect(beta.calls).toHaveLength(1);
  });

  it("a create that stops PARTWAY names the survivor at a reference another tool accepts", async () => {
    const { beta, fleet } = twoHosts();
    beta.refuseSendInput("the pty went away mid-write");
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "remote:box",
        placement: { kind: "toplevel" },
        run: "pnpm test",
      },
    });
    expect(res.isError).toBe(true);
    // The terminal EXISTS on box. An id the agent cannot pass back is an
    // orphan it was told about and cannot remove.
    expect(res.structuredContent).toMatchObject({
      kind: "stopped-partway",
      landed: { id: `remote:box/${BETA_1}` },
    });
    // The prose the model actually reads carries the same reference.
    expect(JSON.stringify(res.content)).toContain(`remote:box/${BETA_1}`);
    const killed = await mcp.callTool({
      name: "lifecycle_kill",
      arguments: { id: `remote:box/${BETA_1}` },
    });
    expect(killed.isError ?? false, JSON.stringify(killed.content)).toBe(false);
    expect(beta.calls).toContain(`lifecycle.kill:${BETA_1}`);
  });

  it("refuses a cross-host parent instead of flattening the hierarchy", async () => {
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "remote:box",
        placement: { kind: "child-of", parentId: `local/${ALPHA_1}` },
      },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("remote:box");
    expect(res.structuredContent).toMatchObject({
      kind: "cross-host-reference",
    });
  });

  it("refuses a disconnected host BY NAME, never with an empty answer", async () => {
    const { fleet } = twoHosts();
    fleet.setState("remote:box", "warming");
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "git_getStatus",
      arguments: { host: "remote:box", repoPath: "/repo", mode: "working" },
    });
    expect(res.isError).toBe(true);
    const said = JSON.stringify(res.content);
    expect(said).toContain("remote:box");
    expect(said).toContain("warming");
    expect(res.structuredContent).toMatchObject({
      kind: "host-not-connected",
      host: "remote:box",
      state: "warming",
    });
  });

  it("refuses an unknown host by name, naming the fleet", async () => {
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "screen_text",
      arguments: { id: `remote:elsewhere/${BETA_1}` },
    });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({
      kind: "unknown-host",
      host: "remote:elsewhere",
    });
  });
});

describe("`agent_say` over the fleet", () => {
  let teardown: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await teardown?.();
    teardown = undefined;
  });

  async function servedFleet(
    hosts: FleetHosts,
    watchList: FleetWatchList = fakeWatchList(),
  ): Promise<Client> {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveKoluFleetMcp({
      hosts,
      transport: serverTransport,
      serverInfo: { name: "kolu-fleet", version: "0.0.0-test" },
      watchList,
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    teardown = async () => {
      await mcp.close();
      await close();
    };
    return mcp;
  }

  it("types the words, presses the submit keys, and reports that it TOOK", async () => {
    const { alpha, fleet } = twoHostFleet();
    alpha.runAgent(ALPHA_1, "omp", "waiting");
    // The agent accepts the prompt a beat after its Enter — so the "did it
    // take" wait sees the bucket turn `working`, which is the whole claim.
    alpha.startsWorkingOnSubmit(ALPHA_1, "omp");
    const mcp = await servedFleet(fleet.hosts);

    const res = await mcp.callTool({
      name: "agent_say",
      arguments: { id: `local/${ALPHA_1}`, text: "ship it" },
    });

    expect(res.isError ?? false, JSON.stringify(res.content)).toBe(false);
    expect(res.structuredContent).toMatchObject({
      said: {
        agent: "omp",
        working: false,
        keys: ["Enter"],
        delivery: "submitted",
        textBytes: "ship it".length,
      },
      took: { observed: "began-working" },
    });
    // TWO writes, in order: the text, then the submit — never one fused write,
    // which is the paste-debounce race this whole protocol exists for.
    const writes = alpha.calls.filter((one) =>
      one.startsWith("lifecycle.sendInput:"),
    );
    expect(writes).toEqual([
      `lifecycle.sendInput:{"id":"${ALPHA_1}","data":"ship it"}`,
      `lifecycle.sendInput:{"id":"${ALPHA_1}","data":"\\r"}`,
    ]);
  });

  it("tells the watch list it SPOKE, at the fleet reference", async () => {
    // The entry's held news is about a state the conductor has now acted on;
    // the server withdraws it on this call, which is what stops a wake about
    // the worker that was just briefed.
    const { alpha, fleet } = twoHostFleet();
    alpha.runAgent(ALPHA_1, "claude-code", "tool_use");
    const watchList = fakeWatchList();
    const mcp = await servedFleet(fleet.hosts, watchList);

    await mcp.callTool({
      name: "agent_say",
      arguments: { id: `local/${ALPHA_1}`, text: "skip the review" },
    });

    expect(watchList.saids).toEqual([`local/${ALPHA_1}`]);
  });

  it("a WORKING agent is told what its keys actually did, and that taking is not observable", async () => {
    const { alpha, fleet } = twoHostFleet();
    alpha.runAgent(ALPHA_1, "claude-code", "tool_use");
    const mcp = await servedFleet(fleet.hosts);

    const res = await mcp.callTool({
      name: "agent_say",
      arguments: { id: `local/${ALPHA_1}`, text: "skip the review" },
    });

    // claude-code holds a mid-turn message for the NEXT turn — so the answer
    // says `queue`, and a conductor reading it knows the worker has not heard
    // this yet. There is no state change to wait for, so none is waited for.
    expect(res.structuredContent).toMatchObject({
      said: { agent: "claude-code", working: true, delivery: "queue" },
      took: { observed: "not-observable" },
    });
  });

  it("refuses a plain shell, at a reference this face can name", async () => {
    const { fleet } = twoHostFleet();
    const mcp = await servedFleet(fleet.hosts);

    const res = await mcp.callTool({
      name: "agent_say",
      arguments: { id: `local/${ALPHA_1}`, text: "ship it" },
    });

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({
      kind: "no-agent",
      id: `local/${ALPHA_1}`,
    });
    expect(JSON.stringify(res.content)).toContain(`local/${ALPHA_1}`);
  });

  it("writes NOTHING when it refuses", async () => {
    const { alpha, fleet } = twoHostFleet();
    const mcp = await servedFleet(fleet.hosts);

    await mcp.callTool({
      name: "agent_say",
      arguments: { id: `local/${ALPHA_1}`, text: "" },
    });

    expect(
      alpha.calls.filter((one) => one.startsWith("lifecycle.sendInput:")),
    ).toEqual([]);
  });
});

describe("the conductor's watch list", () => {
  let teardown: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await teardown?.();
    teardown = undefined;
  });

  async function servedFleet(
    hosts: FleetHosts,
    watchList: FleetWatchList,
  ): Promise<Client> {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveKoluFleetMcp({
      hosts,
      transport: serverTransport,
      serverInfo: { name: "kolu-fleet", version: "0.0.0-test" },
      watchList,
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    teardown = async () => {
      await mcp.close();
      await close();
    };
    return mcp;
  }

  it("`lifecycle_create` watches what it created, at the reference it answered", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const watchList = fakeWatchList();
    const mcp = await servedFleet(fleet.hosts, watchList);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: { host: "local", placement: { kind: "toplevel" } },
    });

    expect(res.isError ?? false, JSON.stringify(res.content)).toBe(false);
    // The FLEET reference, not padi's bare id: the list is read back by tools
    // that only accept `<host>/<id>`, so a bare id here would be an entry
    // nothing on this face can name.
    expect(watchList.refs()).toEqual([`local/${BETA_1}`]);
    // A bare shell: nothing was asked to run in it, so there is no bring-up
    // that can end without an agent.
    expect(watchList.joinOf(`local/${BETA_1}`)).toBe("created");
  });

  it("a create WITH a run command joins as a bring-up, not as a bare shell", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const watchList = fakeWatchList();
    const mcp = await servedFleet(fleet.hosts, watchList);

    await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "local",
        placement: { kind: "toplevel" },
        run: "omp",
      },
    });

    // The difference the server acts on: a terminal whose command ran and
    // came back to the prompt with no agent ever seen is news, where a shell
    // nobody ran anything in is simply a shell.
    expect(watchList.joinOf(`local/${BETA_1}`)).toBe("created-run");
  });

  it("a create that FAILS watches nothing", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    alpha.refuseSendInput("pty is gone");
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const watchList = fakeWatchList();
    const mcp = await servedFleet(fleet.hosts, watchList);

    const res = await mcp.callTool({
      name: "lifecycle_create",
      arguments: {
        host: "local",
        placement: { kind: "toplevel" },
        run: "claude",
      },
    });

    // The terminal LANDED (the refusal names it), but the call did not
    // succeed — and the watch hook hangs off the answer, so there is nothing
    // in the list. The conductor is told what landed and can watch it itself.
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({ kind: "stopped-partway" });
    expect(watchList.refs()).toEqual([]);
  });

  it("a kill that LANDS tells the list the Conductor closed it; a refused one tells it nothing", async () => {
    // The defect this guards: the Conductor closed its planner and
    // implementor after a merge and was then woken — `… gone · … gone` — about
    // its own action. The face is where the kill is seen to land, so it is
    // what says so, at the fleet reference the list is keyed by.
    const { fleet } = twoHostFleet();
    const watchList = fakeWatchList();
    const mcp = await servedFleet(fleet.hosts, watchList);
    await mcp.callTool({
      name: "watch_terminal",
      arguments: { id: `remote:box/${BETA_1}` },
    });

    const killed = await mcp.callTool({
      name: "lifecycle_kill",
      arguments: { id: `remote:box/${BETA_1}` },
    });
    expect(killed.isError ?? false, JSON.stringify(killed.content)).toBe(false);
    expect(watchList.closeds).toEqual([`remote:box/${BETA_1}`]);
    expect(watchList.refs()).toEqual([]);

    // A kill that never reached padi closed nothing, so the list must not be
    // told it did: that terminal is still there, still worth a `gone`.
    fleet.setState("remote:box", "warming");
    const refused = await mcp.callTool({
      name: "lifecycle_kill",
      arguments: { id: `remote:box/${BETA_1}` },
    });
    expect(refused.isError).toBe(true);
    expect(watchList.closeds).toEqual([`remote:box/${BETA_1}`]);
  });

  it("`watch_terminal` adds a terminal that exists, and answers the list AND what it found", async () => {
    const { beta, fleet } = twoHostFleet();
    beta.runAgent(BETA_1, "codex", "thinking");
    const watchList = fakeWatchList();
    const mcp = await servedFleet(fleet.hosts, watchList);

    const res = await mcp.callTool({
      name: "watch_terminal",
      arguments: { id: `remote:box/${BETA_1}` },
    });

    expect(res.isError ?? false, JSON.stringify(res.content)).toBe(false);
    // The found state is the BASELINE — the conductor is told it here
    // precisely because it will never arrive as a wake.
    expect(res.structuredContent).toEqual({
      watching: [`remote:box/${BETA_1}`],
      found: { kind: "agent", agent: "codex", bucket: "working" },
    });
    expect(watchList.refs()).toEqual([`remote:box/${BETA_1}`]);
    expect(watchList.joinOf(`remote:box/${BETA_1}`)).toBe("asked");
  });

  it("a terminal with no agent, and one that is asleep, are each said plainly", async () => {
    const { alpha, fleet } = twoHostFleet();
    const watchList = fakeWatchList();
    const mcp = await servedFleet(fleet.hosts, watchList);

    const shell = await mcp.callTool({
      name: "watch_terminal",
      arguments: { id: `local/${ALPHA_1}` },
    });
    expect(shell.structuredContent).toMatchObject({
      found: { kind: "no-agent" },
    });

    // A dormant terminal is watchable (the human may wake it), and the answer
    // says so rather than calling it a plain shell.
    alpha.park(ALPHA_2, "parked");
    const parked = await mcp.callTool({
      name: "watch_terminal",
      arguments: { id: `local/${ALPHA_2}` },
    });
    expect(parked.structuredContent).toMatchObject({
      found: { kind: "asleep", state: "parked" },
    });
  });

  it("watching something twice does not duplicate it or move it", async () => {
    const { fleet } = twoHostFleet();
    const watchList = fakeWatchList();
    const mcp = await servedFleet(fleet.hosts, watchList);

    await mcp.callTool({
      name: "watch_terminal",
      arguments: { id: `local/${ALPHA_1}` },
    });
    await mcp.callTool({
      name: "watch_terminal",
      arguments: { id: `remote:box/${BETA_1}` },
    });
    const res = await mcp.callTool({
      name: "watch_terminal",
      arguments: { id: `local/${ALPHA_1}` },
    });

    // A re-watch still answers the found state — the question "what is it
    // doing now" is worth answering every time, and the list is unmoved.
    expect(res.structuredContent).toEqual({
      watching: [`local/${ALPHA_1}`, `remote:box/${BETA_1}`],
      found: { kind: "no-agent" },
    });
  });

  it("refuses a terminal that is not in its host's roster, instead of watching silence", async () => {
    const { fleet } = twoHostFleet();
    const watchList = fakeWatchList();
    const mcp = await servedFleet(fleet.hosts, watchList);

    const res = await mcp.callTool({
      name: "watch_terminal",
      arguments: { id: `local/${BETA_1}` },
    });

    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({
      kind: "terminal-not-in-roster",
    });
    expect(watchList.refs()).toEqual([]);
  });

  it("refuses a disconnected host BY NAME, and a host nobody has", async () => {
    const { fleet } = twoHostFleet();
    fleet.setState("remote:box", "warming");
    const watchList = fakeWatchList();
    const mcp = await servedFleet(fleet.hosts, watchList);

    const warming = await mcp.callTool({
      name: "watch_terminal",
      arguments: { id: `remote:box/${BETA_1}` },
    });
    expect(warming.isError).toBe(true);
    expect(warming.structuredContent).toMatchObject({
      kind: "host-not-connected",
      host: "remote:box",
    });

    const stranger = await mcp.callTool({
      name: "watch_terminal",
      arguments: { id: `remote:elsewhere/${BETA_1}` },
    });
    expect(stranger.isError).toBe(true);
    expect(stranger.structuredContent).toMatchObject({ kind: "unknown-host" });
    expect(watchList.refs()).toEqual([]);
  });

  it("`unwatch_terminal` removes it, and says plainly when there was nothing to remove", async () => {
    const { fleet } = twoHostFleet();
    const watchList = fakeWatchList();
    const mcp = await servedFleet(fleet.hosts, watchList);
    await mcp.callTool({
      name: "watch_terminal",
      arguments: { id: `local/${ALPHA_1}` },
    });

    const removed = await mcp.callTool({
      name: "unwatch_terminal",
      arguments: { id: `local/${ALPHA_1}` },
    });
    expect(removed.structuredContent).toEqual({ watching: [], removed: true });

    // A terminal that already died has dropped off by itself, so forgetting it
    // again is a plain `false` — never an error a conductor has to handle.
    const again = await mcp.callTool({
      name: "unwatch_terminal",
      arguments: { id: `local/${ALPHA_1}` },
    });
    expect(again.structuredContent).toEqual({ watching: [], removed: false });
  });

  it("unwatching a terminal that is GONE still works — the roster is not consulted", async () => {
    const { alpha, fleet } = twoHostFleet();
    const watchList = fakeWatchList();
    const mcp = await servedFleet(fleet.hosts, watchList);
    await mcp.callTool({
      name: "watch_terminal",
      arguments: { id: `local/${ALPHA_1}` },
    });

    alpha.remove(ALPHA_1);
    const res = await mcp.callTool({
      name: "unwatch_terminal",
      arguments: { id: `local/${ALPHA_1}` },
    });

    expect(res.isError ?? false).toBe(false);
    expect(res.structuredContent).toEqual({ watching: [], removed: true });
  });

  it("`watched` reads the list back — every ref, its host as the fleet stands NOW, and the last thing kolu saw in it", async () => {
    // The failure this resource exists for: a Conductor that had restarted
    // could move the list and never read it, so it said it was "not certain"
    // what it was watching and then watched terminals that were long gone.
    const { beta, fleet } = twoHostFleet();
    beta.runAgent(BETA_1, "codex", "thinking");
    const watchList = fakeWatchList();
    const mcp = await servedFleet(fleet.hosts, watchList);
    await mcp.callTool({
      name: "watch_terminal",
      arguments: { id: `local/${ALPHA_1}` },
    });
    await mcp.callTool({
      name: "watch_terminal",
      arguments: { id: `remote:box/${BETA_1}` },
    });
    // What the server's watcher writes back between turns, and the only place
    // a name or an agent on this list comes from.
    watchList.sawIn(`remote:box/${BETA_1}`, "the implementor", "codex");

    expect(
      jsonOf(await mcp.readResource({ uri: "surface://cells/watched" })),
    ).toEqual([
      {
        ref: `local/${ALPHA_1}`,
        host: "local",
        hostName: "this machine",
        hostState: "connected",
        // Nothing has read it yet — said as `null` rather than as a terminal
        // that is called nothing.
        name: null,
        agent: null,
        joined: "asked",
      },
      {
        ref: `remote:box/${BETA_1}`,
        host: "remote:box",
        hostName: "box",
        hostState: "connected",
        name: "the implementor",
        agent: "codex",
        joined: "asked",
      },
    ]);
  });

  it("a row whose host is NOT answering says so, and one whose host has left keeps its row", async () => {
    // Both halves matter to an agent deciding what it still has: a warming
    // host is one to wait for, and a host that is gone is one to take off the
    // list. Dropping the second row would read as a list that never had it.
    const { fleet } = twoHostFleet();
    const watchList = fakeWatchList();
    const mcp = await servedFleet(fleet.hosts, watchList);
    await mcp.callTool({
      name: "watch_terminal",
      arguments: { id: `remote:box/${BETA_1}` },
    });

    fleet.setState("remote:box", "warming");
    expect(
      jsonOf(await mcp.readResource({ uri: "surface://cells/watched" })),
    ).toMatchObject([{ host: "remote:box", hostState: "warming" }]);

    fleet.leave("remote:box");
    expect(
      jsonOf(await mcp.readResource({ uri: "surface://cells/watched" })),
    ).toEqual([
      {
        ref: `remote:box/${BETA_1}`,
        // Nothing is invented for a host this fleet no longer holds: the ref
        // is still watched, and there is nothing to reach it through.
        host: null,
        hostName: null,
        hostState: null,
        name: null,
        agent: null,
        joined: "asked",
      },
    ]);
  });

  it("a subscriber hears a move nobody on this face made", async () => {
    // The list changes under the conversation — a watched terminal goes away,
    // a person takes one off in the browser — and a conductor that only
    // learned of it by calling something would act on a terminal that is not
    // there. The subscription is how it hears instead.
    const { fleet } = twoHostFleet();
    const watchList = fakeWatchList();
    const mcp = await servedFleet(fleet.hosts, watchList);
    await mcp.callTool({
      name: "watch_terminal",
      arguments: { id: `local/${ALPHA_1}` },
    });
    const updates: string[] = [];
    mcp.setNotificationHandler(ResourceUpdatedNotificationSchema, (note) => {
      updates.push(note.params.uri);
    });
    await mcp.subscribeResource({ uri: "surface://cells/watched" });
    // Whatever subscribing itself announces has landed by the time a round
    // trip to the same server has: the count below is what the MOVE adds.
    await mcp.readResource({ uri: "surface://cells/watched" });
    const before = updates.length;

    // The move this face did NOT make: kolu-server dropping a terminal that
    // went away.
    watchList.unwatch(`local/${ALPHA_1}`);

    await vi.waitFor(() => {
      expect(updates.length).toBeGreaterThan(before);
    });
    expect(updates.at(-1)).toBe("surface://cells/watched");
    expect(
      jsonOf(await mcp.readResource({ uri: "surface://cells/watched" })),
    ).toEqual([]);
  });
});

describe("one expose map, two projections", () => {
  const resolved = () => ({
    stdio: resolveExpose(padiSurface.spec, KOLU_MCP_EXPOSE, undefined),
    fleet: resolveExpose(fleetSurface.spec, KOLU_FLEET_EXPOSE, undefined),
  });
  const names = (one: ReturnType<typeof resolveExpose>): string[] =>
    one.tools.map((tool) => tool.name).sort();

  it("both projections mint the same TERMINAL verbs", () => {
    const { stdio, fleet } = resolved();
    expect(names(stdio)).toEqual([
      "fs_listAll",
      "fs_readFile",
      "git_getDiff",
      "git_getStatus",
      "lifecycle_kill",
      "screen_history",
      // Stdio only — the fleet face serves no standing subscription at all.
      "watch_close",
    ]);
    expect(names(fleet)).toEqual([
      "fs_listAll",
      "fs_readFile",
      "git_getDiff",
      "git_getStatus",
      "lifecycle_kill",
      "screen_history",
    ]);
    // What may be DONE to a terminal is still one list: the only difference is
    // the subscription verb, which has no member on the fleet surface to hang
    // on.
    const mutates = (one: ReturnType<typeof resolveExpose>) =>
      Object.fromEntries(one.tools.map((tool) => [tool.name, tool.mutates]));
    for (const name of names(fleet)) {
      expect(mutates(fleet)[name]).toBe(mutates(stdio)[name]);
    }
  });

  it("the RESOURCE lists differ exactly as the module doc argues", () => {
    const { stdio, fleet } = resolved();
    expect(stdio.resources.map((r) => r.key).sort()).toEqual([
      "daemonStatus",
      "identity",
      "status",
      "terminals",
      "urgency",
    ]);
    expect(fleet.resources.map((r) => r.key).sort()).toEqual([
      "hosts",
      "terminals",
      "urgency",
      // The one resource the stdio face has no counterpart for: this face
      // serves one CONVERSATION, and the watch list is that conversation's.
      "watched",
    ]);
    // ... and `hosts` is a CELL, which is what makes the roster one read: a
    // collection's resource is its key SET plus a per-item template, and an
    // agent that reads a key set still knows nothing about any host in it.
    expect(fleet.resources.find((r) => r.key === "hosts")?.kind).toBe("cell");
    expect(fleet.resourceTemplates.map((t) => t.key)).toEqual(["terminals"]);
  });

  it("the served fleet face serves the conductor's set — and NOT the waits that never end", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveKoluFleetMcp({
      hosts: fleet.hosts,
      transport: serverTransport,
      serverInfo: { name: "kolu-fleet", version: "0.0.0-test" },
      watchList: fakeWatchList(),
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    try {
      const { tools } = await mcp.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "agent_say",
        "fs_listAll",
        "fs_readFile",
        "git_getDiff",
        "git_getStatus",
        "lifecycle_create",
        "lifecycle_kill",
        "lifecycle_sendInput",
        "screen_history",
        "screen_image",
        "screen_text",
        "unwatch_terminal",
        "wait_outputSettled",
        "watch_terminal",
      ]);
      // The removed four, named so a re-addition is a deliberate edit to this
      // list rather than a quiet widening: each is a call with no end, and the
      // conductor's turn is a conversation a human may be trying to speak into.
      for (const gone of [
        "wait_agentState",
        "watch_open",
        "watch_next",
        "watch_close",
      ]) {
        expect(tools.map((tool) => tool.name)).not.toContain(gone);
      }
      // `kolu mcp` keeps every one of them — the reduction is this face's, not
      // the tool table's.
      expect(Object.keys(KOLU_MCP_TOOLS).sort()).toEqual([
        "agent_say",
        "lifecycle_create",
        "lifecycle_sendInput",
        "screen_image",
        "screen_text",
        "wait_agentState",
        "wait_outputSettled",
        "watch_next",
        "watch_open",
      ]);
      // The static roll the conductor's teaching script is pinned against —
      // every name in it is actually served, and nothing served is missing
      // from it. (The raw-procedure tools come from the expose map, not this
      // list, so they are subtracted rather than expected here.)
      const served = tools.map((tool) => tool.name);
      expect([...KOLU_FLEET_TOOL_NAMES].sort()).toEqual([
        "agent_say",
        "lifecycle_create",
        "lifecycle_sendInput",
        "screen_image",
        "screen_text",
        "unwatch_terminal",
        "wait_outputSettled",
        "watch_terminal",
      ]);
      for (const name of KOLU_FLEET_TOOL_NAMES) {
        expect(served).toContain(name);
      }
    } finally {
      await mcp.close();
      await close();
    }
  });

  it("the fleet `wait_outputSettled` REFUSES a wait longer than the cap", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveKoluFleetMcp({
      hosts: fleet.hosts,
      transport: serverTransport,
      serverInfo: { name: "kolu-fleet", version: "0.0.0-test" },
      watchList: fakeWatchList(),
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    try {
      const res = await mcp.callTool({
        name: "wait_outputSettled",
        arguments: {
          id: `local/${ALPHA_1}`,
          idleMs: FLEET_SETTLE_CAP_MS + 1,
        },
      });
      // REFUSED, not clamped: a clamp answers "met" after three seconds to a
      // caller that believed it had waited ten minutes.
      expect(res.isError).toBe(true);
      expect(JSON.stringify(res.content)).toContain(
        String(FLEET_SETTLE_CAP_MS),
      );
      // The cap is advertised, so a model reads it before it tries.
      const { tools } = await mcp.listTools();
      const wait = tools.find((tool) => tool.name === "wait_outputSettled");
      expect(JSON.stringify(wait?.inputSchema)).toContain(
        String(FLEET_SETTLE_CAP_MS),
      );
    } finally {
      await mcp.close();
      await close();
    }
  });
});

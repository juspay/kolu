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
 * The fakes are the padi CLIENT shape, not a daemon: members return the
 * `Effect`s and `Stream`s a dialled client returns, which is the only thing
 * this face consumes.
 */

import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import {
  type PadiTerminal,
  type PadiUrgency,
  type PadiWatchEvent,
  padiSurface,
  WatchSubscriptionNotFound,
} from "@kolu/padi-client/surface";
import { resolveExpose } from "@kolu/surface-mcp";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Effect, Queue, Stream } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { KOLU_FLEET_EXPOSE, KOLU_MCP_EXPOSE } from "../expose.ts";
import { fleetSurface } from "./fleetSurface.ts";
import type { FleetHosts } from "./hosts.ts";
import { serveKoluFleetMcp } from "./serve.ts";

const ALPHA_1 = "11111111-1111-4111-8111-111111111111" as TerminalId;
const ALPHA_2 = "22222222-2222-4222-8222-222222222222" as TerminalId;
const BETA_1 = "33333333-3333-4333-8333-333333333333" as TerminalId;

/** A value with subscribers, as a snapshot-then-change `Stream` — the shape
 *  every padi cell and collection-keys member has on the wire. */
function cell<T>(initial: T) {
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
    ...(parentId === undefined ? {} : { parentId }),
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
  /** Drop every subscription this padi holds, keeping the client — a padi
   *  that RESTARTED under a mirror that never dropped, so nothing upstream
   *  observed a disconnect and the next drain finds no such queue. */
  forgetWatches(): void;
  readonly openedWatches: string[];
  readonly closedWatches: string[];
}

function fakePadi(host: string, seeded: readonly TerminalId[]): FakePadi {
  const calls: string[] = [];
  const records = new Map<TerminalId, PadiTerminal>(
    seeded.map((id) => [id, terminalRecord(`${host} ${id.slice(0, 4)}`)]),
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

  const client = {
    surface: {
      identity: {
        get: () =>
          Stream.make({
            commit: `${host}-commit`,
            surfaceVersion: "7.0",
            startedAt: 1000,
          }),
      },
      status: { get: () => Stream.make({}) },
      urgency: { get: () => urgency.stream() },
      terminals: {
        keys: () => keys.stream(),
        get: ({ key }: { key: TerminalId }) => {
          const record = records.get(key);
          return record === undefined ? Stream.never : Stream.make(record);
        },
      },
      screen: {
        text: (input: { id: TerminalId }) =>
          Effect.sync(() => {
            calls.push(`screen.text:${input.id}`);
            return `screen of ${host}/${input.id}`;
          }),
        history: (input: { id: TerminalId; max: number }) =>
          Effect.sync(() => {
            calls.push(`screen.history:${input.id}`);
            return { kind: "ok", chunk: host, topLine: 1, exhausted: true };
          }),
      },
      lifecycle: {
        create: (input: unknown) =>
          Effect.sync(() => {
            calls.push(`lifecycle.create:${JSON.stringify(input)}`);
            return { id: BETA_1, pid: 77 };
          }),
        kill: (input: { id: TerminalId }) =>
          Effect.sync(() => {
            calls.push(`lifecycle.kill:${input.id}`);
            return { id: input.id, pid: 42 };
          }),
        sendInput: (input: unknown) =>
          Effect.suspend(() => {
            calls.push(`lifecycle.sendInput:${JSON.stringify(input)}`);
            return sendInputRefusal === null
              ? Effect.void
              : Effect.fail(new Error(sendInputRefusal));
          }),
      },
      git: {
        getStatus: (input: { repoPath: string }) =>
          Effect.sync(() => {
            calls.push(`git.getStatus:${input.repoPath}`);
            return { files: [], branch: host };
          }),
      },
      watch: {
        // padi's own rule, because the fleet leans on it: a FRESH subscription
        // starts acknowledged at the daemon's current sequence (it reports what
        // happens next), and a RE-ATTACH keeps the watermark it had — which is
        // what makes a reconnect hand over what was queued while the link was
        // down instead of skipping it.
        open: (input: { name: string }) =>
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
        drain: (input: { name: string; after?: number }) =>
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
        close: (input: { name: string }) =>
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
      },
      watchPulse: { get: () => pulse.stream() },
    },
  } as unknown as PadiSurfaceClient;

  return {
    client,
    calls,
    openedWatches,
    closedWatches,
    add(id, title, parentId) {
      records.set(id, terminalRecord(title, parentId));
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
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    teardown = async () => {
      await mcp.close();
      await close();
    };
    return mcp;
  }

  function twoHosts() {
    const alpha = fakePadi("local", [ALPHA_1, ALPHA_2]);
    const beta = fakePadi("remote:box", [BETA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
      { key: "remote:box", display: "box", padi: beta },
    ]);
    return { alpha, beta, fleet };
  }

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

  it("`hosts` is the live roster, with each padi's build facts as columns", async () => {
    const { fleet } = twoHosts();
    const mcp = await servedFleet(fleet.hosts);
    expect(
      jsonOf(await mcp.readResource({ uri: "surface://collections/hosts" })),
    ).toEqual(["local", "remote:box"]);
    expect(
      jsonOf(
        await mcp.readResource({ uri: "surface://collections/hosts/local" }),
      ),
    ).toEqual({
      host: "local",
      display: "this machine",
      state: "connected",
      commit: "local-commit",
      surfaceVersion: "7.0",
      startedAt: 1000,
    });
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

describe("the fleet watch", () => {
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
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    teardown = async () => {
      await mcp.close();
      await close();
    };
    return mcp;
  }

  /** A host the fleet watch could not hear from this round, as it reaches the
   *  caller. */
  interface Gap {
    readonly host: string;
    readonly kind: string;
    readonly state: string;
    readonly why: string;
  }

  interface Drained {
    readonly id: string;
    readonly result: string;
    readonly met?: {
      readonly events: readonly { id: string; kind: string; seq: number }[];
      readonly ackAfter: number;
    };
    readonly gaps?: readonly Gap[];
  }

  const drain = async (
    mcp: Client,
    args: Record<string, unknown>,
  ): Promise<Drained> => {
    const res = await mcp.callTool({ name: "watch_next", arguments: args });
    expect(res.isError ?? false, JSON.stringify(res.content)).toBe(false);
    return res.structuredContent as unknown as Drained;
  };

  it("merges two hosts' queues into ONE ordered drain under a fleet seq", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const beta = fakePadi("remote:box", [BETA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
      { key: "remote:box", display: "box", padi: beta },
    ]);
    const mcp = await servedFleet(fleet.hosts);

    const opened = await mcp.callTool({
      name: "watch_open",
      arguments: { name: "fleet" },
    });
    expect(opened.isError ?? false).toBe(false);
    expect(opened.structuredContent).toMatchObject({
      name: "fleet",
      hosts: ["local", "remote:box"],
      reattached: false,
    });
    expect(alpha.openedWatches).toEqual(["fleet"]);
    expect(beta.openedWatches).toEqual(["fleet"]);

    alpha.fire(ALPHA_1, "asking");
    beta.fire(BETA_1, "finished");

    const batch = await drain(mcp, { name: "fleet", timeoutMs: 2000 });
    expect(batch.result).toBe("met");
    expect(batch.met?.events.map((e) => [e.id, e.kind, e.seq])).toEqual([
      [`local/${ALPHA_1}`, "asking", 1],
      [`remote:box/${BETA_1}`, "finished", 2],
    ]);
    // The cursor is the FLEET's: echoing it back forgets exactly this batch.
    expect(batch.met?.ackAfter).toBe(2);
    const after = await drain(mcp, {
      name: "fleet",
      after: batch.met?.ackAfter,
      timeoutMs: 150,
    });
    expect(after.result).toBe("timeout");
  });

  it("a host that ARRIVES mid-watch flows in without reopening", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const mcp = await servedFleet(fleet.hosts);
    await mcp.callTool({ name: "watch_open", arguments: { name: "fleet" } });

    const beta = fakePadi("remote:box", [BETA_1]);
    fleet.join("remote:box", "box", beta);

    // The arriving host is legged by the FLEET, on the subscription that is
    // already open — the caller never re-opens anything, which is the whole
    // point of one conversation over a changing fleet.
    const quiet = await drain(mcp, { name: "fleet", timeoutMs: 150 });
    expect(quiet.result).toBe("timeout");
    expect(beta.openedWatches).toEqual(["fleet"]);

    // ...and from then on it is an ordinary member of the merged feed. Its leg
    // starts at the watermark padi handed back at open, exactly as a per-host
    // subscription does: what happens NEXT, not that host's history.
    beta.fire(BETA_1, "asking");
    const batch = await drain(mcp, { name: "fleet", timeoutMs: 2000 });
    expect(batch.met?.events.map((e) => e.id)).toEqual([
      `remote:box/${BETA_1}`,
    ]);
    expect(beta.openedWatches).toEqual(["fleet"]);
  });

  it("a host that LEAVES reports every terminal it was carrying as gone", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const beta = fakePadi("remote:box", [BETA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
      { key: "remote:box", display: "box", padi: beta },
    ]);
    const mcp = await servedFleet(fleet.hosts);
    await mcp.callTool({ name: "watch_open", arguments: { name: "fleet" } });
    // A terminal born after the open still counts: the roster is refreshed on
    // every drain, not only from events.
    beta.add(ALPHA_2, "late worker");
    const first = await drain(mcp, { name: "fleet", timeoutMs: 150 });
    expect(first.result).toBe("timeout");

    fleet.leave("remote:box");

    const batch = await drain(mcp, { name: "fleet", timeoutMs: 2000 });
    expect(batch.met?.events.map((e) => [e.id, e.kind])).toEqual([
      [`remote:box/${BETA_1}`, "gone"],
      [`remote:box/${ALPHA_2}`, "gone"],
    ]);
  });

  it("a host that DISCONNECTS is PARKED, not mourned — and drains what it missed when it returns", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const beta = fakePadi("remote:box", [BETA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
      { key: "remote:box", display: "box", padi: beta },
    ]);
    const mcp = await servedFleet(fleet.hosts);
    await mcp.callTool({ name: "watch_open", arguments: { name: "fleet" } });

    // An ssh blip, or a remote padi restarting: kolu-server's mirror loses the
    // client while the host stays in the map. Its terminals are still there.
    fleet.setState("remote:box", "warming");
    // ...and something DOES happen on it while the link is down.
    beta.fire(BETA_1, "asking");

    const quiet = await drain(mcp, { name: "fleet", timeoutMs: 150 });
    expect(quiet.result).toBe("timeout");
    // Not one `gone` — that word is what the standing prompt teaches as "dead",
    // and nothing would ever announce the return.
    expect(quiet.met?.events ?? []).toEqual([]);
    // The silence is not left to be read as a calm machine, either.
    expect(quiet.gaps).toMatchObject([
      { host: "remote:box", kind: "not-connected", state: "warming" },
    ]);

    fleet.join("remote:box", "box", beta);

    const batch = await drain(mcp, { name: "fleet", timeoutMs: 2000 });
    // The event queued DURING the outage arrives: the leg was re-opened at the
    // watermark padi kept, not at whatever that daemon's sequence had reached.
    expect(batch.met?.events.map((e) => [e.id, e.kind])).toEqual([
      [`remote:box/${BETA_1}`, "asking"],
    ]);
    expect(batch.gaps).toBeUndefined();
    // RE-OPENED, not merely re-drained: the padi that answers again may be a
    // fresh process that never heard the name, and a drain against that fails
    // the whole fleet's `watch_next`.
    expect(beta.openedWatches).toEqual(["fleet", "fleet"]);
  });

  it("under `watch all`, a host whose watch.open keeps failing costs its own lane and not the fleet's", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const beta = fakePadi("remote:box", [BETA_1]);
    beta.refuseWatchOpen("the watch registry is at its cap");
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
      { key: "remote:box", display: "box", padi: beta },
    ]);
    const mcp = await servedFleet(fleet.hosts);

    const opened = await mcp.callTool({
      name: "watch_open",
      arguments: { name: "fleet" },
    });
    expect(opened.isError ?? false, JSON.stringify(opened.content)).toBe(false);
    expect(opened.structuredContent).toMatchObject({
      hosts: ["local"],
      gaps: [{ host: "remote:box", kind: "watch-refused" }],
    });

    alpha.fire(ALPHA_1, "asking");
    const batch = await drain(mcp, { name: "fleet", timeoutMs: 2000 });
    // The healthy machine still reports. A `watch_next` that failed outright
    // would leave the agent with nothing from it.
    expect(batch.met?.events.map((e) => e.id)).toEqual([`local/${ALPHA_1}`]);
    // And the sick one is DATA, not silence — with the host's own refusal in it.
    expect(batch.gaps).toMatchObject([
      { host: "remote:box", kind: "watch-refused", state: "connected" },
    ]);
    expect(batch.gaps?.[0]?.why).toContain("the watch registry is at its cap");
    // Retried every round rather than written off.
    expect(beta.openedWatches.length).toBeGreaterThan(1);

    // ...and when it recovers, the next round legs it onto the subscription
    // that is already open — the caller re-opens nothing.
    beta.refuseWatchOpen(null);
    const legged = await drain(mcp, {
      name: "fleet",
      after: batch.met?.ackAfter,
      timeoutMs: 150,
    });
    expect(legged.result).toBe("timeout");
    expect(legged.gaps).toBeUndefined();

    beta.fire(BETA_1, "finished");
    const after = await drain(mcp, { name: "fleet", timeoutMs: 2000 });
    expect(after.met?.events.map((e) => e.id)).toEqual([
      `remote:box/${BETA_1}`,
    ]);
    expect(after.gaps).toBeUndefined();
  });

  it("a padi that RESTARTS under a live link re-legs itself instead of failing the fleet's drain", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const beta = fakePadi("remote:box", [BETA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
      { key: "remote:box", display: "box", padi: beta },
    ]);
    const mcp = await servedFleet(fleet.hosts);
    await mcp.callTool({ name: "watch_open", arguments: { name: "fleet" } });

    // kolu-server's mirror absorbs the restart, so the fleet face never saw a
    // disconnect — it is holding a cursor into a queue that no longer exists.
    beta.forgetWatches();
    alpha.fire(ALPHA_1, "asking");

    const batch = await drain(mcp, { name: "fleet", timeoutMs: 2000 });
    // The healthy host still reports: one machine's restart is not the
    // fleet's failure, which is what a bare `WatchSubscriptionNotFound` out of
    // the merged drain would have made it.
    expect(batch.met?.events.map((e) => e.id)).toEqual([`local/${ALPHA_1}`]);
    expect(beta.openedWatches).toEqual(["fleet", "fleet"]);

    // ...and the re-legged host is an ordinary member again.
    beta.fire(BETA_1, "finished");
    const after = await drain(mcp, {
      name: "fleet",
      after: batch.met?.ackAfter,
      timeoutMs: 2000,
    });
    expect(after.met?.events.map((e) => e.id)).toEqual([
      `remote:box/${BETA_1}`,
    ]);
  });

  it("a host the caller NAMED fails the open outright, rather than watching blind", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const beta = fakePadi("remote:box", [BETA_1]);
    beta.refuseWatchOpen("the watch registry is at its cap");
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
      { key: "remote:box", display: "box", padi: beta },
    ]);
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "watch_open",
      arguments: {
        name: "fleet",
        ids: [`local/${ALPHA_1}`, `remote:box/${BETA_1}`],
      },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain(
      "the watch registry is at its cap",
    );
  });

  it("a NAMED host that comes back REFUSING fails the drain, instead of dropping the lane", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const beta = fakePadi("remote:box", [BETA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
      { key: "remote:box", display: "box", padi: beta },
    ]);
    const mcp = await servedFleet(fleet.hosts);
    const opened = await mcp.callTool({
      name: "watch_open",
      arguments: {
        name: "fleet",
        ids: [`local/${ALPHA_1}`, `remote:box/${BETA_1}`],
      },
    });
    expect(opened.isError ?? false).toBe(false);

    // It drops, and the padi that comes back is a FRESH process — a different
    // client, which never heard this subscription's name — and it refuses the
    // re-open. The caller asked about that terminal by name, so a watch that
    // cannot cover it is not the watch it opened, and carrying on quietly is
    // the blindness this rule exists to refuse.
    fleet.setState("remote:box", "warming");
    const restarted = fakePadi("remote:box", [BETA_1]);
    restarted.refuseWatchOpen("the watch registry is at its cap");
    fleet.join("remote:box", "box", restarted);

    const res = await mcp.callTool({
      name: "watch_next",
      arguments: { name: "fleet", timeoutMs: 2000 },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain(
      "the watch registry is at its cap",
    );
  });

  it("watch_close closes every per-host leg", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const beta = fakePadi("remote:box", [BETA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
      { key: "remote:box", display: "box", padi: beta },
    ]);
    const mcp = await servedFleet(fleet.hosts);
    await mcp.callTool({ name: "watch_open", arguments: { name: "fleet" } });
    const closed = await mcp.callTool({
      name: "watch_close",
      arguments: { name: "fleet" },
    });
    expect(closed.isError ?? false).toBe(false);
    expect(alpha.closedWatches).toEqual(["fleet"]);
    expect(beta.closedWatches).toEqual(["fleet"]);
  });

  it("a drain against a name nobody opened refuses as data, not as a hang", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
    ]);
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "watch_next",
      arguments: { name: "never-opened", timeoutMs: 500 },
    });
    expect(res.isError).toBe(true);
    // The refusal survives the promise edge intact — an agent reads "re-open
    // your watch", not a server bug.
    expect(res.structuredContent).toMatchObject({
      kind: "no-such-watch",
      name: "never-opened",
    });
  });

  it("ids are grouped by host, and one on a disconnected host is refused by name", async () => {
    const alpha = fakePadi("local", [ALPHA_1]);
    const fleet = fakeFleet([
      { key: "local", display: "this machine", padi: alpha },
      { key: "remote:box", display: "box", padi: null, state: "warming" },
    ]);
    const mcp = await servedFleet(fleet.hosts);
    const res = await mcp.callTool({
      name: "watch_open",
      arguments: { name: "fleet", ids: [`remote:box/${BETA_1}`] },
    });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toMatchObject({
      kind: "host-not-connected",
      host: "remote:box",
    });
    expect(alpha.openedWatches).toEqual([]);
  });
});

describe("one expose map, two projections", () => {
  it("both projections mint EXACTLY the same tool list", () => {
    const stdio = resolveExpose(padiSurface.spec, KOLU_MCP_EXPOSE, undefined);
    const fleet = resolveExpose(
      fleetSurface.spec,
      KOLU_FLEET_EXPOSE,
      undefined,
    );
    const names = (
      resolved: ReturnType<typeof resolveExpose>,
    ): { name: string; mutates: boolean }[] =>
      resolved.tools
        .map((tool) => ({ name: tool.name, mutates: tool.mutates }))
        .sort((a, b) => a.name.localeCompare(b.name));
    expect(names(fleet)).toEqual(names(stdio));
    expect(names(stdio).map((one) => one.name)).toEqual([
      "fs_listAll",
      "fs_readFile",
      "git_getDiff",
      "git_getStatus",
      "lifecycle_kill",
      "screen_history",
      "watch_close",
    ]);
  });

  it("the RESOURCE lists differ exactly as the module doc argues", () => {
    const stdio = resolveExpose(padiSurface.spec, KOLU_MCP_EXPOSE, undefined);
    const fleet = resolveExpose(
      fleetSurface.spec,
      KOLU_FLEET_EXPOSE,
      undefined,
    );
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
    ]);
  });

  it("the served fleet face advertises the same fifteen tools `kolu mcp` does", async () => {
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
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    try {
      const { tools } = await mcp.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
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
        "wait_agentState",
        "wait_outputSettled",
        "watch_close",
        "watch_next",
        "watch_open",
      ]);
    } finally {
      await mcp.close();
      await close();
    }
  });
});

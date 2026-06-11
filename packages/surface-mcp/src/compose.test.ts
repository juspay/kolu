/**
 * COMPOSITION PROOF — `projectSurface` (@kolu/surface) ∘ `serveSurfaceAsMcp`
 * (@kolu/surface-mcp): the odu pattern in miniature.
 *
 * This is the headline test for kolu#982. It proves the two primitives COMPOSE:
 * a native reactive surface A (odu's coordinator), projected to a curated foreign
 * surface B (`projectSurface`), then re-exposed to an MCP host (`serveSurfaceAsMcp`).
 * One source of truth (A); a narrowed, default-deny face (B); a protocol adapter
 * (MCP) on top — with A→B→MCP propagation surviving the whole stack.
 *
 *   A (source / coordinator)
 *     cells:      nodes        — [{ id, status: "pending"|"ok"|"failed" }]
 *     streams:    nodeLog      — per-node log lines (snapshot-then-deltas)
 *     procedures: run.configure (DANGEROUS lane-mutation — must NOT escape)
 *                 node.rerun    (safe)
 *
 *   B (projected / curated face) = projectSurface(A, …)
 *     cell    nodes   ← deriveCell  over A.nodes  (adds a `red` flag per node)
 *     stream  log     ← deriveStream over A.nodeLog (bounded passthrough)
 *     event   settled ← deriveEvent over A.nodes  (fires when all nodes terminal)
 *     proc    node.rerun → A.node.rerun (passthrough)
 *     — NO run.configure. The dangerous verb is structurally absent from B.
 *
 *   MCP = serveSurfaceAsMcp({ surface: B, client: bClient, expose, tools: { run } })
 *
 * The six assertions (the proof):
 *   a. tools/list has `node_rerun` AND bespoke `run`, but NOT `run_configure`
 *      — default-deny proven twice (not-exposed, and not-even-in-B).
 *   b. resources/list has the `nodes` and `log` resources.
 *   c. resources/read on `nodes` returns the current snapshot.
 *   d. subscribe `nodes`, mutate A's `nodes` via ctx, observe a
 *      notifications/resources/updated for the nodes URI — A→B→MCP propagation.
 *   e. tools/call `node_rerun` reaches A through the projection.
 *   f. tools/call the bespoke `run` tool runs against the live client.
 */

import { defineSurface } from "@kolu/surface/define";
import { directLink } from "@kolu/surface/links/direct";
import {
  deriveCell,
  deriveEvent,
  deriveStream,
  projectSurface,
  type SurfaceClientOf,
  surfaceClientRef,
} from "@kolu/surface/project";
import type { InMemoryChannel, SurfaceCtx } from "@kolu/surface/server";
import {
  implementSurface,
  inMemoryChannel,
  inMemoryChannelByName,
  inMemoryStore,
} from "@kolu/surface/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { cellUri, streamUri } from "./expose";
import { serveSurfaceAsMcp } from "./server";

// ── Surface A — the coordinator (odu in miniature) ───────────────────────

const nodeSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "ok", "failed"]),
});
type Node = z.infer<typeof nodeSchema>;

// Hoisted to module scope so the (large) `SurfaceClientOf<…>` client unions are
// materialized from a single named `typeof` rather than re-instantiated at every
// test call site — TS's per-file union budget overflows otherwise (mirrors
// project.test.ts).
const aSpec = {
  cells: {
    nodes: { schema: z.array(nodeSchema), default: [] as Node[] },
  },
  streams: {
    // per-node log: snapshot (current line) then deltas pushed on the bus.
    nodeLog: {
      inputSchema: z.object({ id: z.string() }),
      outputSchema: z.string(),
    },
  },
  procedures: {
    run: {
      // The DANGEROUS lane-mutation verb. Present on A, never projected to B.
      configure: {
        input: z.object({ lanes: z.number() }),
        output: z.boolean(),
      },
    },
    node: {
      // The safe verb — flips a node to "pending" again.
      rerun: { input: z.object({ id: z.string() }), output: z.boolean() },
    },
  },
} as const;

type ASpec = typeof aSpec;

interface SourceA {
  surface: ReturnType<typeof defineSurface<ASpec>>;
  router: ReturnType<typeof implementSurface<ASpec>>["router"];
  ctx: SurfaceCtx<ASpec>;
  logBus: InMemoryChannel<string>;
  nodesStore: ReturnType<typeof inMemoryStore<Node[]>>;
}

function buildSourceA(initial: Node[]): SourceA {
  const surface = defineSurface(aSpec);

  const logBus = inMemoryChannel<string>();
  const nodesStore = inMemoryStore<Node[]>(initial);

  const { router, ctx } = implementSurface(surface, {
    channel: inMemoryChannelByName(),
    cells: {
      nodes: { store: nodesStore },
    },
    streams: {
      nodeLog: {
        source: async function* (input, signal) {
          // snapshot first, then deltas pushed onto the bus.
          yield `node ${input.id}: log opened`;
          for await (const line of logBus.subscribe(signal)) yield line;
        },
      },
    },
    procedures: {
      run: {
        configure: ({ input, ctx }) => {
          // Dangerous: blows away the whole node list. This must never be
          // reachable through B / MCP.
          ctx.cells.nodes.set([]);
          void input.lanes;
          return true;
        },
      },
      node: {
        rerun: ({ input, ctx }) => {
          const next = ctx.cells.nodes
            .get()
            .map((n) =>
              n.id === input.id ? { ...n, status: "pending" as const } : n,
            );
          ctx.cells.nodes.set(next);
          logBus.publish(`node ${input.id}: rerun requested`);
          return true;
        },
      },
    },
  });

  return { surface, router, ctx, logBus, nodesStore };
}

// ── Surface B — projected, curated face of A ─────────────────────────────

// B's `nodes` adds a `red` flag (failed → red) derived from A's node status.
const bNodeSchema = z.object({
  id: z.string(),
  status: z.enum(["pending", "ok", "failed"]),
  red: z.boolean(),
});
type BNode = z.infer<typeof bNodeSchema>;

const bSpec = {
  cells: {
    // B.nodes = A.nodes mapped to add `red`.
    nodes: { schema: z.array(bNodeSchema), default: [] as BNode[] },
  },
  streams: {
    // B.log = A.nodeLog for a FIXED node, mapped passthrough (the
    // "bounded/guarded" projection). B's `log` is a no-input stream — the
    // projection bakes in *which* node's log is observable, so it's a single
    // static MCP resource (`surface://streams/log`). An input-bearing stream
    // can't be a static resource (it would have no input to pass on read);
    // fixing the input in the projection is exactly the curation cut.
    log: {
      inputSchema: z.void(),
      outputSchema: z.string(),
    },
  },
  events: {
    // B.settled = fires `true` whenever every node in A is terminal.
    settled: { inputSchema: z.void(), outputSchema: z.boolean() },
  },
  procedures: {
    node: {
      // passthrough to A's node.rerun — the only verb B carries.
      rerun: { input: z.object({ id: z.string() }), output: z.boolean() },
    },
    // NOTE: NO `run.configure`. The dangerous verb is structurally absent.
  },
} as const;

type BSpec = typeof bSpec;
type BClient = SurfaceClientOf<BSpec>;

const isTerminal = (n: Node): boolean =>
  n.status === "ok" || n.status === "failed";
const toBNode = (n: Node): BNode => ({ ...n, red: n.status === "failed" });

function projectB(a: SourceA) {
  return projectSurface<ASpec, BSpec>(a.surface, {
    spec: bSpec,
    deps: (client) => ({
      channel: inMemoryChannelByName(),
      cells: {
        nodes: deriveCell(
          (opts) => client.surface.nodes.get(undefined, opts),
          (ns) => ns.map(toBNode),
          [],
        ),
      },
      streams: {
        // B.log fixes the upstream node id ("a") in the projection, so B's
        // `log` takes no input and is a valid static resource.
        log: deriveStream(
          (_input: void, opts) => client.surface.nodeLog.get({ id: "a" }, opts),
          (line) => line,
        ),
      },
      events: {
        // deriveEvent over A.nodes — but only forward a `true` occurrence once
        // every node is terminal. We filter A's snapshot-then-deltas frames by
        // mapping non-settled frames to `false` and letting the consumer key on
        // `true`. (deriveEvent maps every frame; the settle gate lives in `map`.)
        settled: deriveEvent(
          (_input, opts) => client.surface.nodes.get(undefined, opts),
          (ns) => ns.length > 0 && ns.every(isTerminal),
        ),
      },
      procedures: {
        node: {
          rerun: async ({ input }) => client.surface.node.rerun(input),
        },
      },
    }),
  });
}

// ── Compose: A → B → MCP ─────────────────────────────────────────────────

interface Composed {
  a: SourceA;
  mcp: Client;
  served: { close: () => Promise<void> };
  closeBLink: () => void;
}

/** Build A, project + implement B, serve B as MCP, connect an MCP client.
 *  The heavy `directLink<…B…>` client union is materialized once here behind the
 *  named `BClient` alias; the A-client union is materialized once inside
 *  `projectB`'s `deps`. */
async function compose(initial: Node[]): Promise<Composed> {
  // 1. SOURCE A, implemented in-memory. `surfaceClientRef` already returns
  // `SurfaceClientOf<ASpec>`; the precise A-client type is materialized exactly
  // once — inside `projectB`'s `deps` callback (`projectSurface<ASpec, BSpec>`),
  // where the derive helpers earn it. Re-spelling the full `AClient` alias here
  // would force a SECOND materialization of that large client union in the same
  // type-check pass and overflow TS's union budget (`implement` takes the loose
  // `SurfaceClientLike` shape, so it doesn't need precision).
  const a = buildSourceA(initial);
  const aClient = surfaceClientRef(a.surface, a.router);

  // 2. PROJECT A → B, implement B against the A-client, build a B-client.
  const projected = projectB(a);
  const { router: bRouter } = projected.implement(aClient);
  const bClient = directLink<typeof projected.surface.contract>(
    bRouter,
  ) as BClient;

  // 3. SERVE B as MCP over an in-memory transport pair.
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const served = await serveSurfaceAsMcp({
    surface: projected.surface,
    client: () => bClient,
    expose: {
      nodes: "resource",
      log: "resource",
      "node.rerun": { tool: { mutates: true } },
      // "run.configure" is not even in B — cannot be named here.
    },
    tools: {
      // A bespoke, call-shaped tool: spawn-and-summarize. Composes over the
      // live B-client (reads the curated nodes snapshot) — the escape hatch
      // for capabilities that aren't a single surface verb.
      run: {
        input: z.object({ note: z.string().optional() }),
        description: "Kick off a run and summarize the curated node view.",
        mutates: true,
        handler: async (args, client) => {
          const sub = await client.surface.nodes.get(undefined);
          let snapshot: BNode[] = [];
          for await (const frame of sub as AsyncIterable<BNode[]>) {
            snapshot = frame;
            break;
          }
          return {
            started: true,
            note: (args as { note?: string }).note ?? null,
            nodeCount: snapshot.length,
          };
        },
      },
    },
    serverInfo: { name: "compose-test", version: "0.0.0" },
    transport: serverTransport,
  });

  const mcp = new Client({ name: "compose-client", version: "0.0.0" });
  await mcp.connect(clientTransport);

  return { a, mcp, served, closeBLink: () => {} };
}

let cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanup) await c();
  cleanup = [];
});

async function setup(initial?: Node[]): Promise<Composed> {
  const composed = await compose(
    initial ?? [
      { id: "a", status: "pending" },
      { id: "b", status: "failed" },
    ],
  );
  cleanup.push(
    () => composed.mcp.close(),
    () => composed.served.close(),
    () => composed.closeBLink(),
  );
  return composed;
}

describe("COMPOSITION PROOF — projectSurface ∘ serveSurfaceAsMcp (odu in miniature)", () => {
  it("(a) tools/list exposes node_rerun + bespoke run, NOT run_configure (default-deny, two ways)", async () => {
    const { mcp } = await setup();

    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name).sort();

    // The safe projected verb is a tool.
    expect(names).toContain("node_rerun");
    // The bespoke call-shaped tool is a tool.
    expect(names).toContain("run");
    // The dangerous verb is NOT a tool — proven twice:
    //   (1) default-deny: even if B had it, it isn't in `expose`;
    //   (2) structural: `run.configure` was never projected into B at all.
    expect(names).not.toContain("run_configure");
    expect(names).toEqual(["node_rerun", "run"]);
  });

  it("(b) resources/list contains the nodes + log resources", async () => {
    const { mcp } = await setup();

    const { resources } = await mcp.listResources();
    const uris = resources.map((r) => r.uri);

    expect(uris).toContain(cellUri("nodes"));
    expect(uris).toContain(streamUri("log"));
  });

  it("(c) resources/read on nodes returns the current (mapped) snapshot", async () => {
    const { mcp } = await setup([
      { id: "a", status: "ok" },
      { id: "b", status: "failed" },
    ]);

    // deriveCell's connect loop is async — poll until A's snapshot has
    // propagated through B's cell into the MCP read.
    await vi.waitFor(async () => {
      const read = await mcp.readResource({ uri: cellUri("nodes") });
      const body = (read.contents[0] as { text: string }).text;
      const value = JSON.parse(body) as BNode[];
      expect(value).toEqual([
        { id: "a", status: "ok", red: false },
        { id: "b", status: "failed", red: true },
      ]);
    });
  });

  it("(d) subscribe nodes → mutate A.ctx → notifications/resources/updated fires (A→B→MCP)", async () => {
    const { a, mcp } = await setup([{ id: "a", status: "pending" }]);

    const updates: string[] = [];
    mcp.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      updates.push(n.params.uri);
    });

    await mcp.subscribeResource({ uri: cellUri("nodes") });

    // Mutate A directly via its ctx. The chain is:
    //   A.nodes set → A cell delta → B.deriveCell maps → B.nodes delta →
    //   MCP pusher → notifications/resources/updated for the nodes URI.
    a.ctx.cells.nodes.set([{ id: "a", status: "ok" }]);

    await vi.waitFor(
      () => {
        expect(updates).toContain(cellUri("nodes"));
      },
      { timeout: 2000 },
    );
  });

  it("(e) tools/call node_rerun reaches A through the projection", async () => {
    const { a, mcp } = await setup([{ id: "a", status: "failed" }]);

    const res = await mcp.callTool({
      name: "node_rerun",
      arguments: { id: "a" },
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content as Array<{ type: string; text: string }>)[0];
    expect(JSON.parse(text?.text ?? "null")).toBe(true);

    // A's actual state moved: node "a" flipped back to "pending".
    expect(a.nodesStore.get()).toEqual([{ id: "a", status: "pending" }]);
  });

  it("(f) tools/call the bespoke run tool runs against the live client", async () => {
    const { mcp } = await setup([
      { id: "a", status: "ok" },
      { id: "b", status: "failed" },
    ]);

    // The bespoke handler reads the curated B-client view; poll until the
    // derived snapshot has propagated so nodeCount is the real count.
    await vi.waitFor(async () => {
      const res = await mcp.callTool({
        name: "run",
        arguments: { note: "go" },
      });
      expect(res.isError).toBeFalsy();
      const text = (res.content as Array<{ type: string; text: string }>)[0];
      expect(JSON.parse(text?.text ?? "null")).toEqual({
        started: true,
        note: "go",
        nodeCount: 2,
      });
    });
  });
});

/**
 * End-to-end: a real `@kolu/surface` re-exposed as MCP, driven by a real MCP
 * `Client` over the SDK's in-memory transport pair. The load-bearing test —
 * it proves the whole spine wires correctly and, crucially, that the
 * curation gate is **default-deny**.
 *
 * The surface has a `count` cell, a `ticks` stream, and two procedures: a
 * safe `bump` (exposed as a tool) and a DANGEROUS `nuke` (NOT exposed). We
 * also register one bespoke tool (`greet`). Then assert:
 *
 *   - tools/list shows only `counter_bump` + `greet`, and NOT `admin_nuke`;
 *   - tools/call on the exposed procedure mutates the cell;
 *   - the bespoke tool runs;
 *   - resources/list + resources/read return the cell snapshot;
 *   - resources/subscribe → a `notifications/resources/updated` fires when the
 *     underlying cell changes.
 */

import { defineSurface } from "@kolu/surface/define";
import { directLink } from "@kolu/surface/links/direct";
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

// ── A tiny surface + in-memory implementation ────────────────────────────

function buildSurface() {
  const surface = defineSurface({
    cells: {
      count: { schema: z.number(), default: 0 },
    },
    streams: {
      ticks: { inputSchema: z.void(), outputSchema: z.number() },
    },
    procedures: {
      counter: {
        bump: { output: z.number() },
      },
      admin: {
        // The dangerous verb — present on the surface, deliberately NOT
        // exposed. Proves default-deny: it must never reach the host.
        nuke: { output: z.boolean() },
      },
    },
  });

  const countStore = inMemoryStore(0);
  const tickBus = inMemoryChannel<number>();

  const { router } = implementSurface(surface, {
    channel: inMemoryChannelByName(),
    cells: { count: { store: countStore } },
    streams: {
      ticks: {
        source: async function* (_input, signal) {
          yield countStore.get();
          for await (const v of tickBus.subscribe(signal)) yield v;
        },
      },
    },
    procedures: {
      counter: {
        bump: ({ ctx }) => {
          const next = ctx.cells.count.get() + 1;
          ctx.cells.count.set(next);
          tickBus.publish(next);
          return next;
        },
      },
      admin: {
        nuke: ({ ctx }) => {
          ctx.cells.count.set(-999);
          return true;
        },
      },
    },
  });

  const client = directLink<typeof surface.contract>(router);
  return { surface, client };
}

/** Stand up the MCP server + a connected MCP client over an in-memory pair. */
async function connect(over: ReturnType<typeof buildSurface>) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  const served = await serveSurfaceAsMcp({
    surface: over.surface,
    client: () => over.client,
    expose: {
      count: "resource",
      ticks: "resource",
      "counter.bump": { tool: { mutates: true } },
      // "admin.nuke" deliberately omitted — default-deny.
    },
    tools: {
      greet: {
        input: z.object({ name: z.string() }),
        description: "Say hello.",
        handler: (args) => {
          const { name } = args as { name: string };
          return { hello: name };
        },
      },
    },
    serverInfo: { name: "test-surface", version: "0.0.0" },
    transport: serverTransport,
  });

  const mcp = new Client({ name: "test-client", version: "0.0.0" });
  await mcp.connect(clientTransport);

  return { mcp, served };
}

let cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const c of cleanup) await c();
  cleanup = [];
});

describe("serveSurfaceAsMcp — end to end over the in-memory transport", () => {
  it("tools/list shows only exposed + bespoke tools (default-deny)", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const { tools } = await mcp.listTools();
    const names = tools.map((t) => t.name).sort();

    expect(names).toContain("counter_bump");
    expect(names).toContain("greet");
    // The dangerous procedure is NOT a tool — default-deny proven.
    expect(names).not.toContain("admin_nuke");
    expect(names).toEqual(["counter_bump", "greet"]);
  });

  it("tools/call on an exposed procedure mutates the cell", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const res = await mcp.callTool({ name: "counter_bump", arguments: {} });
    const text = (res.content as Array<{ type: string; text: string }>)[0];
    expect(text?.text).toBe("1");
    expect(res.isError).toBeFalsy();

    // The bump actually moved the cell — a subsequent read reflects it.
    const read = await mcp.readResource({ uri: cellUri("count") });
    const body = (read.contents[0] as { text: string }).text;
    expect(JSON.parse(body)).toBe(1);
  });

  it("a bespoke tool runs against the client", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const res = await mcp.callTool({
      name: "greet",
      arguments: { name: "ada" },
    });
    const text = (res.content as Array<{ type: string; text: string }>)[0];
    expect(JSON.parse(text?.text ?? "null")).toEqual({ hello: "ada" });
  });

  it("resources/list + resources/read return a cell snapshot", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const { resources } = await mcp.listResources();
    const uris = resources.map((r) => r.uri);
    expect(uris).toContain(cellUri("count"));

    const read = await mcp.readResource({ uri: cellUri("count") });
    const body = (read.contents[0] as { text: string }).text;
    expect(JSON.parse(body)).toBe(0);
  });

  it("a snapshot-guaranteed primitive (cell) that opens EMPTY makes resources/read THROW, not collapse to null", async () => {
    // snapshot-then-delta: a cell/collection/collection-item opens with a
    // current-value snapshot frame (`@kolu/surface/server`), so an empty open is a
    // dead/dropped bridge link — NOT an empty value. Coercing it to JSON `null`
    // would hand an MCP agent `surface://cells/<x> => null` as if real (the green-dot
    // lie in MCP form). A REAL `implementSurface` router can't produce this (it
    // always opens with a snapshot), so model the dropped bridge with a stub client
    // whose `count.get` yields no frame. readSnapshot must FAIL, never collapse.
    const surface = defineSurface({
      cells: { count: { schema: z.number(), default: 0 } },
    });
    const droppedBridge = {
      surface: {
        // Ends without yielding — the guaranteed snapshot frame never arrives.
        count: {
          get: async function* () {
            return;
          },
        },
      },
    };
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const served = await serveSurfaceAsMcp({
      surface,
      // biome-ignore lint/suspicious/noExplicitAny: stub client modelling a dropped bridge link.
      client: () => droppedBridge as any,
      expose: { count: "resource" },
      serverInfo: { name: "empty-snapshot-test", version: "0.0.0" },
      transport: serverTransport,
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    await expect(mcp.readResource({ uri: cellUri("count") })).rejects.toThrow(
      /no snapshot frame|link\/protocol failure/,
    );
  });

  it("a STREAM that opens EMPTY also throws — streams are snapshot-first too (StreamHandlerDeps), not empty-to-null", async () => {
    // The reloc-D correction: `StreamHandlerDeps` REQUIRES "first yield is a fresh
    // full snapshot", so a Stream is snapshot-guaranteed exactly like a cell — only
    // an Event has no snapshot obligation. An empty stream open is therefore the
    // SAME dead-link failure, and must throw, not collapse to JSON null.
    const surface = defineSurface({
      streams: { ticks: { inputSchema: z.void(), outputSchema: z.number() } },
    });
    const droppedBridge = {
      surface: {
        ticks: {
          get: async function* () {
            return;
          },
        },
      },
    };
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const served = await serveSurfaceAsMcp({
      surface,
      // biome-ignore lint/suspicious/noExplicitAny: stub client modelling a dropped bridge link.
      client: () => droppedBridge as any,
      expose: { ticks: "resource" },
      serverInfo: { name: "empty-stream-test", version: "0.0.0" },
      transport: serverTransport,
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    await expect(mcp.readResource({ uri: streamUri("ticks") })).rejects.toThrow(
      /no snapshot frame|link\/protocol failure/,
    );
  });

  it("reads a stream resource snapshot (void-input source)", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    // The `ticks` stream's snapshot is the current count (0).
    const read = await mcp.readResource({ uri: streamUri("ticks") });
    const body = (read.contents[0] as { text: string }).text;
    expect(JSON.parse(body)).toBe(0);
  });

  it("resources/subscribe fires notifications/resources/updated on cell change", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const updates: string[] = [];
    mcp.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      updates.push(n.params.uri);
    });

    await mcp.subscribeResource({ uri: cellUri("count") });

    // Drive a change through the exposed procedure — the cell delta should
    // produce an `updated` for the cell URI (debounced, hence waitFor).
    await mcp.callTool({ name: "counter_bump", arguments: {} });

    await vi.waitFor(
      () => {
        expect(updates).toContain(cellUri("count"));
      },
      { timeout: 2000 },
    );
  });

  it("subscribing to an unexposed/unknown resource is rejected", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    await expect(
      mcp.subscribeResource({ uri: "surface://cells/does-not-exist" }),
    ).rejects.toThrow();
  });

  it("tools/list carries read-only / destructive annotations (F7)", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const { tools } = await mcp.listTools();
    const bump = tools.find((t) => t.name === "counter_bump");
    // counter.bump is exposed with `mutates: true`.
    expect(bump?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    // The bespoke `greet` OMITS `mutates`, so it is advertised DESTRUCTIVE
    // (conservative default): an unannotated tool must never read as auto-approvable
    // read-only — `readOnlyHint: true` can let an MCP host auto-execute a write
    // unconfirmed, so an absent `mutates` fails SAFE (assume it mutates), not safe-
    // for-the-tool. A genuinely read-only tool opts in with an explicit
    // `mutates: false` (proven below).
    const greet = tools.find((t) => t.name === "greet");
    expect(greet?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  it("an explicit `mutates: false` opts a tool into the read-only hint (the conservative default's escape)", async () => {
    // The conservative default (absent ⇒ destructive) is only honest if the opt-in
    // works: a tool the author KNOWS is read-only declares `mutates: false` and gets
    // `readOnlyHint: true` — a conscious, reviewable claim, not a silent assumption.
    const surface = defineSurface({
      cells: { count: { schema: z.number(), default: 0 } },
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const served = await serveSurfaceAsMcp({
      surface,
      // `peek` never touches the client and `listTools` doesn't invoke it.
      // biome-ignore lint/suspicious/noExplicitAny: unused stub client (no resource/tool call reaches it).
      client: () => ({ surface: {} }) as any,
      expose: {},
      tools: {
        peek: {
          mutates: false,
          description: "A genuinely read-only tool.",
          handler: () => ({ ok: true }),
        },
      },
      serverInfo: { name: "opt-in-test", version: "0.0.0" },
      transport: serverTransport,
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const { tools } = await mcp.listTools();
    const peek = tools.find((t) => t.name === "peek");
    expect(peek?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
  });
});

// ── A second surface exercising the shape-mismatch fixes ──────────────────

/** A surface with an event (no snapshot), a scalar-input procedure, a
 *  numeric-key collection, and an array-input bespoke tool — the cases the
 *  shape-mismatch findings (F2/F3/F9) covered. */
function buildEdgeSurface() {
  const surface = defineSurface({
    collections: {
      // NON-string key — exercises the item-template key decode (F9).
      rows: { keySchema: z.number(), schema: z.object({ v: z.string() }) },
    },
    events: {
      // No snapshot by contract — `resources/read` must not block (F2).
      pinged: { inputSchema: z.void(), outputSchema: z.number() },
    },
    procedures: {
      echo: {
        // A scalar input — advertised wrapped under `value`, dispatched
        // unwrapped (F3).
        shout: { input: z.string(), output: z.string() },
      },
    },
  });

  const rows = new Map<number, { v: string }>([[42, { v: "answer" }]]);
  const { router } = implementSurface(surface, {
    channel: inMemoryChannelByName(),
    collections: {
      rows: {
        readAll: () => rows,
        upsert: (k, val) => {
          rows.set(k, val);
        },
        remove: (k) => {
          rows.delete(k);
        },
      },
    },
    events: { pinged: {} },
    procedures: {
      echo: {
        shout: ({ input }) => `${input}!`,
      },
    },
  });

  const client = directLink<typeof surface.contract>(router);
  return { surface, client };
}

async function connectEdge(over: ReturnType<typeof buildEdgeSurface>) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  const served = await serveSurfaceAsMcp({
    surface: over.surface,
    client: () => over.client,
    expose: {
      rows: "resource",
      pinged: "resource",
      "echo.shout": "tool",
    },
    tools: {
      // An array-input bespoke tool — also wrapped under `value` (F3).
      sum: {
        input: z.array(z.number()),
        handler: (args) => (args as number[]).reduce((a, b) => a + b, 0),
      },
    },
    serverInfo: { name: "edge-surface", version: "0.0.0" },
    transport: serverTransport,
  });

  const mcp = new Client({ name: "edge-client", version: "0.0.0" });
  await mcp.connect(clientTransport);
  return { mcp, served };
}

describe("serveSurfaceAsMcp — shape-mismatch fixes", () => {
  it("reads an event resource as an immediate null (no snapshot, F2)", async () => {
    const over = buildEdgeSurface();
    const { mcp, served } = await connectEdge(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    // Must return promptly — an event has no snapshot, so this can't await a
    // frame that may never come.
    const read = await mcp.readResource({
      uri: "surface://events/pinged",
    });
    const body = (read.contents[0] as { text: string }).text;
    expect(JSON.parse(body)).toBeNull();
  });

  it("a scalar-input procedure dispatches the unwrapped value (F3)", async () => {
    const over = buildEdgeSurface();
    const { mcp, served } = await connectEdge(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    // The tool's inputSchema wrapped the string under `value`; the host passes
    // `{ value: "hi" }`, and dispatch unwraps it back to the bare string.
    const res = await mcp.callTool({
      name: "echo_shout",
      arguments: { value: "hi" },
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content as Array<{ type: string; text: string }>)[0];
    expect(JSON.parse(text?.text ?? "null")).toBe("hi!");
  });

  it("an array-input bespoke tool dispatches the unwrapped array (F3)", async () => {
    const over = buildEdgeSurface();
    const { mcp, served } = await connectEdge(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const res = await mcp.callTool({
      name: "sum",
      arguments: { value: [1, 2, 3] },
    });
    expect(res.isError).toBeFalsy();
    const text = (res.content as Array<{ type: string; text: string }>)[0];
    expect(JSON.parse(text?.text ?? "null")).toBe(6);
  });

  it("reads a collection item with a NON-string key (F9)", async () => {
    const over = buildEdgeSurface();
    const { mcp, served } = await connectEdge(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    // The URI segment is the string "42"; the adapter decodes it through the
    // collection's `z.number()` key schema before `.get({ key: 42 })`.
    const read = await mcp.readResource({
      uri: "surface://collections/rows/42",
    });
    const body = (read.contents[0] as { text: string }).text;
    expect(JSON.parse(body)).toEqual({ v: "answer" });
  });
});

describe("serveSurfaceAsMcp — boot-time guards", () => {
  it("a bespoke tool colliding with a generated tool name throws (F10)", async () => {
    const over = buildSurface();
    const [, serverTransport] = InMemoryTransport.createLinkedPair();
    await expect(
      serveSurfaceAsMcp({
        surface: over.surface,
        client: () => over.client,
        expose: { "counter.bump": "tool" },
        // `counter_bump` collides with the generated name for counter.bump.
        tools: { counter_bump: { handler: () => "x" } },
        transport: serverTransport,
      }),
    ).rejects.toThrow(
      /tool name "counter_bump" is produced by both procedure counter\.bump and bespoke counter_bump/,
    );
  });

  it("two procedures collapsing to one tool name throws (F10)", async () => {
    const surface = defineSurface({
      procedures: {
        // `a.b_c` and `a_b.c` both collapse to the MCP tool name `a_b_c`.
        a: { b_c: { output: z.boolean() } },
        a_b: { c: { output: z.boolean() } },
      },
    });
    const [, serverTransport] = InMemoryTransport.createLinkedPair();
    await expect(
      serveSurfaceAsMcp({
        surface,
        client: () => ({ surface: {} }) as never,
        expose: { "a.b_c": "tool", "a_b.c": "tool" },
        transport: serverTransport,
      }),
    ).rejects.toThrow(/tool name "a_b_c" is produced by both/);
  });
});

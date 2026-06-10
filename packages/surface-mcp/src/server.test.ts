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
});

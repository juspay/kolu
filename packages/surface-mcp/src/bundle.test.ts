/**
 * The FOURTH SEAM: a rooted bundle served as one MCP endpoint, and the roster
 * moving under it while a host is connected.
 *
 * Driven by a real MCP `Client` over the SDK's in-memory pair, like
 * `server.test.ts` — the composition is only worth anything if it is what a host
 * actually sees. What is proved here:
 *
 *   - the sibling key is a SEGMENT of every name it contributes (URI and tool),
 *     and the core keeps its bare ones;
 *   - two siblings exposing the same member key are disjoint by construction;
 *   - a call resolves through the sibling's own client, and a sibling's bespoke
 *     tool is handed that client while a bundle-root one is handed the bundle;
 *   - every refusal the composition owes is made at boot AND on every reroster;
 *   - a roster move keeps the survivors' subscriptions, ends the departed ones,
 *     tells the host both lists changed, and refuses a departed name BY NAME.
 */

import {
  buildSurfaceFace,
  type RootedSurfaceClients,
  type SurfaceClientCallable,
} from "@kolu/surface/client";
import type { Surface, SurfaceSpec } from "@kolu/surface/define";
import { defineSurface } from "@kolu/surface/define";
import { directDispatch } from "@kolu/surface/links/direct";
import type { SurfaceHandlers } from "@kolu/surface/server";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBundle } from "./bundle";
import { serveSurfaceAsMcp } from "./server";

// ── Two tiny surfaces, and clients over them ─────────────────────────────

/** The CORE: one cell, one bare procedure. */
const coreSurface = defineSurface({
  cells: { banner: { schema: Schema.String, default: "core" } },
  procedures: { who: { get: { output: Schema.String } } },
});

/** A SIBLING shape, used for both siblings so the test proves DISJOINTNESS
 *  rather than difference: the two expose the same member keys, and the whole
 *  question is whether their names collide. */
const tenantSurface = defineSurface({
  cells: { entries: { schema: Schema.Finite, default: 0 } },
  collections: {
    rows: { keySchema: Schema.String, schema: Schema.String },
  },
  procedures: { ops: { run: { output: Schema.String } } },
});

function faceFor<S extends SurfaceSpec>(
  surface: Surface<S>,
  served: { handlers: SurfaceHandlers },
): SurfaceClientCallable {
  return buildSurfaceFace(
    surface,
    directDispatch(served),
  ) as unknown as SurfaceClientCallable;
}

function coreClient(): SurfaceClientCallable {
  return faceFor(
    coreSurface,
    implementSurface(coreSurface, {
      cells: { banner: { store: inMemoryStore("core") } },
      procedures: { who: { get: () => Effect.succeed("core") } },
    }),
  );
}

/** One tenant's client, whose `ops.run` answers with its own name — so a call
 *  that resolved through the WRONG sibling's client is visible in the answer
 *  rather than merely plausible. */
function tenantClient(name: string): SurfaceClientCallable {
  const rows = new Map<string, string>([[`${name}-row`, name]]);
  return faceFor(
    tenantSurface,
    implementSurface(tenantSurface, {
      cells: { entries: { store: inMemoryStore(rows.size) } },
      collections: {
        rows: {
          readAll: () => rows,
          upsert: (k, v) => {
            rows.set(k, v);
          },
          remove: (k) => {
            rows.delete(k);
          },
        },
      },
      procedures: { ops: { run: () => Effect.succeed(name) } },
    }),
  );
}

const cleanup: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

/** Stand a bundle up behind a connected MCP client. `clients` is what the
 *  factory hands back, and it is a THUNK so a case can move it between dials —
 *  which is exactly what a host does across a reroster. */
async function connectBundle(opts: {
  core?: { surface: Surface<SurfaceSpec>; expose: Record<string, unknown> };
  surfaces?: Record<string, unknown>;
  tools?: Record<string, unknown>;
  bundle: () => RootedSurfaceClients;
}) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const served = await serveSurfaceAsMcp({
    // biome-ignore lint/suspicious/noExplicitAny: the harness passes erased bundles on purpose — the per-entry typing is proved at the call sites in the product, not here.
    ...(opts as any),
    client: opts.bundle,
    serverInfo: { name: "bundle-test", version: "0.0.0" },
    transport: serverTransport,
  });
  const mcp = new Client({ name: "c", version: "0" });
  await mcp.connect(clientTransport);
  cleanup.push(
    () => mcp.close(),
    () => served.close(),
  );
  return { mcp, served };
}

// ── Composition ──────────────────────────────────────────────────────────

describe("a rooted bundle composes by PREFIX", () => {
  it("gives every sibling name a segment and leaves the core's bare", async () => {
    const { mcp } = await connectBundle({
      core: { surface: coreSurface, expose: { banner: "resource" } },
      surfaces: {
        a: { surface: tenantSurface, expose: { rows: "resource" } },
        b: { surface: tenantSurface, expose: { rows: "resource" } },
      },
      bundle: () => ({
        core: coreClient(),
        clients: { a: tenantClient("a"), b: tenantClient("b") },
      }),
    });

    const { resources } = await mcp.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      "surface://cells/banner",
      "surface://collections/a/rows",
      "surface://collections/b/rows",
    ]);
    // A resource NAME is display text, and two siblings exposing `rows` must not
    // offer a host two rows reading `rows` with nothing to tell them apart.
    expect(resources.map((r) => r.name).sort()).toEqual([
      "a/rows",
      "b/rows",
      "banner",
    ]);

    const { resourceTemplates } = await mcp.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual([
      "surface://collections/a/rows/{id}",
      "surface://collections/b/rows/{id}",
    ]);
  });

  it("prefixes a sibling's tools and not the core's", async () => {
    const { mcp } = await connectBundle({
      core: { surface: coreSurface, expose: { "who.get": "tool" } },
      surfaces: {
        a: { surface: tenantSurface, expose: { "ops.run": "tool" } },
        b: { surface: tenantSurface, expose: { "ops.run": "tool" } },
      },
      bundle: () => ({
        core: coreClient(),
        clients: { a: tenantClient("a"), b: tenantClient("b") },
      }),
    });
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "a_ops_run",
      "b_ops_run",
      "who_get",
    ]);
  });

  it("resolves a call through the SIBLING's own client, not the core's", async () => {
    const { mcp } = await connectBundle({
      core: { surface: coreSurface, expose: { "who.get": "tool" } },
      surfaces: {
        a: { surface: tenantSurface, expose: { "ops.run": "tool" } },
        b: { surface: tenantSurface, expose: { "ops.run": "tool" } },
      },
      bundle: () => ({
        core: coreClient(),
        clients: { a: tenantClient("a"), b: tenantClient("b") },
      }),
    });
    for (const [name, expected] of [
      ["a_ops_run", "a"],
      ["b_ops_run", "b"],
      ["who_get", "core"],
    ] as const) {
      const res = await mcp.callTool({ name, arguments: {} });
      expect(res.isError).toBeFalsy();
      const text = (res.content as Array<{ text: string }>)[0]?.text ?? "null";
      expect(JSON.parse(text)).toBe(expected);
    }
  });

  it("reads a sibling's resource through that sibling's client", async () => {
    const { mcp } = await connectBundle({
      surfaces: {
        a: { surface: tenantSurface, expose: { rows: "resource" } },
      },
      bundle: () => ({ clients: { a: tenantClient("a") } }),
    });
    const read = await mcp.readResource({
      uri: "surface://collections/a/rows",
    });
    const body = (read.contents[0] as { text: string }).text;
    expect(JSON.parse(body)).toEqual(["a-row"]);

    const item = await mcp.readResource({
      uri: "surface://collections/a/rows/a-row",
    });
    expect(JSON.parse((item.contents[0] as { text: string }).text)).toBe("a");
  });
});

// ── Bespoke tables ───────────────────────────────────────────────────────

describe("a bespoke tool is handed the client of the thing it is declared on", () => {
  it("gives a bundle-root tool the bundle and a sibling's tool that sibling's client", async () => {
    const { mcp } = await connectBundle({
      core: { surface: coreSurface, expose: {} },
      surfaces: {
        a: {
          surface: tenantSurface,
          expose: {},
          tools: {
            here: {
              description: "which client did I get?",
              handler: (_args: unknown, client: unknown) =>
                Effect.succeed(
                  (client as SurfaceClientCallable).surface.ops === undefined
                    ? "not-a-surface-client"
                    : "sibling-client",
                ),
            },
          },
        },
      },
      tools: {
        everywhere: {
          description: "which client did I get?",
          handler: (_args: unknown, client: unknown) =>
            Effect.succeed(Object.keys(client as RootedSurfaceClients).sort()),
        },
      },
      bundle: () => ({
        core: coreClient(),
        clients: { a: tenantClient("a") },
      }),
    });

    const { tools } = await mcp.listTools();
    // The sibling's verb LEAVES WITH IT, so it is named with it.
    expect(tools.map((t) => t.name).sort()).toEqual(["a_here", "everywhere"]);

    const sibling = await mcp.callTool({ name: "a_here", arguments: {} });
    expect(
      JSON.parse((sibling.content as Array<{ text: string }>)[0]?.text ?? ""),
    ).toBe("sibling-client");

    const root = await mcp.callTool({ name: "everywhere", arguments: {} });
    expect(
      JSON.parse((root.content as Array<{ text: string }>)[0]?.text ?? ""),
    ).toEqual(["clients", "core"]);
  });
});

// ── The refusals the composition owes ────────────────────────────────────

describe("the composition refuses at BOOT", () => {
  const bundleOf = (bundle: Parameters<typeof resolveBundle>[0]) => () =>
    resolveBundle(bundle);

  it("refuses a bundle with no core and no siblings", () => {
    expect(bundleOf({})).toThrow(/not a bundle/);
  });

  it("refuses a sibling key that shadows a core collection's item space", () => {
    // `surface://collections/a/{id}` is the core collection's items AND the
    // sibling `a`'s whole address space. Two readings of one URI is not
    // something a lookup order can fix honestly.
    const withCollection = defineSurface({
      collections: {
        a: { keySchema: Schema.String, schema: Schema.String },
      },
    });
    expect(
      bundleOf({
        core: { surface: withCollection, expose: { a: "resource" } },
        surfaces: { a: { surface: tenantSurface, expose: {} } },
      }),
    ).toThrow(/same address space as the sibling/);
  });

  it("refuses two tools that collapse to one name across scopes", () => {
    // Prefixing does not make the uniqueness pass redundant: a bundle-root
    // `a_here` and a sibling `a`'s `here` mint one name from two places.
    expect(
      bundleOf({
        surfaces: {
          a: {
            surface: tenantSurface,
            expose: {},
            tools: { here: { handler: () => Effect.succeed(1) } },
          },
        },
        tools: { a_here: { handler: () => Effect.succeed(1) } },
      }),
    ).toThrow(/produced by both/);
  });

  it("checks each sibling's expose map against ITS OWN spec", () => {
    expect(
      bundleOf({
        surfaces: {
          a: { surface: tenantSurface, expose: { nope: "resource" } },
        },
      }),
    ).toThrow(/nope/);
  });
});

// ── The roster moves ─────────────────────────────────────────────────────

describe("the roster follows in place", () => {
  /** A bundle whose sibling set the TEST moves, exactly as a host's would: the
   *  factory reads a cell rather than closing over one roster. */
  function movingBundle() {
    let roster: Record<string, SurfaceClientCallable> = {
      a: tenantClient("a"),
      b: tenantClient("b"),
    };
    return {
      set: (next: Record<string, SurfaceClientCallable>) => {
        roster = next;
      },
      read: (): RootedSurfaceClients => ({
        core: coreClient(),
        clients: roster,
      }),
    };
  }

  const sibling = (surface: Surface<SurfaceSpec>) => ({
    surface,
    expose: { rows: "resource", "ops.run": "tool" },
  });

  it("advertises listChanged so a host has reason to re-read", async () => {
    const { mcp } = await connectBundle({
      core: { surface: coreSurface, expose: {} },
      bundle: () => ({ core: coreClient() }),
    });
    expect(mcp.getServerCapabilities()).toMatchObject({
      tools: { listChanged: true },
      resources: { subscribe: true, listChanged: true },
    });
  });

  it("replaces the lists, notifies both, and keeps the survivor working", async () => {
    const moving = movingBundle();
    const { mcp, served } = await connectBundle({
      core: { surface: coreSurface, expose: { "who.get": "tool" } },
      surfaces: {
        a: sibling(tenantSurface),
        b: sibling(tenantSurface),
      },
      bundle: moving.read,
    });
    const toolsChanged = vi.fn();
    const resourcesChanged = vi.fn();
    mcp.setNotificationHandler(ToolListChangedNotificationSchema, toolsChanged);
    mcp.setNotificationHandler(
      ResourceListChangedNotificationSchema,
      resourcesChanged,
    );

    moving.set({ a: tenantClient("a") });
    await served.reroster({ a: sibling(tenantSurface) });
    await vi.waitFor(() => {
      expect(toolsChanged).toHaveBeenCalled();
      expect(resourcesChanged).toHaveBeenCalled();
    });

    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["a_ops_run", "who_get"]);
    const { resources } = await mcp.listResources();
    expect(resources.map((r) => r.uri)).toEqual([
      "surface://collections/a/rows",
    ]);

    // The survivor still answers, through the freshly dialled bundle.
    const res = await mcp.callTool({ name: "a_ops_run", arguments: {} });
    expect(
      JSON.parse((res.content as Array<{ text: string }>)[0]?.text ?? ""),
    ).toBe("a");
  });

  it("refuses a DEPARTED sibling's tool and URI by name", async () => {
    const moving = movingBundle();
    const { mcp, served } = await connectBundle({
      core: { surface: coreSurface, expose: {} },
      surfaces: { a: sibling(tenantSurface), b: sibling(tenantSurface) },
      bundle: moving.read,
    });
    moving.set({ a: tenantClient("a") });
    await served.reroster({ a: sibling(tenantSurface) });

    const gone = await mcp.callTool({ name: "b_ops_run", arguments: {} });
    expect(gone.isError).toBe(true);
    const text = (gone.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(text).toContain('"b"');
    expect(text).toContain("dropped from this rooted bundle");

    await expect(
      mcp.readResource({ uri: "surface://collections/b/rows" }),
    ).rejects.toThrow(/dropped from this rooted bundle/);

    // …while a name that was never real still reads as unknown, which is a
    // different fact and a different next move for the caller.
    const never = await mcp.callTool({ name: "z_ops_run", arguments: {} });
    expect((never.content as Array<{ text: string }>)[0]?.text).toContain(
      "unknown tool",
    );
  });

  it("ends a subscription the new roster cannot serve, and keeps the rest", async () => {
    const moving = movingBundle();
    const { mcp, served } = await connectBundle({
      core: { surface: coreSurface, expose: {} },
      surfaces: { a: sibling(tenantSurface), b: sibling(tenantSurface) },
      bundle: moving.read,
    });
    await mcp.subscribeResource({ uri: "surface://collections/a/rows" });
    await mcp.subscribeResource({ uri: "surface://collections/b/rows" });

    moving.set({ a: tenantClient("a") });
    await served.reroster({ a: sibling(tenantSurface) });

    // The departed URI is no longer subscribable at all — the adapter dropped
    // the standing subscription, and a fresh one is refused with the same
    // sentence the tool call gets.
    await expect(
      mcp.subscribeResource({ uri: "surface://collections/b/rows" }),
    ).rejects.toThrow(/dropped from this rooted bundle/);
    // The survivor's is still accepted.
    await expect(
      mcp.subscribeResource({ uri: "surface://collections/a/rows" }),
    ).resolves.toBeDefined();
  });

  it("refuses a roster the composition would refuse at boot, leaving the old one standing", async () => {
    const moving = movingBundle();
    const { mcp, served } = await connectBundle({
      core: { surface: coreSurface, expose: {} },
      surfaces: { a: sibling(tenantSurface) },
      bundle: moving.read,
    });
    await expect(
      served.reroster({
        a: { surface: tenantSurface, expose: { nope: "resource" } },
      }),
    ).rejects.toThrow(/nope/);
    // Nothing moved: the endpoint is still serving the roster it was serving.
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name)).toEqual(["a_ops_run"]);
  });
});

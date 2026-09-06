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
import type { ExposeMap } from "@kolu/surface/expose";
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

describe("a bespoke tool takes its sibling's segment and gets its own client", () => {
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
    // ONE RULE for every name a sibling contributes: its hand-authored `here`
    // takes the segment exactly as a generated name would. Only the bundle-root
    // table is bare, having no row to be relative to.
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

  it("refuses a BARE bundle-root name that collides with a scoped one", () => {
    // Prefixing does not make the pass redundant: the bundle-root table is bare
    // and shares one space with every scoped name, so `a_here` at the root and
    // `here` on sibling `a` mint one name from two places. Only a pass over the
    // finished names can see it, and the report names both claimants.
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
    ).toThrow(
      /"a_here" is produced by both bespoke a_here and bespoke here on sibling "a"/,
    );
  });

  it("refuses an authored name that collides with a DERIVED one", () => {
    // The two kinds of name are ONE space. A sibling `a` exposing `ops.run`
    // derives `a_ops_run`, so a bundle-root verb spelled that way is refused —
    // and the report names a procedure on one side and a bespoke table on the
    // other.
    expect(
      bundleOf({
        surfaces: {
          a: { surface: tenantSurface, expose: { "ops.run": "tool" } },
        },
        tools: { a_ops_run: { handler: () => Effect.succeed(1) } },
      }),
    ).toThrow(/procedure ops\.run on sibling "a" and bespoke a_ops_run/);

    // …while two siblings that authored the SAME word do not collide at all:
    // each takes its own segment, which is the collision the prefix prevents.
    const twin = (name: string) => ({
      surface: tenantSurface,
      expose: {},
      tools: { [name]: { handler: () => Effect.succeed(1) } },
    });
    expect(
      bundleOf({ surfaces: { a: twin("read"), b: twin("read") } }),
    ).not.toThrow();
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

  /** The same sibling, plus one HAND-AUTHORED verb — served as `<key>_<name>`,
   *  the same segment its generated names take. */
  const siblingWithVerb = (surface: Surface<SurfaceSpec>, name: string) => ({
    ...sibling(surface),
    tools: { [name]: { handler: () => Effect.succeed(name) } },
  });

  it("a tombstone survives redundant rerosters and later departures", async () => {
    // The field sequence from juspay/olai#546, verbatim: boot with the rows, six
    // rerosters IDENTICAL to boot, the flip where rows leave, two further
    // departures, then the call. This shape always worked — it is here because it
    // is what was reported, and pinning it is what proved the report's sequence
    // was not the whole story (the row that unloads in two steps is; see the
    // REGRESSION case below).
    const moving = movingBundle();
    const rows = (keys: readonly string[]) =>
      Object.fromEntries(
        keys.map((k) => [
          k,
          k === "outlines"
            ? siblingWithVerb(tenantSurface, "title")
            : sibling(tenantSurface),
        ]),
      );
    const clientsFor = (keys: readonly string[]) =>
      Object.fromEntries(keys.map((k) => [k, tenantClient(k)]));

    const BOOT = ["outlines", "markdown", "chat", "vaultplugins"];
    moving.set(clientsFor(BOOT));
    const { mcp, served } = await connectBundle({
      core: { surface: coreSurface, expose: { "who.get": "tool" } },
      surfaces: rows(BOOT),
      bundle: moving.read,
    });
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name)).toContain("outlines_title");

    // #1–#6: identical to boot, redundant but they happened.
    for (let i = 0; i < 6; i += 1) await served.reroster(rows(BOOT));
    // #7: outlines (and markdown) leave.
    moving.set(clientsFor(["chat", "vaultplugins"]));
    await served.reroster(rows(["chat", "vaultplugins"]));
    // #8 identical, #9 drops vaultplugins, #10 empties the sibling map.
    await served.reroster(rows(["chat", "vaultplugins"]));
    moving.set(clientsFor(["chat"]));
    await served.reroster(rows(["chat"]));
    moving.set({});
    await served.reroster({});

    const res = await mcp.callTool({ name: "outlines_title", arguments: {} });
    expect(res.isError).toBe(true);
    expect((res.content as Array<{ text: string }>)[0]?.text ?? "").toContain(
      'the sibling "outlines" was dropped',
    );
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

  it("refuses a DEPARTED sibling's tool and URI by name — ownership recorded, not parsed", async () => {
    const moving = movingBundle();
    const { mcp, served } = await connectBundle({
      core: { surface: coreSurface, expose: {} },
      surfaces: {
        a: sibling(tenantSurface),
        b: siblingWithVerb(tenantSurface, "publish"),
      },
      bundle: moving.read,
    });
    moving.set({ a: tenantClient("a") });
    await served.reroster({ a: sibling(tenantSurface) });

    const said = async (name: string) => {
      const res = await mcp.callTool({ name, arguments: {} });
      expect(res.isError).toBe(true);
      return (res.content as Array<{ text: string }>)[0]?.text ?? "";
    };

    // Both kinds of name, derived and hand-authored, refused by the sibling that
    // owned them — read off the retired entry rather than out of the name.
    expect(await said("b_ops_run")).toContain(
      'the sibling "b" was dropped from this rooted bundle',
    );
    expect(await said("b_publish")).toContain(
      'the sibling "b" was dropped from this rooted bundle',
    );

    await expect(
      mcp.readResource({ uri: "surface://collections/b/rows" }),
    ).rejects.toThrow(/dropped from this rooted bundle/);
    // A departed collection's ITEM too, which is never a listed resource — it is
    // answered through its collection's address.
    await expect(
      mcp.readResource({ uri: "surface://collections/b/rows/b-row" }),
    ).rejects.toThrow(/dropped from this rooted bundle/);

    // …while a name that was never real still reads as unknown, which is a
    // different fact and a different next move for the caller.
    expect(await said("z_ops_run")).toContain("unknown tool");
    // Including one that merely BEGINS with a departed key's word — which is why
    // ownership is RECORDED and not parsed even though every scoped name carries
    // the segment. `_` is legal inside a segment, so a leading `<key>_` was never
    // a sound reading: parsing it reported this as "no longer served" by a bundle
    // that never served it.
    expect(await said("b_typo")).toContain("unknown tool");
  });

  it("REGRESSION juspay/olai#546: a present-but-empty row does not erase its tombstones", async () => {
    // The minimal sequence the property search reduced the field report to. A row
    // that unloads in TWO steps — members, then zero members, then gone — used to
    // lose every name it had ever served: the middle move recorded the tombstone
    // and then deleted it (the sibling was still standing), and the last move had
    // nothing left to record from. The name answered "unknown tool" forever,
    // minutes after an agent had seen it in a `tools/list`.
    const moving = movingBundle();
    const { mcp, served } = await connectBundle({
      core: { surface: coreSurface, expose: {} },
      surfaces: { a: siblingWithVerb(tenantSurface, "title") },
      bundle: () => ({ core: coreClient(), clients: moving.read().clients }),
    });
    moving.set({ a: tenantClient("a") });
    expect((await mcp.listTools()).tools.map((t) => t.name)).toContain(
      "a_title",
    );

    // Still present, now exposing nothing — a plugin on its way out.
    await served.reroster({ a: { surface: tenantSurface, expose: {} } });
    const midway = await mcp.callTool({ name: "a_title", arguments: {} });
    expect(
      (midway.content as Array<{ text: string }>)[0]?.text ?? "",
    ).toContain('the sibling "a" no longer exposes it');

    // …and now gone. The tombstone survives BOTH moves, and the sentence follows
    // the sibling rather than being frozen at the moment of the first one.
    moving.set({});
    await served.reroster({});
    const gone = await mcp.callTool({ name: "a_title", arguments: {} });
    expect(gone.isError).toBe(true);
    expect((gone.content as Array<{ text: string }>)[0]?.text ?? "").toContain(
      'the sibling "a" was dropped from this rooted bundle',
    );
  });

  it("says which retirement it was — dropped, or standing and no longer exposing", async () => {
    const moving = movingBundle();
    const { mcp, served } = await connectBundle({
      core: { surface: coreSurface, expose: {} },
      surfaces: { a: sibling(tenantSurface), b: sibling(tenantSurface) },
      bundle: moving.read,
    });
    moving.set({ a: tenantClient("a") });
    await served.reroster({ a: sibling(tenantSurface) });
    // `b` returns, exposing LESS than it did: `rows` is served by nobody now, and
    // "dropped with its sibling" would be false — the sibling is standing right
    // there. The tombstone is KEPT and the sentence changes, rather than the fact
    // being deleted to avoid saying a wrong one.
    moving.set({ a: tenantClient("a"), b: tenantClient("b") });
    await served.reroster({
      a: sibling(tenantSurface),
      b: { surface: tenantSurface, expose: { "ops.run": "tool" } },
    });

    const back = await mcp.callTool({ name: "b_ops_run", arguments: {} });
    expect(back.isError).toBeFalsy();
    await expect(
      mcp.readResource({ uri: "surface://collections/b/rows" }),
    ).rejects.toThrow(/the sibling "b" no longer exposes it/);
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

  it("fails LOUDLY when the re-dialled bundle is a leg short of the roster", async () => {
    // The host's factory is re-invoked on every move, and one that has not caught
    // up hands back a bundle missing a surface the tables still serve. That is a
    // wiring fact with a name, not an unaddressable URI: a read of it used to
    // answer "unknown resource" (false — the resource is known) and a standing
    // subscription on it used to be dropped without a word, going permanently
    // quiet under a host that still believed it was subscribed.
    const moving = movingBundle();
    const { mcp, served } = await connectBundle({
      core: { surface: coreSurface, expose: {} },
      surfaces: { a: sibling(tenantSurface), b: sibling(tenantSurface) },
      bundle: moving.read,
    });
    await mcp.subscribeResource({ uri: "surface://collections/a/rows" });

    // `b` leaves; `a` stays in the ROSTER but the factory forgets its client.
    moving.set({});
    await served.reroster({ a: sibling(tenantSurface) });

    await expect(
      mcp.readResource({ uri: "surface://collections/a/rows" }),
    ).rejects.toThrow(/carries no sibling "a"'s client/);
    // …and it is told apart from the two answers it used to be confused with.
    await expect(
      mcp.readResource({ uri: "surface://collections/a/rows" }),
    ).rejects.not.toThrow(/unknown resource/);

    // And the subscription is still the host's: the adapter retired only what the
    // new roster cannot serve, and `a` is served — it is the CONNECTION that is
    // short. So the address stays subscribable, and the stream's failure travels
    // the pusher's own recovery path (reported, detached, retried) rather than
    // being dropped where nobody would hear it.
    await expect(
      mcp.subscribeResource({ uri: "surface://collections/a/rows" }),
    ).resolves.toBeDefined();
  });

  it("fails LOUDLY when the dialled leg's FACE is narrower than the roster", async () => {
    // The neighbouring arm of the same fact, and the one that was still silent
    // after the missing-leg one was fixed: the leg is THERE and answers, it is
    // just answering for a surface that has no such member (a client built over
    // an older or narrower spec than the roster being served). A read of it
    // reported "unknown resource" — false, the resource is known — and a standing
    // subscription on it was dropped without a word, because the pusher takes an
    // unresolvable URI to mean "nothing to stream".
    const { mcp } = await connectBundle({
      core: { surface: coreSurface, expose: {} },
      surfaces: { a: sibling(tenantSurface) },
      // `a`'s client is built over the CORE's surface: it has no `rows` at all.
      bundle: () => ({ core: coreClient(), clients: { a: coreClient() } }),
    });

    await expect(
      mcp.readResource({ uri: "surface://collections/a/rows" }),
    ).rejects.toThrow(/face has no "rows\.keys"/);
    await expect(
      mcp.readResource({ uri: "surface://collections/a/rows" }),
    ).rejects.not.toThrow(/unknown resource/);
    // Still a SERVED address, so the subscription is accepted and the stream's
    // failure travels the pusher's own recovery path (reported, detached,
    // retried) instead of going permanently, silently quiet.
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
        a: {
          surface: tenantSurface,
          // The TYPE catches this first: `reroster` is method-generic, exactly as
          // the boot door is, so a member the sibling's spec does not declare is
          // a compile error where an author writes it. The cast is deliberate —
          // what this case pins is the RUNTIME refusal underneath, which is what
          // an erased map or a JavaScript caller still meets, and which is what
          // makes a roster move re-run the boot composition instead of trusting
          // its argument.
          expose: { nope: "resource" } as ExposeMap<SurfaceSpec>,
        },
      }),
    ).rejects.toThrow(/nope/);
    // Nothing moved: the endpoint is still serving the roster it was serving.
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name)).toEqual(["a_ops_run"]);
  });
});

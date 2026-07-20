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
import { deadTransportError } from "@kolu/surface/client";
import { directLink } from "@kolu/surface/links/direct";
import {
  implementSurface,
  inMemoryChannel,
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

  const client = directLink<typeof surface.contract>(router as never);
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
      explode: {
        description: "Always rejects — pins the isError framing.",
        handler: async () => {
          throw new Error("boom: the handler rejected");
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
    expect(names).toEqual(["counter_bump", "explode", "greet"]);
  });

  it("a REJECTING handler returns an isError tool result, never a protocol error", async () => {
    // Regression pin: `return withClient(...)` inside the dispatch try/catch
    // did NOT await, so a rejection bypassed `failFrom` and reached the host
    // as a JSON-RPC -32603 (the SDK client then THROWS instead of handing the
    // agent a typed, retryable tool failure).
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const res = await mcp.callTool({ name: "explode", arguments: {} });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0]?.text).toContain(
      "boom: the handler rejected",
    );
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

  const client = directLink<typeof surface.contract>(router as never);
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

  it("reading an ABSENT collection item returns not-found promptly, never hangs", async () => {
    const over = buildEdgeSurface();
    const { mcp, served } = await connectEdge(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    // The collection `get` now HOLDS OPEN for a not-yet-born key (the #1681 fix),
    // so a one-shot read must resolve membership from `keys` first and report the
    // absent key as not-found instead of awaiting a `get` frame that never comes.
    // A 2s race guards against a regression back to the indefinite hang.
    const read = mcp.readResource({ uri: "surface://collections/rows/99" });
    const outcome = await Promise.race([
      read.then(
        () => ({ kind: "resolved", message: "" }),
        (e: unknown) => ({
          kind: "rejected",
          message: e instanceof Error ? e.message : String(e),
        }),
      ),
      new Promise<{ kind: string; message: string }>((r) =>
        setTimeout(() => r({ kind: "timeout", message: "" }), 2000),
      ),
    ]);
    expect(outcome.kind).toBe("rejected");
    // A well-formed but not-yet-present key reads as "no value yet", NOT the
    // generic "unknown resource" a malformed/unaddressable URI gets — the two
    // absence causes must not collapse to one message.
    expect(outcome.message).toMatch(/no value yet|not present/i);
  });

  it("a collection item DELETED before the read returns not-found promptly (delete race)", async () => {
    const over = buildEdgeSurface();
    const { mcp, served } = await connectEdge(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    // 42 exists at boot; reading it returns its value.
    const present = await mcp.readResource({
      uri: "surface://collections/rows/42",
    });
    expect(JSON.parse((present.contents[0] as { text: string }).text)).toEqual({
      v: "answer",
    });

    // Remove it — AWAIT the delete so the removal is applied and published
    // BEFORE the read subscribes; otherwise the ordering is unpinned and the read
    // could race a still-present 42 (a resolved value), never exercising the
    // delete case this test names. With the delete settled, the read's `keys`
    // snapshot omits 42. Because the item `get` HOLDS OPEN for an absent key, a
    // read that relied on `get` alone would hang forever here; the bounded read
    // resolves not-found from the `keys`-absence watch instead — so a regression
    // back to the hang trips the 2s timeout and fails this test.
    await over.client.surface.rows.delete({ key: 42 });
    const read = mcp.readResource({ uri: "surface://collections/rows/42" });
    const outcome = await Promise.race([
      read.then(
        () => ({ kind: "resolved", message: "" }),
        (e: unknown) => ({
          kind: "rejected",
          message: e instanceof Error ? e.message : String(e),
        }),
      ),
      new Promise<{ kind: string; message: string }>((r) =>
        setTimeout(() => r({ kind: "timeout", message: "" }), 2000),
      ),
    ]);
    expect(outcome.kind).toBe("rejected");
    expect(outcome.message).toMatch(/no value yet|not present/i);
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

  // The shared-connection lifecycle under CONCURRENT tool calls — the kolu-mcp
  // case, where a long-blocking wait_* holds the one connection while a sibling
  // read runs. Regression pins for the a-f-p C6 findings (double-dial leak +
  // reset-on-any-throw disposing a socket concurrent tools still use).
  function concurrencySurface() {
    const surface = defineSurface({
      procedures: {
        ok: { ping: { output: z.string() } },
        bad: { boom: { output: z.string() } },
      },
    });
    const { router } = implementSurface(surface, {
      procedures: {
        ok: { ping: () => "pong" },
        // An APPLICATION error (not a transport death) — the reset must NOT fire.
        bad: {
          boom: () => {
            throw new Error("bad arg: application-level failure");
          },
        },
      },
    });
    const client = directLink<typeof surface.contract>(router as never);
    return { surface, client };
  }

  it("app-level tool errors do NOT dispose the shared connection; a transport death does", async () => {
    const over = concurrencySurface();
    let dials = 0;
    let disposes = 0;
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveSurfaceAsMcp({
      surface: over.surface,
      client: () => {
        dials += 1;
        return {
          client: over.client,
          dispose: () => {
            disposes += 1;
          },
        };
      },
      expose: {
        "ok.ping": { tool: { mutates: false } },
        "bad.boom": { tool: { mutates: false } },
      },
      // A bespoke tool that rejects with a recognized TRANSPORT death — the one
      // shape that SHOULD reset the shared connection.
      tools: {
        drop: {
          description: "simulate a transport death",
          handler: async () => {
            throw deadTransportError(
              "SURFACE_STDIO_TRANSPORT_CLOSED",
              "pipe closed",
            );
          },
        },
      },
      serverInfo: { name: "t", version: "0" },
      transport: serverTransport,
    });
    const mcp = new Client({ name: "c", version: "0" });
    await mcp.connect(clientTransport);
    cleanup.push(
      () => mcp.close(),
      () => close(),
    );

    // First real call dials once.
    await mcp.callTool({ name: "ok_ping", arguments: {} });
    expect(dials).toBe(1);
    expect(disposes).toBe(0);

    // An APP error must not dispose the shared socket — a following call reuses
    // the SAME connection (no re-dial), proving a concurrent tool would keep it.
    const bad = await mcp.callTool({ name: "bad_boom", arguments: {} });
    expect(bad.isError).toBe(true);
    expect(disposes).toBe(0);
    await mcp.callTool({ name: "ok_ping", arguments: {} });
    expect(dials).toBe(1); // still the first connection

    // A TRANSPORT death resets: the next call re-dials a fresh connection.
    const drop = await mcp.callTool({ name: "drop", arguments: {} });
    expect(drop.isError).toBe(true);
    expect(disposes).toBe(1);
    await mcp.callTool({ name: "ok_ping", arguments: {} });
    expect(dials).toBe(2);
  });

  it("concurrent first calls share ONE dial (no double-dial leak)", async () => {
    const over = concurrencySurface();
    let dials = 0;
    let disposes = 0;
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveSurfaceAsMcp({
      surface: over.surface,
      client: async () => {
        dials += 1;
        // A dial that takes a tick — both concurrent callers await it before
        // either resolves, so a check-then-act getClient would open two sockets.
        await new Promise((r) => setTimeout(r, 10));
        return {
          client: over.client,
          dispose: () => {
            disposes += 1;
          },
        };
      },
      expose: { "ok.ping": { tool: { mutates: false } } },
      serverInfo: { name: "t", version: "0" },
      transport: serverTransport,
    });
    const mcp = new Client({ name: "c", version: "0" });
    await mcp.connect(clientTransport);
    cleanup.push(
      () => mcp.close(),
      () => close(),
    );

    await Promise.all([
      mcp.callTool({ name: "ok_ping", arguments: {} }),
      mcp.callTool({ name: "ok_ping", arguments: {} }),
    ]);
    expect(dials).toBe(1);
    expect(disposes).toBe(0); // no leaked loser connection
  });

  it("close() during a pending dial disposes the connection that lands after it (no orphan)", async () => {
    // The memoized dial resolves AFTER close() — disposeSharedConn saw null, so
    // the connection would orphan without the closed-latch that disposes a
    // late-landing dial (codex F3).
    const over = concurrencySurface();
    let disposes = 0;
    let releaseDial: (() => void) | undefined;
    const dialGate = new Promise<void>((r) => {
      releaseDial = r;
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const { close } = await serveSurfaceAsMcp({
      surface: over.surface,
      client: async () => {
        await dialGate; // hold the dial open until we release it
        return {
          client: over.client,
          dispose: () => {
            disposes += 1;
          },
        };
      },
      expose: { "ok.ping": { tool: { mutates: false } } },
      serverInfo: { name: "t", version: "0" },
      transport: serverTransport,
    });
    const mcp = new Client({ name: "c", version: "0" });
    await mcp.connect(clientTransport);

    // Start a call so getConn's dial is in flight, then close before it lands.
    const inflight = mcp
      .callTool({ name: "ok_ping", arguments: {} })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 5));
    await close(); // sharedConn is still null (dial pending)
    releaseDial?.(); // the dial resolves AFTER close
    await inflight;
    await new Promise((r) => setTimeout(r, 5));

    // The late-landing connection was disposed exactly once — not orphaned.
    expect(disposes).toBe(1);
    await mcp.close();
  });
});

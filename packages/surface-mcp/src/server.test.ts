/**
 * End-to-end: a real `@kolu/surface` re-exposed as MCP, driven by a real MCP
 * `Client` over the SDK's in-memory transport pair. The load-bearing test —
 * it proves the whole spine wires correctly and, crucially, that the
 * curation gate is **default-deny**.
 *
 * The surface has a `count` cell, a `ticks` stream, and two procedures: a
 * safe `bump` (exposed as a tool) and a DANGEROUS `nuke` (NOT exposed). Beside
 * them ride the bespoke tools — `greet` and one per failure/result shape the
 * result framing has to answer for (see "the structured arm" below). Then
 * assert:
 *
 *   - tools/list shows only `counter_bump` + `greet`, and NOT `admin_nuke`;
 *   - tools/call on the exposed procedure mutates the cell;
 *   - the bespoke tool runs;
 *   - resources/list + resources/read return the cell snapshot;
 *   - resources/subscribe → a `notifications/resources/updated` fires when the
 *     underlying cell changes.
 */

import { buildSurfaceFace } from "@kolu/surface/client";
import type { Surface, SurfaceSpec } from "@kolu/surface/define";
import { defineSurface } from "@kolu/surface/define";
import { SurfaceStdioTransportClosed } from "@kolu/surface/errors";
import { directDispatch } from "@kolu/surface/links/direct";
import type { SurfaceHandlers } from "@kolu/surface/server";
import {
  implementSurface,
  inMemoryChannel,
  inMemoryStore,
  streamFromAbortableSource,
} from "@kolu/surface/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { Effect, Schema, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cellUri, streamUri } from "./expose";
import {
  type ServeSurfaceAsMcpOptions,
  type SurfaceClientCallable,
  serveSurfaceAsMcp,
} from "./server";
import { ToolFailure } from "./tools";

/** The in-process client every case here drives the adapter with: the SAME
 *  nested member face a wire link mints (`buildSurfaceFace`), over the no-wire
 *  `directDispatch`. Cast to the adapter's callable-leaf shape because the face
 *  is deliberately structural — per-member precision lives in the bound Solid
 *  client, which this package does not use. */
function faceFor<S extends SurfaceSpec>(
  surface: Surface<S>,
  served: { handlers: SurfaceHandlers },
): SurfaceClientCallable {
  return buildSurfaceFace(
    surface,
    directDispatch(served),
  ) as unknown as SurfaceClientCallable;
}

// ── A tiny surface + in-memory implementation ────────────────────────────

function buildSurface() {
  const surface = defineSurface({
    cells: {
      count: { schema: Schema.Finite, default: 0 },
    },
    streams: {
      ticks: { inputSchema: Schema.Void, outputSchema: Schema.Finite },
    },
    procedures: {
      counter: {
        bump: { output: Schema.Finite },
      },
      admin: {
        // The dangerous verb — present on the surface, deliberately NOT
        // exposed. Proves default-deny: it must never reach the host.
        nuke: { output: Schema.Boolean },
      },
    },
  });

  const countStore = inMemoryStore(0);
  const tickBus = inMemoryChannel<number>();

  const served = implementSurface(surface, {
    cells: { count: { store: countStore } },
    streams: {
      ticks: {
        // Snapshot first (lazily — the read happens at SUBSCRIBE time), then the
        // bus, whose subscription is a scoped resource of the stream.
        source: () =>
          Stream.concat(
            Stream.suspend(() => Stream.make(countStore.get())),
            streamFromAbortableSource<number>((signal) =>
              tickBus.subscribe(signal),
            ),
          ),
      },
    },
    procedures: {
      counter: {
        bump: ({ ctx }) =>
          Effect.sync(() => {
            const next = ctx.cells.count.get() + 1;
            ctx.cells.count.set(next);
            tickBus.publish(next);
            return next;
          }),
      },
      admin: {
        nuke: ({ ctx }) =>
          Effect.sync(() => {
            ctx.cells.count.set(-999);
            return true;
          }),
      },
    },
  });

  return { surface, client: faceFor(surface, served) };
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
        input: Schema.Struct({ name: Schema.String }),
        description: "Say hello.",
        title: "Greet somebody",
        handler: (args) =>
          Effect.sync(() => {
            const { name } = args as { name: string };
            return { hello: name };
          }),
      },
      explode: {
        description: "Always fails — pins the isError framing.",
        handler: () => Effect.fail(new Error("boom: the handler rejected")),
      },
      // One per failure/result SHAPE the structured arm has to answer for.
      refuse: {
        description: "Refuses with machine-readable detail.",
        handler: () =>
          Effect.fail(
            new ToolFailure("`refuse` was refused (validation): 2 bad rows", {
              kind: "validation",
              rows: [3, 7],
            }),
          ),
      },
      tagged: {
        description: "Fails with a tagged, message-less error.",
        // The shape `Data.TaggedError` has: an `Error` whose identity is `_tag`
        // and whose `message` is empty. Hand-built rather than imported so the
        // test pins the SHAPE, not Effect's spelling of it.
        handler: () =>
          Effect.fail(
            Object.assign(new Error(""), { _tag: "OutlineBroken" as const }),
          ),
      },
      plainObject: {
        description: "Fails with a non-Error value.",
        handler: () => Effect.fail({ code: 17, why: "not an Error at all" }),
      },
      unstringifiable: {
        description: "Fails with a non-Error value JSON cannot render.",
        // `JSON.stringify` EVALUATES every own enumerable getter, so a property
        // that throws on read throws from inside the description attempt —
        // carrying a real reason that has nothing to do with serialization.
        handler: () =>
          Effect.fail({
            stage: "commit",
            get detail(): string {
              throw new Error("network timeout while computing detail");
            },
          }),
      },
      scalarResult: {
        description: "Succeeds with a bare number.",
        handler: () => Effect.succeed(42),
      },
      dateResult: {
        description:
          "Succeeds with a value that is an object in memory and a string on the wire.",
        handler: () => Effect.succeed(new Date("2026-08-11T00:00:00.000Z")),
      },
    },
    serverInfo: { name: "test-surface", version: "0.0.0" },
    instructions:
      "Everything here is about the counter, not about files. Bump it, don't nuke it.",
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
    expect(names).toEqual([
      "counter_bump",
      "dateResult",
      "explode",
      "greet",
      "plainObject",
      "refuse",
      "scalarResult",
      "tagged",
      "unstringifiable",
    ]);
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

  it("a bespoke tool whose args fail its schema returns isError, not a protocol error", async () => {
    // The Effect successor of zod's `.parse` at the dispatch edge:
    // `Schema.decodeUnknownSync` throws a `SchemaError`, which the dispatch
    // try/catch turns into the `isError` tool result the contract promises.
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const res = await mcp.callTool({ name: "greet", arguments: { name: 7 } });
    expect(res.isError).toBe(true);
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
    // lie in MCP form). A REAL `implementSurface` runtime can't produce this (it
    // always opens with a snapshot), so model the dropped bridge with a stub client
    // whose `count.get` yields no frame. readSnapshot must FAIL, never collapse.
    const surface = defineSurface({
      cells: { count: { schema: Schema.Finite, default: 0 } },
    });
    const droppedBridge = {
      surface: {
        // Ends without emitting — the guaranteed snapshot frame never arrives.
        count: { get: () => Stream.empty },
      },
    };
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const served = await serveSurfaceAsMcp({
      surface,
      client: () => droppedBridge as unknown as SurfaceClientCallable,
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

  it("a member that resolves NO streaming source at all also throws (the dropped-face arm)", async () => {
    // The other half of the dropped-bridge shape: the member ref exists but hands
    // back something that is not a `Stream` (a stale/partial face over a dead
    // link). It must be stated as a link/protocol failure, never coerced into an
    // empty read.
    const surface = defineSurface({
      cells: { count: { schema: Schema.Finite, default: 0 } },
    });
    const brokenFace = {
      surface: { count: { get: () => undefined } },
    };
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const served = await serveSurfaceAsMcp({
      surface,
      client: () => brokenFace as unknown as SurfaceClientCallable,
      expose: { count: "resource" },
      serverInfo: { name: "no-source-test", version: "0.0.0" },
      transport: serverTransport,
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    await expect(mcp.readResource({ uri: cellUri("count") })).rejects.toThrow(
      /resolved no streaming source/,
    );
  });

  it("a STREAM that opens EMPTY also throws — streams are snapshot-first too (StreamHandlerDeps), not empty-to-null", async () => {
    // The reloc-D correction: `StreamHandlerDeps` REQUIRES "first yield is a fresh
    // full snapshot", so a Stream is snapshot-guaranteed exactly like a cell — only
    // an Event has no snapshot obligation. An empty stream open is therefore the
    // SAME dead-link failure, and must throw, not collapse to JSON null.
    const surface = defineSurface({
      streams: {
        ticks: { inputSchema: Schema.Void, outputSchema: Schema.Finite },
      },
    });
    const droppedBridge = {
      surface: { ticks: { get: () => Stream.empty } },
    };
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const served = await serveSurfaceAsMcp({
      surface,
      client: () => droppedBridge as unknown as SurfaceClientCallable,
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
      cells: { count: { schema: Schema.Finite, default: 0 } },
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const served = await serveSurfaceAsMcp({
      surface,
      // `peek` never touches the client and `listTools` doesn't invoke it.
      client: () => ({ surface: {} }) as SurfaceClientCallable,
      expose: {},
      tools: {
        peek: {
          mutates: false,
          description: "A genuinely read-only tool.",
          handler: () => Effect.succeed({ ok: true }),
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
      rows: {
        keySchema: Schema.Finite,
        schema: Schema.Struct({ v: Schema.String }),
      },
    },
    events: {
      // No snapshot by contract — `resources/read` must not block (F2).
      pinged: { inputSchema: Schema.Void, outputSchema: Schema.Finite },
    },
    procedures: {
      echo: {
        // A scalar input — advertised wrapped under `value`, dispatched
        // unwrapped (F3).
        shout: { input: Schema.String, output: Schema.String },
      },
    },
  });

  const rows = new Map<number, { v: string }>([[42, { v: "answer" }]]);
  const served = implementSurface(surface, {
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
        shout: ({ input }) => Effect.succeed(`${input}!`),
      },
    },
  });

  return { surface, client: faceFor(surface, served) };
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
        input: Schema.Array(Schema.Finite),
        handler: (args) =>
          Effect.succeed((args as number[]).reduce((a, b) => a + b, 0)),
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
    // collection's `Schema.Finite` key schema before `.get({ key: 42 })`.
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

    // The collection `get` HOLDS OPEN for a not-yet-born key (the #1681 fix),
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
    await Effect.runPromise(over.client.surface.rows?.delete?.({ key: 42 }));
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
        tools: { counter_bump: { handler: () => Effect.succeed("x") } },
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
        a: { b_c: { output: Schema.Boolean } },
        a_b: { c: { output: Schema.Boolean } },
      },
    });
    const [, serverTransport] = InMemoryTransport.createLinkedPair();
    await expect(
      serveSurfaceAsMcp({
        surface,
        client: () => ({ surface: {} }) as SurfaceClientCallable,
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
        ok: { ping: { output: Schema.String } },
        bad: { boom: { output: Schema.String } },
      },
    });
    const served = implementSurface(surface, {
      procedures: {
        ok: { ping: () => Effect.succeed("pong") },
        // An APPLICATION-level failure (not a transport death). It is UNDECLARED,
        // so under D4 it is a DEFECT — which still reaches the host as an `isError`
        // tool result, and must NOT reset the shared connection.
        bad: {
          boom: () =>
            Effect.die(new Error("bad arg: application-level failure")),
        },
      },
    });
    return { surface, client: faceFor(surface, served) };
  }

  type ConcurrencyOver = ReturnType<typeof concurrencySurface>;
  type ConcurrencyOptions = ServeSurfaceAsMcpOptions<
    ConcurrencyOver["surface"]["spec"]
  >;

  /** The spine every case in this block drives: one in-memory pair, one adapter
   *  over the concurrency surface, one connected MCP client, torn down by the
   *  shared `cleanup`. What the cases actually differ in is the CONNECTION
   *  FACTORY they hand the adapter (and, for one of them, what is exposed), so
   *  that is all a case supplies — the rest being open-coded eight times is how
   *  a boilerplate change lands in seven places and misses the eighth. */
  async function connectConcurrency(
    over: ConcurrencyOver,
    opts: Pick<ConcurrencyOptions, "client"> &
      Partial<Pick<ConcurrencyOptions, "expose" | "tools">>,
  ) {
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const served = await serveSurfaceAsMcp({
      surface: over.surface,
      expose: { "ok.ping": { tool: { mutates: false } } },
      ...opts,
      serverInfo: { name: "t", version: "0" },
      transport: serverTransport,
    });
    const mcp = new Client({ name: "c", version: "0" });
    await mcp.connect(clientTransport);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );
    return { mcp, ...served };
  }

  it("app-level tool errors do NOT dispose the shared connection; a transport death does", async () => {
    const over = concurrencySurface();
    let dials = 0;
    let disposes = 0;
    const { mcp } = await connectConcurrency(over, {
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
          handler: () =>
            Effect.fail(
              new SurfaceStdioTransportClosed({ reason: "pipe closed" }),
            ),
        },
      },
    });

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

    // And it says so in the layer the AGENT is standing in: the raw link error
    // ("stdio transport closed … the peer process exited") reads as though this
    // MCP server died, which is the misread that cost a whole session in #2082.
    const text = (drop as { content?: { text: string }[] }).content?.[0]?.text;
    expect(text).toContain("the connection to the served surface dropped");
    expect(text).toContain("This MCP server is still running");
    expect(text).toContain("retry");
    // The underlying reason survives the re-frame — context added, never swallowed.
    expect(text).toContain("pipe closed");
  });

  // ── #2082: a restart must cost ZERO requests ─────────────────────────────
  //
  // The bug: the shared connection was only ever dropped by a call FAILING on
  // it, so a daemon restart was discovered by spending a request on the corpse.
  // The first request after every restart failed and every later one succeeded
  // — and the agent on the other end read that one failure as "the MCP server
  // is dead" and stopped using MCP for the rest of its session.
  it("a connection that ANNOUNCES its close is dropped eagerly — the next request costs nothing (#2082)", async () => {
    const over = concurrencySurface();
    let dials = 0;
    const disposed: number[] = [];
    // The live transport's close callbacks, per dial — firing one is this test's
    // stand-in for "padi exited", which is exactly what padi's `onClose` reports.
    const closers: Array<() => void> = [];
    const { mcp } = await connectConcurrency(over, {
      client: () => {
        const n = (dials += 1);
        return {
          client: over.client,
          dispose: () => {
            disposed.push(n);
          },
          onClose: (cb: () => void) => closers.push(cb),
        };
      },
    });

    // One live connection, and the adapter subscribed to its close.
    await mcp.callTool({ name: "ok_ping", arguments: {} });
    expect(dials).toBe(1);
    expect(closers).toHaveLength(1);

    // The daemon goes away while the adapter is IDLE — no request in flight, which
    // is the ordinary restart (an upgrade at 18:17, the agent's next call at 23:15).
    // THE eager-vs-lazy assertion: the corpse is discarded HERE, before any
    // request touches it. Under the old lazy-only behaviour nothing happens until
    // a call fails, so this line is what a lazy implementation cannot pass.
    closers[0]?.();
    expect(disposed).toEqual([1]); // discarded on the announcement, not on a failure

    // THE REGRESSION: the very next request must SUCCEED against a fresh dial.
    // Before the fix this call was spent proving the socket was dead.
    const after = await mcp.callTool({ name: "ok_ping", arguments: {} });
    expect(after.isError).toBeFalsy();
    expect(dials).toBe(2);
  });

  it("a connection born dead is re-dialed, not handed out — no request is spent on it (#2082)", async () => {
    // The door the eager path opens: `onClose` may fire DURING registration (a
    // transport that already died — padi replays it on a microtask, and the
    // contract permits a plain synchronous `cb()`). The connection is then
    // disposed before the awaiting caller resumes, and returning it anyway
    // would spend that caller's request on a corpse — #2082's own symptom,
    // walked back in through the fix. Re-dialing is safe where re-requesting is
    // not: a dial carries no caller intent, so nothing is replayed.
    const over = concurrencySurface();
    let dials = 0;
    const disposed: number[] = [];
    const { mcp } = await connectConcurrency(over, {
      client: () => {
        const n = (dials += 1);
        return {
          client: over.client,
          dispose: () => {
            disposed.push(n);
          },
          // The FIRST dial is born dead and says so SYNCHRONOUSLY, the harshest
          // shape the contract allows. Later dials are healthy.
          onClose: (cb: () => void) => {
            if (n === 1) cb();
          },
        };
      },
    });

    const result = await mcp.callTool({ name: "ok_ping", arguments: {} });
    expect(result.isError).toBeFalsy(); // the request was NOT spent on the corpse
    expect(dials).toBe(2); // dial #1 was born dead, so it was re-dialed
    expect(disposed).toEqual([1]); // and the corpse was disposed, not leaked
  });

  it("a transport that is born dead every time fails loudly instead of spinning", async () => {
    // The bound on the loop above. A daemon that cannot hold a connection at
    // all must SAY so — never spin re-dialing, and never collapse to a quiet
    // empty answer.
    const over = concurrencySurface();
    let dials = 0;
    const { mcp } = await connectConcurrency(over, {
      client: () => {
        dials += 1;
        return {
          client: over.client,
          dispose: () => {},
          onClose: (cb: () => void) => cb(),
        };
      },
    });

    const result = (await mcp.callTool({
      name: "ok_ping",
      arguments: {},
    })) as { isError?: boolean; content?: { text: string }[] };
    expect(result.isError).toBe(true);
    const text = result.content?.[0]?.text;
    expect(text).toContain("not staying up long enough to carry a request");
    // The link-failure policy applies HERE too, not only to a call that died
    // mid-flight: an agent reading this on its own stdio channel must be told
    // this server survives, or it draws #2082's exact inference.
    expect(text).toContain("This MCP server is still running");
    expect(text).toContain("retry once the served daemon is holding");
    // …and the adapter names itself exactly ONCE. The message used to be
    // prefixed at the throw and again at the tools/call edge.
    expect(text).toContain("surface-mcp: ");
    expect(text).not.toContain("surface-mcp: surface-mcp:");
    expect(dials).toBe(3);
  });

  it("a request after close() opens no socket at all", async () => {
    // The terminal state gates the dial's ENTRY, not just its middle. It used
    // to be a boolean read only AFTER `opts.client()` had run, so a request
    // landing after teardown really opened a unix socket / spawned an ssh child
    // and disposed it on the next line.
    const over = concurrencySurface();
    let dials = 0;
    const { mcp, server } = await connectConcurrency(over, {
      client: () => {
        dials += 1;
        return { client: over.client, dispose: () => {} };
      },
    });

    await mcp.callTool({ name: "ok_ping", arguments: {} });
    expect(dials).toBe(1);

    // The adapter's own teardown hook — what the SDK runs when the MCP host
    // closes the pipe. Driving it directly latches the terminal state while
    // leaving the pipe open, so a request can still reach the handler and hit
    // the gate (calling `close()` would take the transport down with it).
    server.onclose?.();
    const after = (await mcp.callTool({ name: "ok_ping", arguments: {} })) as {
      isError?: boolean;
      content?: { text: string }[];
    };
    expect(after.isError).toBe(true);
    expect(after.content?.[0]?.text).toContain("the server is closed");
    expect(dials).toBe(1); // no socket was opened just to be disposed
  });

  it("a late close announcement cannot dispose the successor connection (#2082)", async () => {
    // The identity guard, now reachable from a second direction. `onClose` fires
    // on the OLD connection's schedule, so it can land after something else has
    // already re-dialed — and disposing the live successor there would break the
    // very calls the eager drop exists to protect.
    const over = concurrencySurface();
    let dials = 0;
    const disposed: number[] = [];
    const closers: Array<() => void> = [];
    const { mcp } = await connectConcurrency(over, {
      client: () => {
        const n = (dials += 1);
        return {
          client: over.client,
          dispose: () => {
            disposed.push(n);
          },
          onClose: (cb: () => void) => closers.push(cb),
        };
      },
    });

    await mcp.callTool({ name: "ok_ping", arguments: {} }); // conn #1
    // #1 announces its death and is dropped EAGERLY — asserted before the next
    // request, because a successor only exists to be protected if the
    // predecessor really went away on the announcement rather than on a failure.
    closers[0]?.();
    expect(disposed).toEqual([1]);
    await mcp.callTool({ name: "ok_ping", arguments: {} }); // conn #2 is now live
    expect(dials).toBe(2);

    // THE CLAIM: #1's announcement arriving AGAIN (a duplicate, or one delivered
    // late on the dead transport's own schedule) must be inert — #2 is neither
    // disposed…
    closers[0]?.();
    expect(disposed).toEqual([1]);
    // …nor unslotted: the next request rides #2 rather than re-dialing, which is
    // what proves the guard dropped the announcement instead of the connection.
    const after = await mcp.callTool({ name: "ok_ping", arguments: {} });
    expect(after.isError).toBeFalsy();
    expect(dials).toBe(2);

    // And the successor is still ANNOUNCE-able in its own right: #2's close
    // drops #2, so the guard rejected a stale identity rather than latching the
    // slot shut after the first drop.
    closers[1]?.();
    expect(disposed).toEqual([1, 2]);
  });

  it("concurrent first calls share ONE dial (no double-dial leak)", async () => {
    const over = concurrencySurface();
    let dials = 0;
    let disposes = 0;
    const { mcp } = await connectConcurrency(over, {
      client: async () => {
        dials += 1;
        // A dial that takes a tick — both concurrent callers await it before
        // either resolves, so a check-then-act getConn would open two sockets.
        await new Promise((r) => setTimeout(r, 10));
        return {
          client: over.client,
          dispose: () => {
            disposes += 1;
          },
        };
      },
    });

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
    const { mcp, close } = await connectConcurrency(over, {
      client: async () => {
        await dialGate; // hold the dial open until we release it
        return {
          client: over.client,
          dispose: () => {
            disposes += 1;
          },
        };
      },
    });

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
    // (The shared `cleanup` closes both ends; `close()` above is this test's
    // ACTION, and re-running it there is inert.)
    expect(disposes).toBe(1);
  });
});

/**
 * The structured arm — MCP's `structuredContent`, on both the answer and the
 * refusal, plus the two server-level fields a host reads before it calls
 * anything (`instructions`, a tool's `title`).
 *
 * The contract these pin: an agent reads `structuredContent` and never has to
 * parse the prose — INCLUDING when the answer is "no". That is the half MCP's
 * spec has had since 2025-06-18 and this adapter used to drop on the floor,
 * stringifying an object it already held.
 */
describe("serveSurfaceAsMcp — the structured arm", () => {
  it("a successful object answer travels as data as well as prose", async () => {
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

    expect(res.structuredContent).toEqual({ hello: "ada" });
    // The SAME value twice — the text arm is not a different answer.
    const text = (res.content as { text: string }[])[0]?.text ?? "null";
    expect(JSON.parse(text)).toEqual(res.structuredContent);
  });

  it("a non-object answer rides under `value` — the wrapping the INPUT side already uses", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    // A bespoke scalar, and a procedure whose output schema is a bare number:
    // both are non-objects, and MCP types `structuredContent` as an object, so
    // both wrap. An agent that learned `{ value: … }` for a scalar ARGUMENT
    // meets the identical shape coming back.
    const scalar = await mcp.callTool({ name: "scalarResult", arguments: {} });
    expect(scalar.structuredContent).toEqual({ value: 42 });

    const bumped = await mcp.callTool({ name: "counter_bump", arguments: {} });
    expect(bumped.structuredContent).toEqual({ value: 1 });
  });

  it("an answer that is an object in memory and a string on the wire still travels", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    // Regression pin. `typeof` describes the value in MEMORY; `toJSON` decides
    // the one on the WIRE, and for a Date they disagree. Deciding the structured
    // arm from the live value published a `structuredContent` that serializes as
    // a string, which the SDK client rejects as a PROTOCOL error (-32602) —
    // `mcp.callTool` THREW instead of returning, on the success path, where no
    // `isError` framing can catch it. Both arms now read one serialization.
    const res = await mcp.callTool({ name: "dateResult", arguments: {} });

    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({
      value: "2026-08-11T00:00:00.000Z",
    });
    const text = (res.content as { text: string }[])[0]?.text ?? "null";
    expect(JSON.parse(text)).toBe("2026-08-11T00:00:00.000Z");
  });

  it("a ToolFailure refusal is isError AND carries its detail", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const res = await mcp.callTool({ name: "refuse", arguments: {} });

    // A refusal is an ANSWER: an `isError` tool result, never a protocol error
    // (the SDK client would throw), and its reason arrives as data.
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toEqual({ kind: "validation", rows: [3, 7] });
    // The prose still reads as prose, and still carries this adapter's brand.
    expect((res.content as { text: string }[])[0]?.text).toBe(
      "surface-mcp: `refuse` was refused (validation): 2 bad rows",
    );
  });

  it("an ordinary Error stays message-only — structure is opt-in, never guessed", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const res = await mcp.callTool({ name: "explode", arguments: {} });

    expect(res.isError).toBe(true);
    // Structuring whatever an error happens to hold would publish a stack trace
    // into the agent's data channel and dress an incidental TypeError up as a
    // contract. Absent, not empty: a host can tell "no detail" from "{}".
    expect(res.structuredContent).toBeUndefined();
    expect((res.content as { text: string }[])[0]?.text).toContain(
      "boom: the handler rejected",
    );
  });

  it("a tagged, message-less failure reaches the agent as its tag, not as a bare brand", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const res = await mcp.callTool({ name: "tagged", arguments: {} });

    // Regression pin: `e instanceof Error ? e.message : String(e)` rendered
    // every `Data.TaggedError` — an Error whose identity is `_tag` and whose
    // message is "" — as the brand and nothing else: `surface-mcp: `.
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0]?.text).toBe(
      "surface-mcp: OutlineBroken",
    );
  });

  it("resources/read derives its sentence the SAME way — its own comment calls it the mirror of failFrom", async () => {
    // The `tagged` case above, on the OTHER request edge. `@kolu/surface`'s
    // whole declared-error vocabulary is `Schema.TaggedError`s, so a read that
    // hits one is the everyday case here, not an exotic one — and while that
    // edge spelled `e instanceof Error ? e.message : String(e)` inline it
    // delivered the bare brand, `surface-mcp: `, to the agent.
    const surface = defineSurface({
      cells: { count: { schema: Schema.Finite, default: 0 } },
    });
    const brokenRead = {
      surface: {
        count: {
          get: () =>
            Stream.fail(
              Object.assign(new Error(""), { _tag: "OutlineBroken" as const }),
            ),
        },
      },
    };
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const served = await serveSurfaceAsMcp({
      surface,
      client: () => brokenRead as unknown as SurfaceClientCallable,
      expose: { count: "resource" },
      serverInfo: { name: "read-tagged-test", version: "0.0.0" },
      transport: serverTransport,
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    await expect(mcp.readResource({ uri: cellUri("count") })).rejects.toThrow(
      /surface-mcp: OutlineBroken/,
    );
  });

  it("a non-Error failure value is described, not stringified to [object Object]", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const res = await mcp.callTool({ name: "plainObject", arguments: {} });

    expect(res.isError).toBe(true);
    const text = (res.content as { text: string }[])[0]?.text ?? "";
    expect(text).not.toContain("[object Object]");
    expect(text).toContain('"why":"not an Error at all"');
    // Still message-only: a plain object is a failure whose author did not say
    // it was machine-readable, and this adapter does not decide that for them.
    expect(res.structuredContent).toBeUndefined();
  });

  it("a failure JSON cannot render keeps BOTH its shape and the reason it could not be rendered", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const res = await mcp.callTool({ name: "unstringifiable", arguments: {} });

    expect(res.isError).toBe(true);
    const text = (res.content as { text: string }[])[0]?.text ?? "";
    // The shape survives — the host still learns WHAT failed.
    expect(text).toContain("stage, detail");
    // And so does the real reason. Discarding it would swallow the most
    // specific thing known about the failure inside the one function whose
    // whole job is to find it — and a throwing getter, unlike a cycle, carries
    // a cause that has nothing to do with serialization.
    expect(text).toContain("network timeout while computing detail");
    expect(text).not.toContain("[object Object]");
  });

  it("serves the host its `instructions` at initialize", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    // `initialize` is answered inside the SDK's own `Protocol`, so a consumer
    // cannot re-register it — the option is the only route to this field.
    expect(mcp.getInstructions()).toBe(
      "Everything here is about the counter, not about files. Bump it, don't nuke it.",
    );
  });

  it("a bespoke tool's `title` reaches tools/list, and an untitled one has none", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const { tools } = await mcp.listTools();
    const byName = new Map(tools.map((t) => [t.name, t]));

    expect(byName.get("greet")?.title).toBe("Greet somebody");
    // Absent when undeclared — a host then renders `name`, which is honest.
    expect(byName.get("explode")?.title).toBeUndefined();
    // A procedure-derived tool has no second string to draw a title from.
    expect(byName.get("counter_bump")?.title).toBeUndefined();
  });

  it("a REFUSAL's detail is normalized exactly like a success — one wire form, both arms", async () => {
    // Measured before the fix, over this same in-memory client:
    //   - a detail whose JSON form is NOT an object reached the wire as
    //     `"structuredContent": 42` — MCP types that field as an object, and
    //     the success arm's `wrapValue` had guarded it for years;
    //   - a detail JSON cannot render at all (a cycle) threw inside the
    //     TRANSPORT's serializer, past every catch, so the request was never
    //     answered at all.
    // Both arms now read `wireForm` + `wrapValue`, so a refusal cannot publish a
    // shape the success arm would have refused.
    const surface = defineSurface({
      cells: { count: { schema: Schema.Finite, default: 0 } },
    });
    const cyclicDetail: Record<string, unknown> = { kind: "cyclic" };
    cyclicDetail.self = cyclicDetail;
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const served = await serveSurfaceAsMcp({
      surface,
      client: () => ({ surface: {} }) as SurfaceClientCallable,
      expose: {},
      tools: {
        dateDetail: {
          handler: () =>
            Effect.fail(
              new ToolFailure("refused, with a Date in the detail", {
                at: new Date("2026-08-11T00:00:00.000Z"),
              }),
            ),
        },
        scalarDetail: {
          handler: () =>
            Effect.fail(
              new ToolFailure("refused, with a detail JSON turns into 42", {
                toJSON: () => 42,
              } as unknown as Record<string, unknown>),
            ),
        },
        cyclicDetail: {
          handler: () =>
            Effect.fail(new ToolFailure("refused, with a cycle", cyclicDetail)),
        },
      },
      serverInfo: { name: "refusal-shape-test", version: "0.0.0" },
      transport: serverTransport,
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    // A live Date in a detail is an object in memory and a string on the wire —
    // the same disagreement the success arm was fixed for.
    const dated = await mcp.callTool({ name: "dateDetail", arguments: {} });
    expect(dated.isError).toBe(true);
    expect(dated.structuredContent).toEqual({
      at: "2026-08-11T00:00:00.000Z",
    });

    // A detail JSON renders as a non-object rides under `value`, like any other
    // non-object structured answer.
    const scalar = await mcp.callTool({ name: "scalarDetail", arguments: {} });
    expect(scalar.isError).toBe(true);
    expect(scalar.structuredContent).toEqual({ value: 42 });

    // A detail JSON cannot render is a LOUD failure of the call, not a silently
    // unanswered request: the throw now happens in front of the SDK's
    // request-handler boundary, which answers it.
    await expect(
      mcp.callTool({ name: "cyclicDetail", arguments: {} }),
    ).rejects.toThrow(/[Cc]ircular/);
  });

  it("the two edges wrap by DIFFERENT predicates, and a union input shows it", async () => {
    // The rule is one KEY, not one predicate, and the difference is observable —
    // pinned so the next reader meets it as a decision rather than a surprise.
    // The INPUT side decides from the declared schema: a union has no top-level
    // `type`, so it is advertised WRAPPED. The RESULT side decides from the
    // value on the wire, and there is no `outputSchema` to read a bit off — so
    // the same value answers BARE.
    const surface = defineSurface({
      cells: { count: { schema: Schema.Finite, default: 0 } },
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const served = await serveSurfaceAsMcp({
      surface,
      client: () => ({ surface: {} }) as SurfaceClientCallable,
      expose: {},
      tools: {
        echoUnion: {
          input: Schema.Union([
            Schema.Struct({ a: Schema.Finite }),
            Schema.String,
          ]),
          handler: (args) => Effect.succeed(args),
        },
      },
      serverInfo: { name: "union-wrap-test", version: "0.0.0" },
      transport: serverTransport,
    });
    const mcp = new Client({ name: "test-client", version: "0.0.0" });
    await mcp.connect(clientTransport);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    const { tools } = await mcp.listTools();
    const echo = tools.find((t) => t.name === "echoUnion");
    // Advertised wrapped — the host must send `{ value: … }`.
    expect(Object.keys(echo?.inputSchema.properties ?? {})).toEqual(["value"]);

    // …and the identical object answers BARE.
    const res = await mcp.callTool({
      name: "echoUnion",
      arguments: { value: { a: 1 } },
    });
    expect(res.structuredContent).toEqual({ a: 1 });

    // They agree for every scalar, array and null — only the object-valued
    // union diverges.
    const scalar = await mcp.callTool({
      name: "echoUnion",
      arguments: { value: "hi" },
    });
    expect(scalar.structuredContent).toEqual({ value: "hi" });
  });

  it("no tool advertises an outputSchema — the invariant the refusal arm depends on", async () => {
    const over = buildSurface();
    const { mcp, served } = await connect(over);
    cleanup.push(
      () => mcp.close(),
      () => served.close(),
    );

    // The SDK's client validates `structuredContent` against a declared
    // `outputSchema` whenever the field is present — INCLUDING on an isError
    // result. A refusal's detail is a different shape from the success it
    // refused, so declaring a success schema would make every structured
    // refusal throw inside the client instead of reaching the agent. If this
    // ever fails, `ToolFailure`'s detail needs a home in that schema FIRST.
    const { tools } = await mcp.listTools();
    expect(tools.filter((t) => t.outputSchema !== undefined)).toEqual([]);
  });
});

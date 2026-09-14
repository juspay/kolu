/**
 * The adapter driven the way a real embedding host drives it — through a bare
 * `Transport`, with no `initialize` handshake and no MCP `Client`.
 *
 * COVERAGE, not a regression guard. Every other test in this package reaches the
 * server through the SDK's `InMemoryTransport` paired with a real `Client`, which
 * performs the handshake and keeps a session. A host that embeds the adapter in
 * its own route need not do any of that: it can inject requests by calling
 * `onmessage` directly, match replies by id, and drop anything without one — so
 * both `list_changed` notifications go nowhere, and every roster move happens
 * with no client attached at all. That is a genuinely different path through
 * `reroster`, and nothing else in the suite walks it.
 *
 * The shape is olai's (`packages/plugins/mcp/src/route.ts`), copied here after a
 * field report was chased to it and turned out to be a mis-stated assertion in
 * olai's own suite rather than an adapter defect (juspay/olai#546). The adapter
 * answered correctly at every revision over this transport; this file is what
 * makes that a fact the suite holds rather than one an investigation established
 * once.
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
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { serveSurfaceAsMcp } from "./server";

// ── The surfaces ─────────────────────────────────────────────────────────

const coreSurface = defineSurface({
  cells: { banner: { schema: Schema.String, default: "core" } },
  procedures: { who: { get: { output: Schema.String } } },
});

const rowSurface = defineSurface({
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

const coreClient = (): SurfaceClientCallable =>
  faceFor(
    coreSurface,
    implementSurface(coreSurface, {
      cells: { banner: { store: inMemoryStore("core") } },
      procedures: { who: { get: () => Effect.succeed("core") } },
    }),
  );

function rowClient(name: string): SurfaceClientCallable {
  const rows = new Map<string, string>([[`${name}-row`, name]]);
  return faceFor(
    rowSurface,
    implementSurface(rowSurface, {
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

// ── The transport a real host actually has ───────────────────────────────

/** A bare `Transport`: `start`/`close` are no-ops, `send` resolves the waiter
 *  registered for a reply's id and otherwise drops the message on the floor
 *  (which is what happens to both `list_changed` notifications), and `ask`
 *  injects a request by calling `onmessage` directly. No `initialize` is ever
 *  sent, so the server never sees a handshake and no session exists. */
function stubTransport() {
  const waiters = new Map<number, (reply: unknown) => void>();
  let id = 0;
  const transport: Transport = {
    start: async () => {},
    close: async () => {},
    // biome-ignore lint/suspicious/noExplicitAny: the SDK's wire message shape.
    send: async (message: any) => {
      const replyTo = message?.id;
      if (replyTo === undefined) return; // a notification — nobody is listening
      waiters.get(replyTo)?.(message);
      waiters.delete(replyTo);
    },
  };
  return {
    transport,
    /** Inject one request and resolve with its reply — the JSON-RPC envelope as
     *  a host's own route sees it, since there is no `Client` to unwrap it. */
    ask: (method: string, params: unknown): Promise<JsonRpcReply> => {
      id += 1;
      const mine = id;
      return new Promise<JsonRpcReply>((resolve) => {
        waiters.set(mine, resolve as (reply: unknown) => void);
        transport.onmessage?.({
          jsonrpc: "2.0",
          id: mine,
          method,
          params,
          // biome-ignore lint/suspicious/noExplicitAny: the SDK's wire message shape.
        } as any);
      });
    },
  };
}

/** What a reply looks like on the wire, at the depth this file reads it. */
interface JsonRpcReply {
  readonly result: {
    readonly tools?: ReadonlyArray<{ readonly name: string }>;
    readonly content?: ReadonlyArray<{ readonly text: string }>;
  };
}

const cleanup: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

// ── The sequence ─────────────────────────────────────────────────────────

const ROWS = ["outlines", "markdown", "chat", "vaultplugins"];

const rowEntry = (key: string) =>
  key === "outlines"
    ? {
        surface: rowSurface,
        expose: { rows: "resource", "ops.run": "tool" },
        tools: { title: { handler: () => Effect.succeed("outlines") } },
      }
    : { surface: rowSurface, expose: { rows: "resource", "ops.run": "tool" } };

const rosterOf = (keys: readonly string[]) =>
  Object.fromEntries(keys.map((k) => [k, rowEntry(k)]));
const clientsOf = (keys: readonly string[]) =>
  Object.fromEntries(keys.map((k) => [k, rowClient(k)]));

describe("the departed refusal over a handshake-less transport", () => {
  it("answers by name after redundant moves, a mass departure, and a drain to empty", async () => {
    let roster: Record<string, SurfaceClientCallable> = clientsOf(ROWS);
    const { transport, ask } = stubTransport();
    const served = await serveSurfaceAsMcp({
      core: { surface: coreSurface, expose: { "who.get": "tool" } },
      // biome-ignore lint/suspicious/noExplicitAny: erased fixture roster.
      surfaces: rosterOf(ROWS) as any,
      client: (): RootedSurfaceClients => ({
        core: coreClient(),
        clients: roster,
      }),
      serverInfo: { name: "t", version: "0" },
      transport,
    });
    cleanup.push(() => served.close());

    // The name is real to begin with — asked WITHOUT an initialize handshake.
    const listed = await ask("tools/list", {});
    expect((listed.result.tools ?? []).map((t) => t.name)).toContain(
      "outlines_title",
    );

    // A few rerosters handing back the identical map.
    for (let i = 0; i < 6; i += 1) {
      // biome-ignore lint/suspicious/noExplicitAny: erased fixture roster.
      await served.reroster(rosterOf(ROWS) as any);
    }
    // One move that removes most rows at once…
    roster = clientsOf(["chat", "vaultplugins"]);
    // biome-ignore lint/suspicious/noExplicitAny: erased fixture roster.
    await served.reroster(rosterOf(["chat", "vaultplugins"]) as any);
    // …then two more draining to an empty sibling map.
    roster = clientsOf(["chat"]);
    // biome-ignore lint/suspicious/noExplicitAny: erased fixture roster.
    await served.reroster(rosterOf(["chat"]) as any);
    roster = {};
    await served.reroster({});

    const first = await ask("tools/call", {
      name: "outlines_title",
      arguments: {},
    });
    const said = first.result.content?.[0]?.text ?? "";
    expect(said).toContain('the sibling "outlines" was dropped');

    // The second cycle: bring the rows back, flip them off again.
    roster = clientsOf(ROWS);
    // biome-ignore lint/suspicious/noExplicitAny: erased fixture roster.
    await served.reroster(rosterOf(ROWS) as any);
    roster = {};
    await served.reroster({});
    const second = await ask("tools/call", {
      name: "outlines_title",
      arguments: {},
    });
    expect(second.result.content?.[0]?.text ?? "").toContain(
      'the sibling "outlines" was dropped',
    );
  });
});

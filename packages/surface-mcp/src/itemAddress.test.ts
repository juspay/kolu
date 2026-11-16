/**
 * HOW A COLLECTION ITEM IS ADDRESSED — an item's name may contain `/`.
 *
 * A name is everything after its collection's address, so the address a person
 * writes by pasting the name after the collection is the one that reads and
 * subscribes. The escaped spelling (`encodeURIComponent(name)`) names the same
 * item. The template this endpoint advertises is the writer, and the reader has
 * to agree with it: proved by expanding the advertised template with the MCP
 * SDK's own `UriTemplate`, the expander a real host uses.
 *
 * Driven by a real MCP `Client` over the SDK's in-memory pair, as
 * `server.test.ts` and `bundle.test.ts` are.
 */

import {
  buildSurfaceFace,
  type RootedSurfaceClients,
  type SurfaceClientCallable,
} from "@kolu/surface/client";
import type { Surface, SurfaceSpec } from "@kolu/surface/define";
import { defineSurface } from "@kolu/surface/define";
import { directDispatch } from "@kolu/surface/links/direct";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { UriTemplate } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
import {
  type ReadResourceResult,
  ResourceUpdatedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Effect, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serveSurfaceAsMcp } from "./server";

/** The refusal a note's key schema carries, so a case can look for it in the
 *  answer verbatim. */
const NOT_A_NOTE = "a note's name never starts with !";

/** The CORE: a string-keyed collection whose key schema refuses one shape of
 *  name with a sentence of its own. Every item's value is its own name, so a
 *  read that resolved the wrong name is visible in the answer. */
const coreSurface = defineSurface({
  cells: { banner: { schema: Schema.String, default: "core" } },
  collections: {
    notes: {
      keySchema: Schema.String.check(
        Schema.makeFilter((name: string) =>
          name.startsWith("!") ? NOT_A_NOTE : undefined,
        ),
      ),
      schema: Schema.String,
    },
  },
});

/** A SIBLING with a string-keyed collection of its own. */
const tenantSurface = defineSurface({
  collections: {
    rows: { keySchema: Schema.String, schema: Schema.String },
  },
});

/** The names every round trip is held to: a slash, a reference shaped like a
 *  kolu terminal, several slashes, a literal `%`, a space, and non-ASCII. */
const NAMES = ["a/b", "remote:box/9ab1", "x/y/z", "50%/x", "a b/c", "ü/é"];

function faceFor<S extends SurfaceSpec>(
  surface: Surface<S>,
  deps: Parameters<typeof implementSurface<S>>[1],
): SurfaceClientCallable {
  return buildSurfaceFace(
    surface,
    directDispatch(implementSurface(surface, deps)),
  ) as unknown as SurfaceClientCallable;
}

/** A string-keyed collection's handlers over a map whose values are the keys. */
function selfNamed(names: readonly string[]) {
  const rows = new Map(names.map((name) => [name, name]));
  return {
    readAll: () => rows,
    upsert: (k: string, v: string) => {
      rows.set(k, v);
    },
    remove: (k: string) => {
      rows.delete(k);
    },
  };
}

const cleanup: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});

/** A core holding `notes`, beside a sibling `t` holding `rows`, both seeded
 *  with {@link NAMES}. The factory reads `roster`, so a case can move it. */
async function serve() {
  const core = faceFor(coreSurface, {
    cells: { banner: { store: inMemoryStore("core") } },
    collections: { notes: selfNamed(NAMES) },
  });
  const tenant = faceFor(tenantSurface, {
    collections: { rows: selfNamed(NAMES) },
  });
  let roster: Record<string, SurfaceClientCallable> = { t: tenant };
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const served = await serveSurfaceAsMcp({
    core: {
      surface: coreSurface,
      expose: { banner: "resource", notes: "resource" },
    },
    surfaces: { t: { surface: tenantSurface, expose: { rows: "resource" } } },
    client: (): RootedSurfaceClients => ({ core, clients: roster }),
    serverInfo: { name: "item-address-test", version: "0.0.0" },
    transport: serverTransport,
  });
  const mcp = new Client({ name: "c", version: "0" });
  await mcp.connect(clientTransport);
  cleanup.push(
    () => mcp.close(),
    () => served.close(),
  );
  return {
    mcp,
    core,
    tenant,
    /** Take `t` out of the roster, as a host's reroster would. */
    dropTenant: async () => {
      roster = {};
      await served.reroster({});
    },
  };
}

const NOTES = "surface://collections/notes";
const ROWS = "surface://collections/t/rows";

/** The one text content a read answered, parsed. */
function textOf(read: ReadResourceResult): unknown {
  const [first] = read.contents;
  if (first === undefined || !("text" in first)) {
    throw new Error("expected one text content");
  }
  return JSON.parse(first.text);
}

/** The sentence a request was refused with. */
const refusalOf = (pending: Promise<unknown>): Promise<string> =>
  pending.then(
    () => {
      throw new Error("expected a refusal, and the request was answered");
    },
    (e: unknown) => String(e),
  );

describe("an item whose name has a slash", () => {
  it.each([
    ["a core collection", NOTES],
    ["a sibling's collection", ROWS],
  ])("reads in %s at the address a person writes, answered at that address", async (_, collection) => {
    const { mcp } = await serve();
    for (const uri of [
      `${collection}/a/b`,
      `${collection}/${encodeURIComponent("a/b")}`,
    ]) {
      const read = await mcp.readResource({ uri });
      expect(textOf(read), uri).toBe("a/b");
      expect(read.contents[0]?.uri).toBe(uri);
    }
  });

  it.each([
    ["a core collection", NOTES, "core"],
    ["a sibling's collection", ROWS, "tenant"],
  ] as const)("subscribes in %s at either spelling, and hears the update at the address it subscribed at", async (_, collection, owner) => {
    const served = await serve();
    const { mcp } = served;
    const updates: string[] = [];
    mcp.setNotificationHandler(ResourceUpdatedNotificationSchema, (note) => {
      updates.push(note.params.uri);
    });
    const natural = `${collection}/a/b`;
    const escaped = `${collection}/${encodeURIComponent("a/b")}`;
    await mcp.subscribeResource({ uri: natural });
    await mcp.subscribeResource({ uri: escaped });
    // Whatever subscribing itself announces has landed by the time a round
    // trip to the same server has: what follows is what the change adds.
    await mcp.readResource({ uri: natural });
    updates.length = 0;

    const client = owner === "core" ? served.core : served.tenant;
    const member = owner === "core" ? "notes" : "rows";
    await Effect.runPromise(
      client.surface[member]?.upsert?.({ key: "a/b", value: "changed" }),
    );

    await vi.waitFor(() => {
      expect(updates).toContain(natural);
      expect(updates).toContain(escaped);
    });
    expect(textOf(await mcp.readResource({ uri: natural }))).toBe("changed");
  });

  it("round-trips every name through the advertised template and back", async () => {
    const { mcp } = await serve();
    const { resourceTemplates } = await mcp.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual([
      `${NOTES}/{+id}`,
      `${ROWS}/{+id}`,
    ]);
    for (const { uriTemplate } of resourceTemplates) {
      const template = new UriTemplate(uriTemplate);
      const collection = uriTemplate.slice(0, -"/{+id}".length);
      for (const name of NAMES) {
        for (const uri of [
          template.expand({ id: name }),
          `${collection}/${encodeURIComponent(name)}`,
        ]) {
          expect(textOf(await mcp.readResource({ uri })), uri).toBe(name);
        }
      }
    }
  });

  it("is not an address with an empty name, a name that does not decode, or a collection nobody serves", async () => {
    const { mcp } = await serve();
    for (const uri of [
      `${NOTES}/`,
      `${NOTES}/%zz`,
      `${ROWS}/`,
      "surface://collections/nobody/a/b",
    ]) {
      expect(await refusalOf(mcp.readResource({ uri }))).toContain(
        `unknown resource "${uri}"`,
      );
    }
  });
});

describe("an address this endpoint does not serve is refused in words that help", () => {
  it.each([
    "read",
    "subscribe",
  ] as const)("on %s: an item of a sibling that left is no longer served, slashed name and all", async (verb) => {
    const served = await serve();
    await served.dropTenant();
    const uri = `${ROWS}/a/b`;
    const refusal = await refusalOf(
      verb === "read"
        ? served.mcp.readResource({ uri })
        : served.mcp.subscribeResource({ uri }),
    );
    expect(refusal).toContain(`resource "${uri}" is no longer served`);
    expect(refusal).toContain('the sibling "t" was dropped');
  });

  it.each([
    "read",
    "subscribe",
  ] as const)("on %s: a name the collection's key schema refuses carries the schema's own sentence", async (verb) => {
    const { mcp } = await serve();
    const uri = `${NOTES}/!x`;
    const refusal = await refusalOf(
      verb === "read"
        ? mcp.readResource({ uri })
        : mcp.subscribeResource({ uri }),
    );
    expect(refusal).toContain(`resource "${uri}" names no item of "${NOTES}"`);
    expect(refusal).toContain(NOT_A_NOTE);
    expect(refusal).not.toContain("unknown resource");
  });

  it.each([
    "read",
    "subscribe",
  ] as const)("on %s: anything else names every resource and template served", async (verb) => {
    const { mcp } = await serve();
    const uri = "surface://cells/nope";
    const refusal = await refusalOf(
      verb === "read"
        ? mcp.readResource({ uri })
        : mcp.subscribeResource({ uri }),
    );
    expect(refusal).toContain(`unknown resource "${uri}"`);
    for (const served of [
      '"surface://cells/banner"',
      `"${NOTES}"`,
      `"${ROWS}"`,
      `"${NOTES}/{+id}"`,
      `"${ROWS}/{+id}"`,
    ])
      expect(refusal).toContain(served);
  });
});

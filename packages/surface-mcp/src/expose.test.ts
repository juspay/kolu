/**
 * `resolveExpose` — the default-deny resolver. Pins that omission means
 * not-exposed, that each primitive kind maps to the right URI shape, that a
 * mutating procedure carries its flag, and that a key naming nothing in the
 * spec is a boot-time error (not a silent no-op).
 */

import { defineSurface } from "@kolu/surface/define";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  cellUri,
  collectionItemTemplate,
  collectionUri,
  eventUri,
  resolveExpose,
  streamUri,
} from "./expose";

function buildSpec() {
  return defineSurface({
    cells: { count: { schema: z.number(), default: 0 } },
    collections: {
      notes: { keySchema: z.string(), schema: z.object({ body: z.string() }) },
    },
    streams: { ticks: { inputSchema: z.void(), outputSchema: z.number() } },
    events: { exited: { inputSchema: z.void(), outputSchema: z.number() } },
    procedures: {
      counter: {
        bump: { output: z.number() },
        add: { input: z.object({ n: z.number() }), output: z.number() },
      },
      admin: { nuke: { output: z.boolean() } },
    },
  }).spec;
}

describe("resolveExpose", () => {
  it("maps each primitive kind to its resource URI shape", () => {
    const r = resolveExpose(buildSpec(), {
      count: "resource",
      notes: "resource",
      ticks: "resource",
      exited: "resource",
    });

    const uris = r.resources.map((e) => e.uri).sort();
    expect(uris).toContain(cellUri("count"));
    expect(uris).toContain(collectionUri("notes"));
    expect(uris).toContain(streamUri("ticks"));
    expect(uris).toContain(eventUri("exited"));

    // A collection also yields a per-item template.
    expect(r.resourceTemplates.map((t) => t.uriTemplate)).toEqual([
      collectionItemTemplate("notes"),
    ]);
  });

  it("default-deny: only listed procedures become tools; mutates defaults conservatively", () => {
    const r = resolveExpose(buildSpec(), {
      "counter.bump": { tool: { mutates: true } },
      // The bare `"tool"` shorthand carries no flag, so it defaults to MUTATING
      // (conservative): an unannotated procedure is never advertised as a harmless
      // read. A genuinely read-only one would use `{ tool: { mutates: false } }`.
      "counter.add": "tool",
      // admin.nuke deliberately omitted.
    });

    const tools = r.tools.map((t) => ({
      name: t.name,
      mutates: t.mutates,
      hasInput: t.hasInput,
    }));
    expect(tools).toEqual(
      expect.arrayContaining([
        { name: "counter_bump", mutates: true, hasInput: false },
        { name: "counter_add", mutates: true, hasInput: true },
      ]),
    );
    expect(tools.map((t) => t.name)).not.toContain("admin_nuke");
    // Each tool carries a top-level object inputSchema.
    for (const t of r.tools) expect(t.inputSchema.type).toBe("object");
  });

  it("omitting everything exposes nothing", () => {
    const r = resolveExpose(buildSpec(), {});
    expect(r.resources).toEqual([]);
    expect(r.tools).toEqual([]);
    expect(r.resourceTemplates).toEqual([]);
  });

  it("a key naming no primitive/procedure throws at resolve time", () => {
    expect(() =>
      resolveExpose(buildSpec(), {
        nope: "resource",
      } as Record<string, "resource">),
    ).toThrow(/no such/);
    expect(() =>
      resolveExpose(buildSpec(), {
        "counter.nonexistent": "tool",
      } as Record<string, "tool">),
    ).toThrow(/no such procedure/);
  });

  it("mis-tagging a primitive as a tool throws", () => {
    expect(() =>
      resolveExpose(buildSpec(), {
        count: "tool",
      } as unknown as Record<string, "tool">),
    ).toThrow(/must be exposed as "resource"/);
  });

  it("mis-tagging a procedure as a resource throws", () => {
    expect(() =>
      resolveExpose(buildSpec(), {
        "counter.bump": "resource",
      } as unknown as Record<string, "resource">),
    ).toThrow(/procedures map to tools/);
  });

  it("an input-bearing stream can't be exposed as a static resource (F1)", () => {
    const spec = defineSurface({
      streams: {
        // Requires an `{ id }` — no value can be passed at a static resource
        // read, so this exposure is rejected at boot.
        nodeLog: {
          inputSchema: z.object({ id: z.string() }),
          outputSchema: z.string(),
        },
        // A void-input stream is fine.
        ticks: { inputSchema: z.void(), outputSchema: z.number() },
      },
    }).spec;

    expect(() => resolveExpose(spec, { nodeLog: "resource" })).toThrow(
      /requires an input/,
    );
    // The void-input stream still resolves.
    expect(resolveExpose(spec, { ticks: "resource" }).resources).toHaveLength(
      1,
    );
  });

  it("an input-bearing event can't be exposed as a static resource (F1)", () => {
    const spec = defineSurface({
      events: {
        // Requires an `{ id }` — its subscribe path would call `.get(undefined)`
        // and fail validation, so this exposure is rejected at boot (the same
        // gate streams take).
        terminalExit: {
          inputSchema: z.object({ id: z.string() }),
          outputSchema: z.number(),
        },
        // A void-input event is fine.
        exited: { inputSchema: z.void(), outputSchema: z.number() },
      },
    }).spec;

    expect(() => resolveExpose(spec, { terminalExit: "resource" })).toThrow(
      /requires an input/,
    );
    // The void-input event still resolves.
    expect(resolveExpose(spec, { exited: "resource" }).resources).toHaveLength(
      1,
    );
  });

  it("carries the collection key schema on the item template (F9)", () => {
    const spec = defineSurface({
      collections: {
        // A NON-string key — the item-template read must decode the URI's
        // string `<id>` through this schema before `.get({ key })`.
        rows: { keySchema: z.number(), schema: z.object({ v: z.string() }) },
      },
    }).spec;

    const r = resolveExpose(spec, { rows: "resource" });
    const tmpl = r.resourceTemplates[0];
    if (tmpl === undefined) throw new Error("expected one item template");
    expect(tmpl.key).toBe("rows");
    // The schema round-trips a numeric key from its JSON form.
    expect(tmpl.keySchema.safeParse(42).success).toBe(true);
    expect(tmpl.keySchema.safeParse("42").success).toBe(false);
  });

  it("an exposed procedure carries its wrapped flag (F3)", () => {
    const spec = defineSurface({
      procedures: {
        echo: {
          // A scalar input — advertised wrapped under `value`.
          shout: { input: z.string(), output: z.string() },
          // An object input — not wrapped.
          tag: { input: z.object({ k: z.string() }), output: z.string() },
        },
      },
    }).spec;

    const r = resolveExpose(spec, { "echo.shout": "tool", "echo.tag": "tool" });
    const shout = r.tools.find((t) => t.name === "echo_shout");
    const tag = r.tools.find((t) => t.name === "echo_tag");
    expect(shout?.wrapped).toBe(true);
    expect(tag?.wrapped).toBe(false);
  });
});

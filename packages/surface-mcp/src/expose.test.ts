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

  it("default-deny: only listed procedures become tools, with mutates flagged", () => {
    const r = resolveExpose(buildSpec(), {
      "counter.bump": { tool: { mutates: true } },
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
        { name: "counter_add", mutates: false, hasInput: true },
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
});

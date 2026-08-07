/**
 * `resolveExpose` — the default-deny resolver. Pins that omission means
 * not-exposed, that each primitive kind maps to the right URI shape, that a
 * mutating procedure carries its flag, and that a key naming nothing in the
 * spec is a boot-time error (not a silent no-op).
 */

import { defineSurface } from "@kolu/surface/define";
import { Option, Schema } from "effect";
import { describe, expect, it } from "vitest";
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
    cells: { count: { schema: Schema.Finite, default: 0 } },
    collections: {
      notes: {
        keySchema: Schema.String,
        schema: Schema.Struct({ body: Schema.String }),
      },
    },
    streams: {
      ticks: { inputSchema: Schema.Void, outputSchema: Schema.Finite },
    },
    events: {
      exited: { inputSchema: Schema.Void, outputSchema: Schema.Finite },
    },
    procedures: {
      counter: {
        bump: { output: Schema.Finite },
        add: {
          input: Schema.Struct({ n: Schema.Finite }),
          output: Schema.Finite,
        },
      },
      admin: { nuke: { output: Schema.Boolean } },
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

  it("a no-input procedure advertises an EMPTY object, not a `value: null` demand", () => {
    // `defineSurface` gives a no-input procedure `Schema.Void`, whose encoded form
    // is `{"type":"null"}` — the divergence D8 item 3 exists for. Pinned end-to-end
    // through `resolveExpose` (not only in `jsonschema.test.ts`) because this is
    // the path an actual MCP host reads.
    const r = resolveExpose(buildSpec(), { "counter.bump": "tool" });
    expect(r.tools[0]?.inputSchema).toEqual({ type: "object", properties: {} });
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
          inputSchema: Schema.Struct({ id: Schema.String }),
          outputSchema: Schema.String,
        },
        // A void-input stream is fine.
        ticks: { inputSchema: Schema.Void, outputSchema: Schema.Finite },
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
          inputSchema: Schema.Struct({ id: Schema.String }),
          outputSchema: Schema.Finite,
        },
        // A void-input event is fine.
        exited: { inputSchema: Schema.Void, outputSchema: Schema.Finite },
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
        rows: {
          keySchema: Schema.Finite,
          schema: Schema.Struct({ v: Schema.String }),
        },
      },
    }).spec;

    const r = resolveExpose(spec, { rows: "resource" });
    const tmpl = r.resourceTemplates[0];
    if (tmpl === undefined) throw new Error("expected one item template");
    expect(tmpl.key).toBe("rows");
    // The schema round-trips a numeric key from its JSON form, and refuses the
    // raw URI segment — which is exactly why `decodeKey` needs the JSON fallback.
    const decode = Schema.decodeUnknownOption(tmpl.keySchema);
    expect(Option.isSome(decode(42))).toBe(true);
    expect(Option.isSome(decode("42"))).toBe(false);
  });

  it("an exposed procedure carries its wrapped flag (F3)", () => {
    const spec = defineSurface({
      procedures: {
        echo: {
          // A scalar input — advertised wrapped under `value`.
          shout: { input: Schema.String, output: Schema.String },
          // An object input — not wrapped.
          tag: {
            input: Schema.Struct({ k: Schema.String }),
            output: Schema.String,
          },
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

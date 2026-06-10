/**
 * `toInputSchema` — the zod → JSON-Schema glue. These pins are the
 * zod-version seam (the option defaults shift between 4.3.x and 4.4): a
 * regression here ships a tool whose `inputSchema` an MCP client rejects.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { inputSchema, toInputSchema } from "./jsonschema";

describe("toInputSchema", () => {
  it("no schema → empty object schema (a no-arg procedure)", () => {
    expect(toInputSchema()).toEqual({ type: "object", properties: {} });
  });

  it("a defaulted field is NOT required (io:input)", () => {
    const schema = z.object({
      strict: z.boolean().default(true),
      name: z.string(),
    });
    const out = toInputSchema(schema);
    expect(out.type).toBe("object");
    // `name` has no default → required; `strict` defaults → not required.
    expect(out.required).toEqual(["name"]);
    const props = out.properties as Record<string, unknown>;
    expect(props.strict).toMatchObject({ type: "boolean", default: true });
  });

  it("inlines a $ref for a reused (meta-id) nested object — no $ref/$defs left", () => {
    const Inner = z.object({ x: z.number() }).meta({ id: "Inner" });
    const Outer = z.object({ a: Inner, b: Inner });
    const out = toInputSchema(Outer);

    const json = JSON.stringify(out);
    expect(json).not.toContain("$ref");
    expect(json).not.toContain("$defs");
    expect(json).not.toContain("definitions");

    const props = out.properties as Record<string, Record<string, unknown>>;
    // Both `a` and `b` carry the full inlined Inner object.
    expect(props.a).toMatchObject({
      type: "object",
      properties: { x: { type: "number" } },
    });
    expect(props.b).toMatchObject({
      type: "object",
      properties: { x: { type: "number" } },
    });
  });

  it("a recursive schema doesn't crash and emits no $ref", () => {
    const Node = z.object({
      name: z.string(),
      get next() {
        return Node.optional();
      },
    });
    const out = toInputSchema(Node);
    const json = JSON.stringify(out);
    // The recursive `next` property is dropped (an un-inlinable self-ref);
    // the schema is still a valid object with `name`.
    expect(json).not.toContain("$ref");
    expect(out.type).toBe("object");
    const props = out.properties as Record<string, unknown>;
    expect(props.name).toMatchObject({ type: "string" });
    expect("next" in props).toBe(false);
    // `name` was required and survives; `next` (if it had been required) is
    // pruned — required must only name present properties.
    if (Array.isArray(out.required)) {
      for (const r of out.required) expect(r in props).toBe(true);
    }
  });

  it("z.date() degrades (unrepresentable:any) rather than throwing", () => {
    const schema = z.object({ when: z.date(), label: z.string() });
    expect(() => toInputSchema(schema)).not.toThrow();
    const out = toInputSchema(schema);
    const props = out.properties as Record<string, unknown>;
    // The date degrades to an accept-anything `{}` rather than blanking the
    // field; `label` is unaffected.
    expect(props.when).toEqual({});
    expect(props.label).toMatchObject({ type: "string" });
  });

  it("wraps a top-level non-object input under `value`", () => {
    const out = toInputSchema(z.string());
    expect(out.type).toBe("object");
    const props = out.properties as Record<string, unknown>;
    expect(props.value).toMatchObject({ type: "string" });
    expect(out.required).toEqual(["value"]);
  });

  it("wraps a top-level array input under `value`", () => {
    const out = toInputSchema(z.array(z.string()));
    expect(out.type).toBe("object");
    const props = out.properties as Record<string, unknown>;
    expect(props.value).toMatchObject({ type: "array" });
  });

  it("strips $schema metadata from the top level", () => {
    const out = toInputSchema(z.object({ a: z.number() }));
    expect("$schema" in out).toBe(false);
  });

  it("prunes required for a recursive property dropped under a NESTED object (F11)", () => {
    // The recursive schema sits under a nested `wrapper` object, not the root.
    // When its self-ref `child` property is dropped, the NESTED object's
    // `required` must not still name `child`.
    const Node = z.object({
      label: z.string(),
      get child() {
        return Node;
      },
    });
    const schema = z.object({ wrapper: z.object({ inner: Node }) });
    const out = toInputSchema(schema);
    const json = JSON.stringify(out);
    expect(json).not.toContain("$ref");

    // Walk every object node — no `required` entry may name an absent property.
    const checkNode = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      const props = obj.properties as Record<string, unknown> | undefined;
      if (Array.isArray(obj.required) && props !== undefined) {
        for (const name of obj.required) {
          expect(name in props).toBe(true);
        }
      }
      for (const v of Object.values(obj)) checkNode(v);
      if (props) for (const v of Object.values(props)) checkNode(v);
    };
    checkNode(out);
  });

  it("inputSchema reports whether a non-object input was wrapped (F3)", () => {
    // A scalar/array/union is wrapped under `value` → wrapped: true.
    expect(inputSchema(z.string()).wrapped).toBe(true);
    expect(inputSchema(z.array(z.number())).wrapped).toBe(true);
    // An object input and a no-arg procedure are NOT wrapped.
    expect(inputSchema(z.object({ a: z.number() })).wrapped).toBe(false);
    expect(inputSchema(undefined).wrapped).toBe(false);
  });
});

import { PLACEMENT_REQUIRED } from "@kolu/padi-client/surface";
import { toInputSchema } from "@kolu/surface-mcp";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CreateArgsSchema } from "./create.ts";
import { ScreenTextArgsSchema } from "./screenText.ts";
import { SendInputArgsSchema } from "./sendInput.ts";
import {
  WaitAgentStateArgsSchema,
  WaitOutputSettledArgsSchema,
} from "./wait.ts";
import { WatchNextArgsSchema } from "./watchNext.ts";
import { WatchOpenArgsSchema } from "./watchOpen.ts";

type JsonNode = Record<string, unknown>;

function propertyDescriptions(schema: JsonNode): JsonNode {
  const props = schema.properties as Record<string, JsonNode>;
  return Object.fromEntries(
    Object.entries(props).map(([name, node]) => [name, node.description]),
  );
}

function property(schema: JsonNode, name: string): JsonNode {
  return (schema.properties as Record<string, JsonNode>)[name] as JsonNode;
}

describe("the description ANNOTATION reaches the property node", () => {
  it("reaches the node from EITHER spelling — the annotate-first trap is gone", () => {
    const first = toInputSchema(
      Schema.Struct({
        n: Schema.Number.annotate({ description: "blurb" }).check(
          Schema.isInt(),
        ),
      }),
    );
    expect(first).toEqual({
      type: "object",
      properties: {
        n: {
          description: "blurb",
          type: "integer",
          minimum: -Number.MAX_SAFE_INTEGER,
          maximum: Number.MAX_SAFE_INTEGER,
        },
      },
      required: ["n"],
    });

    expect(
      toInputSchema(
        Schema.Struct({ n: Schema.Int.annotate({ description: "blurb" }) }),
      ),
    ).toEqual({
      type: "object",
      properties: {
        n: {
          type: "integer",
          description: "blurb",
          minimum: -Number.MAX_SAFE_INTEGER,
          maximum: Number.MAX_SAFE_INTEGER,
        },
      },
      required: ["n"],
    });
  });

  it("compacts a check's BOUNDS onto the node, where a host reads them", () => {
    const doc = toInputSchema(
      Schema.Struct({
        n: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThan(10)),
        s: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8)),
      }),
    );
    expect(doc.properties).toEqual({
      n: { type: "integer", exclusiveMinimum: 0, exclusiveMaximum: 10 },
      s: { type: "string", minLength: 1, maxLength: 8 },
    });
    expect(property(doc, "n").allOf).toBe(undefined);
    expect(property(doc, "s").allOf).toBe(undefined);
  });
});

describe("screen_text args → the JSON Schema a host reads", () => {
  it("BYTE FIXTURE: the exact document, blurbs and all", () => {
    expect(JSON.stringify(toInputSchema(ScreenTextArgsSchema))).toBe(
      JSON.stringify({
        type: "object",
        properties: {
          id: {
            type: "string",
            pattern:
              "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$",
            format: "uuid",
          },
          tail: {
            type: "integer",
            maximum: Number.MAX_SAFE_INTEGER,
            exclusiveMinimum: 0,
            description:
              "Return only the last N lines (omit for the whole scrollback).",
          },
        },
        required: ["id"],
      }),
    );
  });
});

describe("lifecycle_sendInput args → the JSON Schema a host reads", () => {
  it("both optional fields carry their blurb (the annotation is INSIDE optionalKey)", () => {
    const doc = toInputSchema(SendInputArgsSchema);
    const described = propertyDescriptions(doc);
    expect(described.text).toMatch(/NEVER carries the submit/);
    expect(described.key).toMatch(/Mutually exclusive with text/);
    expect(doc.required).toEqual(["id"]);
  });
});

describe("lifecycle_create args → the JSON Schema a host reads", () => {
  it("the directory fields carry their blurb ON the node, checks and all", () => {
    const doc = toInputSchema(CreateArgsSchema);
    const described = propertyDescriptions(doc);
    expect(described.worktree).toMatch(/<repo>\/\.worktrees\/<name>/);
    expect(described.repo).toMatch(/Absolute path/);
    expect(described.run).toMatch(/not a spawn argv/);
    expect(property(doc, "worktree").minLength).toBe(1);
    expect(property(doc, "worktree").allOf).toBe(undefined);
  });

  it("advertises `placement` as the ONE required field, both spellings and the rule", () => {
    const doc = toInputSchema(CreateArgsSchema);
    expect(doc.required).toEqual(["placement"]);
    const described = propertyDescriptions(doc);
    expect(described.placement).toBe(PLACEMENT_REQUIRED);
    expect(described.placement).toContain('{"kind":"toplevel"}');
    expect(described.placement).toContain('"kind":"child-of"');
    const arms = property(doc, "placement").anyOf as JsonNode[] | undefined;
    expect(arms, "placement advertises its two arms").toHaveLength(2);
  });

  it("advertises the create verb's own fields, so the tool cannot drift from the wire", () => {
    const props = toInputSchema(CreateArgsSchema).properties as JsonNode;
    for (const field of ["placement", "cwd", "intent"]) {
      expect(Object.hasOwn(props, field), `${field} is advertised`).toBe(true);
    }
    for (const field of ["repo", "worktree", "run"]) {
      expect(Object.hasOwn(props, field), `${field} is advertised`).toBe(true);
    }
    expect(Object.hasOwn(props, "parentId")).toBe(false);
  });
});

describe("the wait tools' args → the JSON Schema a host reads", () => {
  it("every milliseconds field is a bounded INTEGER, never the NaN-tolerant union", () => {
    const settled = toInputSchema(WaitOutputSettledArgsSchema);
    for (const field of ["idleMs", "timeoutMs"]) {
      const node = property(settled, field);
      expect(node.type, `${field} must advertise as an integer`).toBe(
        "integer",
      );
      expect(node.anyOf, `${field} must not offer "NaN"/"Infinity"`).toBe(
        undefined,
      );
      expect(node.exclusiveMinimum).toBe(0);
      expect(node.maximum).toBe(2_147_483_647);
      expect(node.allOf).toBe(undefined);
      expect(typeof node.description).toBe("string");
    }
    expect(settled.required).toEqual(["id", "idleMs"]);
  });

  it("the kolu#2139 modifiers advertise as bounded integers with their blurb ON the node", () => {
    const agent = toInputSchema(WaitAgentStateArgsSchema);
    const settledMs = property(agent, "settledMs");
    expect(settledMs.type).toBe("integer");
    expect(settledMs.exclusiveMinimum).toBe(0);
    expect(settledMs.maximum).toBe(2_147_483_647);
    expect(settledMs.description).toMatch(/CONJUNCT/);

    for (const schema of [agent, toInputSchema(WaitOutputSettledArgsSchema)]) {
      const tail = property(schema, "screenTail");
      expect(tail.type).toBe("integer");
      expect(tail.exclusiveMinimum).toBe(0);
      expect(tail.description).toMatch(/last N rendered lines/);
    }

    expect(agent.required).toEqual(["id", "until"]);
  });

  it("wait_outputSettled does NOT offer a redundant second quiescence window", () => {
    const settled = toInputSchema(WaitOutputSettledArgsSchema);
    expect(Object.keys(settled.properties ?? {})).not.toContain("settledMs");
  });

  it("watch_next's timeoutMs rides the SAME shared milliseconds field", () => {
    const node = property(toInputSchema(WatchNextArgsSchema), "timeoutMs");
    expect(node.type).toBe("integer");
    expect(node.anyOf).toBe(undefined);
    expect(node.exclusiveMinimum).toBe(0);
    expect(node.maximum).toBe(2_147_483_647);
    expect(typeof node.description).toBe("string");
    const after = property(toInputSchema(WatchNextArgsSchema), "after");
    expect(after.type).toBe("integer");
    expect(after.minimum).toBe(0);
    expect(typeof after.description).toBe("string");
    const name = property(toInputSchema(WatchNextArgsSchema), "name");
    expect(name.type).toBe("string");
    expect(name.minLength).toBe(1);
    expect(name.maxLength).toBe(128);
    expect(typeof name.description).toBe("string");
  });

  it("watch_open advertises ignoreIds and ignoreSelf on the property node", () => {
    const schema = toInputSchema(WatchOpenArgsSchema);
    const ignoreIds = property(schema, "ignoreIds");
    expect(ignoreIds.type).toBe("array");
    expect(typeof ignoreIds.description).toBe("string");
    expect(ignoreIds.description).toMatch(/Fail-open/);
    const ignoreSelf = property(schema, "ignoreSelf");
    expect(ignoreSelf.type).toBe("boolean");
    expect(typeof ignoreSelf.description).toBe("string");
    expect(ignoreSelf.description).toMatch(/KAVAL_TERMINAL_ID/);
    expect(schema.required).toEqual(["name"]);
  });

  it("wait_agentState advertises the five buckets as a literal enum", () => {
    const until = property(toInputSchema(WaitAgentStateArgsSchema), "until");
    expect(until.type).toBe("array");
    expect(until.items).toEqual({
      type: "string",
      enum: ["working", "awaiting", "waiting", "starting", "fresh"],
    });
    expect(until.minItems).toBe(1);
    expect(until.description).toMatch(/working \(thinking\/tool_use\)/);
  });

  it("no tool input is CLOSED — a host sending an extra key is not rejected", () => {
    for (const schema of [
      CreateArgsSchema,
      ScreenTextArgsSchema,
      SendInputArgsSchema,
      WaitOutputSettledArgsSchema,
      WaitAgentStateArgsSchema,
    ]) {
      expect(toInputSchema(schema).additionalProperties).toBe(undefined);
    }
  });
});

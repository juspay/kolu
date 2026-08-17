/**
 * The bespoke tools' ARG SCHEMAS, pinned at the only place they matter:
 * the JSON Schema an MCP host reads out of `tools/list`.
 *
 * These schemas exist to be *rendered*, not just decoded — the per-field blurb
 * is how a coding agent learns that `tail` counts lines and that `text` must
 * never carry the submit. Under zod the blurb was `.describe()`; under Effect
 * Schema it is the `description` ANNOTATION, and TWO placement rules decide
 * whether it survives the converter:
 *
 *   1. it must sit on the ENCODED-side node — INSIDE `optionalKey`, before any
 *      wrapper (`@kolu/surface-mcp`'s `jsonschema.ts` law); and
 *   2. **annotate first, check second.** `SchemaAST.annotate` attaches to a
 *      schema's LAST CHECK when it has one, and a check's annotations are
 *      emitted inside an `allOf` branch — legal JSON Schema that no MCP host
 *      reads as the property's description. `Schema.Int` is itself
 *      `Schema.Number.check(isInt())`, so it is already "checked" and a bare
 *      `Schema.Int.annotate({description})` loses the blurb.
 *
 * Both failures are invisible in a decode test and very visible to an agent, so
 * the placement is pinned here — including the losing spelling, so the trap
 * cannot come back silently (the same discipline `jsonschema.test.ts` applies
 * to the `default` keyword).
 *
 * Two more laws ride along:
 *   - an MCP-facing numeric advertises as `integer`/`number`, never as bare
 *     `Schema.Number` (whose encoded form also admits the STRINGS `"NaN"` /
 *     `"Infinity"`, which a host will happily offer the agent);
 *   - a tool input stays OPEN (no `additionalProperties: false`).
 *
 * MCP `tools/list` JSON Schema is on the byte-compat hit list, so the first
 * assertion is a byte-level fixture over the exact serialized string.
 */

import { PLACEMENT_REQUIRED, SUBMIT_SETTLE_MS } from "@kolu/padi/surface";
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

type JsonNode = Record<string, unknown>;

/** The `description` each property advertises AT ITS OWN NODE — what a host
 *  renders per field, and the thing an `allOf`-buried annotation is not. */
function propertyDescriptions(schema: JsonNode): JsonNode {
  const props = schema.properties as Record<string, JsonNode>;
  return Object.fromEntries(
    Object.entries(props).map(([name, node]) => [name, node.description]),
  );
}

/** One property's node. */
function property(schema: JsonNode, name: string): JsonNode {
  return (schema.properties as Record<string, JsonNode>)[name] as JsonNode;
}

describe("the description ANNOTATION reaches the property node", () => {
  it("annotate-then-check keeps the blurb on the node; check-then-annotate buries it in allOf", () => {
    // The winning spelling — the blurb is the property's own `description`,
    // which is the only place an MCP host renders it.
    const kept = toInputSchema(
      Schema.Struct({
        n: Schema.Number.annotate({ description: "blurb" }).check(
          Schema.isInt(),
        ),
      }),
    );
    expect(kept).toEqual({
      type: "object",
      properties: { n: { description: "blurb", type: "integer" } },
      required: ["n"],
    });

    // The losing spelling, pinned so the trap cannot return unnoticed:
    // `Schema.Int` already carries a check, so `.annotate` lands ON THE CHECK
    // and the converter emits it inside `allOf` — no top-level `description`.
    const buried = toInputSchema(
      Schema.Struct({ n: Schema.Int.annotate({ description: "blurb" }) }),
    );
    const buriedNode = (buried.properties as Record<string, JsonNode>)
      .n as JsonNode;
    expect(buriedNode.description).toBe(undefined);
    expect(buriedNode.allOf).toEqual([{ description: "blurb" }]);
  });
});

describe("screen_text args → the JSON Schema a host reads", () => {
  it("BYTE FIXTURE: the exact document, blurbs and all", () => {
    // Byte-level, not decode-equality: this string is the wire an MCP host
    // parses (hit-list rule). `tail` is an INTEGER (not the NaN-tolerant union),
    // the object is OPEN (no `additionalProperties`), and `tail` is absent from
    // `required` because it is an `optionalKey`. The `allOf` carries the bound
    // the base node had no room for; the blurb and the type do NOT ride there.
    expect(JSON.stringify(toInputSchema(ScreenTextArgsSchema))).toBe(
      JSON.stringify({
        type: "object",
        properties: {
          id: {
            type: "string",
            allOf: [
              {
                pattern:
                  "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$",
                format: "uuid",
              },
            ],
          },
          tail: {
            description:
              "Return only the last N lines (omit for the whole scrollback).",
            type: "integer",
            allOf: [{ exclusiveMinimum: 0 }],
          },
        },
        required: ["id"],
      }),
    );
  });
});

describe("lifecycle_sendInput args → the JSON Schema a host reads", () => {
  it("every optional field carries its blurb (the annotation is INSIDE optionalKey)", () => {
    const doc = toInputSchema(SendInputArgsSchema);
    const described = propertyDescriptions(doc);
    expect(described.text).toMatch(/submit: true/);
    expect(described.key).toMatch(/Mutually exclusive with text/);
    expect(described.submit).toMatch(/wait for the target's prompt to be IDLE/);
    // Every combination gate lives in `resolveSendAction`, not in the schema —
    // so every field but `id` stays optional and none is required.
    expect(doc.required).toEqual(["id"]);
  });

  it("settleMs is annotate-first, so its blurb survives the checks", () => {
    // The `allOf` trap `MillisecondsSchema` documents: a blurb attached AFTER a
    // check lands inside an `allOf` branch, where no host renders it. This field
    // carries two checks, so it is the one on this tool that would lose it.
    const doc = toInputSchema(SendInputArgsSchema);
    expect(propertyDescriptions(doc).settleMs).toMatch(
      new RegExp(`Default ${SUBMIT_SETTLE_MS}`),
    );
    expect(property(doc, "settleMs")).toMatchObject({ type: "integer" });
  });
});

describe("lifecycle_create args → the JSON Schema a host reads", () => {
  it("the directory fields carry their blurb ON the node, checks and all", () => {
    const doc = toInputSchema(CreateArgsSchema);
    const described = propertyDescriptions(doc);
    // `worktree` is the one that would lose its blurb to `allOf`: it carries
    // the wire's git-ref CHECK, so it is spelled annotate-first.
    expect(described.worktree).toMatch(/<repo>\/\.worktrees\/<name>/);
    expect(described.repo).toMatch(/Absolute path/);
    expect(described.run).toMatch(/not a spawn argv/);
    expect(described.message).toMatch(/reaches its prompt/);
    // …and the check really is there, beside the blurb rather than instead of
    // it — an agent's name is validated before the tool dials padi.
    expect(property(doc, "worktree").allOf).toBeDefined();
  });

  it("advertises `placement` as the ONE required field, both spellings and the rule", () => {
    const doc = toInputSchema(CreateArgsSchema);
    // The whole point, read off the JSON Schema an MCP host actually sends to a
    // model: an agent that never chose a placement cannot produce a valid call,
    // and the host itself will say so before a byte reaches padi.
    expect(doc.required).toEqual(["placement"]);
    // The blurb is the WIRE's own sentence (`PLACEMENT_REQUIRED`), not a second
    // copy: what the agent reads in the schema and what it reads in the refusal
    // are the same string.
    const described = propertyDescriptions(doc);
    expect(described.placement).toBe(PLACEMENT_REQUIRED);
    expect(described.placement).toContain('{"kind":"toplevel"}');
    expect(described.placement).toContain('"kind":"child-of"');
    // Both arms survive the converter, so a host can offer the model the choice
    // structurally rather than by reading English.
    const arms = property(doc, "placement").anyOf as JsonNode[] | undefined;
    expect(arms, "placement advertises its two arms").toHaveLength(2);
  });

  it("advertises the create verb's own fields, so the tool cannot drift from the wire", () => {
    const props = toInputSchema(CreateArgsSchema).properties as JsonNode;
    // Spread from `PadiCreateInputSchema` — the wire's placement/cwd/intent…
    for (const field of ["placement", "cwd", "intent"]) {
      expect(Object.hasOwn(props, field), `${field} is advertised`).toBe(true);
    }
    // …plus this face's three additions.
    for (const field of ["repo", "worktree", "run"]) {
      expect(Object.hasOwn(props, field), `${field} is advertised`).toBe(true);
    }
    // `parentId` is NOT a field of its own any more — it lives inside the
    // placement sum's `child-of` arm, which is what makes "a parent" and "no
    // parent" two statements rather than a value and its absence.
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
      // The bounds: positive, and inside the setTimeout ceiling `runWait` and
      // `awaitOutputSettled` both enforce at runtime.
      expect(node.allOf).toEqual([
        { exclusiveMinimum: 0 },
        { maximum: 2_147_483_647 },
      ]);
      expect(typeof node.description).toBe("string");
    }
    // `idleMs` is the one required knob; the rest are optional.
    expect(settled.required).toEqual(["id", "idleMs"]);
  });

  it("the kolu#2139 modifiers advertise as bounded integers with their blurb ON the node", () => {
    // A wire-visible option is only as good as the sentence a host renders
    // beside it — an agent picks `settledMs: 15000` from the blurb or not at
    // all. Same annotate-then-check law as every other numeric here.
    const agent = toInputSchema(WaitAgentStateArgsSchema);
    const settledMs = property(agent, "settledMs");
    expect(settledMs.type).toBe("integer");
    expect(settledMs.allOf).toEqual([
      { exclusiveMinimum: 0 },
      { maximum: 2_147_483_647 },
    ]);
    expect(settledMs.description).toMatch(/CONJUNCT/);

    // `screenTail` counts LINES, so it rides the line bound, not the timer
    // ceiling — and it is on BOTH wait tools, because reading the screen after
    // a done-signal is the second half of the same race on either.
    for (const schema of [agent, toInputSchema(WaitOutputSettledArgsSchema)]) {
      const tail = property(schema, "screenTail");
      expect(tail.type).toBe("integer");
      expect(tail.allOf).toEqual([{ exclusiveMinimum: 0 }]);
      expect(tail.description).toMatch(/last N rendered lines/);
    }

    // Both stay OPTIONAL: every existing caller's request is still valid, and
    // its met frame still has exactly the keys it always had.
    expect(agent.required).toEqual(["id", "until"]);
  });

  // `settledMs` is deliberately NOT on `wait_outputSettled`: that condition IS a
  // quiescence window, so a second one only ever means quiet-for-max(idleMs,
  // settledMs) — a knob whose every setting `idleMs` already spells.
  it("wait_outputSettled does NOT offer a redundant second quiescence window", () => {
    const settled = toInputSchema(WaitOutputSettledArgsSchema);
    expect(Object.keys(settled.properties ?? {})).not.toContain("settledMs");
  });

  it("watch_next's timeoutMs rides the SAME shared milliseconds field", () => {
    // It re-derived this shape once, which left the package's third bespoke
    // tool the only one doing the annotate-then-check dance unpinned by this
    // file. It now reuses `MillisecondsSchema`, so it is covered here for free.
    const node = property(toInputSchema(WatchNextArgsSchema), "timeoutMs");
    expect(node.type).toBe("integer");
    expect(node.anyOf).toBe(undefined);
    expect(node.allOf).toEqual([
      { exclusiveMinimum: 0 },
      { maximum: 2_147_483_647 },
    ]);
    expect(typeof node.description).toBe("string");
    // `after` is an acknowledgement watermark, so ZERO is legal where a
    // duration's zero is not — and its blurb must be ON THE NODE, not buried in
    // the `allOf` branch (reusing padi's already-checked `NonNegativeInt` put it
    // there, which this assertion caught).
    const after = property(toInputSchema(WatchNextArgsSchema), "after");
    expect(after.type).toBe("integer");
    expect(after.allOf).toEqual([{ minimum: 0 }]);
    expect(typeof after.description).toBe("string");
    // Same for the name: bounded, and its blurb readable by a host.
    const name = property(toInputSchema(WatchNextArgsSchema), "name");
    expect(name.type).toBe("string");
    expect(name.allOf).toEqual([{ minLength: 1 }, { maxLength: 128 }]);
    expect(typeof name.description).toBe("string");
  });

  it("wait_agentState advertises the three buckets as a literal enum", () => {
    const until = property(toInputSchema(WaitAgentStateArgsSchema), "until");
    expect(until.type).toBe("array");
    expect(until.items).toEqual({
      type: "string",
      enum: ["working", "awaiting", "waiting"],
    });
    expect(until.allOf).toEqual([{ minItems: 1 }]);
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

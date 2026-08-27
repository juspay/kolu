/**
 * The bespoke tools' ARG SCHEMAS, pinned at the only place they matter:
 * the JSON Schema an MCP host reads out of `tools/list`.
 *
 * These schemas exist to be *rendered*, not just decoded — the per-field blurb
 * is how a coding agent learns that `tail` counts lines and that `text` must
 * never carry the submit. Under zod the blurb was `.describe()`; under Effect
 * Schema it is the `description` ANNOTATION, and ONE placement rule decides
 * whether it survives the converter: it must sit on the ENCODED-side node —
 * INSIDE `optionalKey`, before any wrapper (`@kolu/surface-mcp`'s
 * `jsonschema.ts` law).
 *
 * There used to be a second rule, "ANNOTATE FIRST, CHECK SECOND".
 * `SchemaAST.annotate` attaches to a schema's LAST CHECK when it has one, and
 * rc.110's converter emitted a check's annotations inside an
 * `allOf` branch — legal JSON Schema that no MCP host reads as the property's
 * description. `Schema.Int` is itself `Schema.Number.check(isInt())`, so a bare
 * `Schema.Int.annotate({description})` lost the blurb, and every arg schema in
 * this package had to be spelled annotate-first by hand.
 *
 * rc.111 COMPACTS check constraints onto the node they constrain
 * whenever the keywords do not collide, so the trap is gone: the blurb reaches
 * the property node in either spelling, and so do the bounds — `exclusiveMinimum`,
 * `maximum`, `minLength`, `minItems`, `pattern`, `format`. That is a
 * host-visible upgrade, not a cosmetic one: an `allOf`-buried bound is a bound
 * the model never reads, so the schemas below now advertise their constraints
 * where a host actually renders them. Both halves are pinned here — the blurb
 * on the node from an already-checked schema, and every bound beside it — so a
 * regression in either direction is a failing test rather than a silently worse
 * tools/list.
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
  it("reaches the node from EITHER spelling — the annotate-first trap is gone", () => {
    // Annotate-first: the blurb is the property's own `description`, which is
    // the only place an MCP host renders it.
    const first = toInputSchema(
      Schema.Struct({
        n: Schema.Number.annotate({ description: "blurb" }).check(
          Schema.isInt(),
        ),
      }),
    );
    expect(first).toEqual({
      type: "object",
      properties: { n: { description: "blurb", type: "integer" } },
      required: ["n"],
    });

    // Check-first — the spelling that USED to lose the blurb. `Schema.Int`
    // already carries a check, so `.annotate` lands ON THE CHECK; up to
    // rc.110 the converter emitted that inside an `allOf` branch and the
    // property node had no `description` at all. Since rc.111 the check is
    // compacted onto the node, blurb and all. Pinned so a regression that
    // re-buries it is a failing test rather than a quietly worse tools/list.
    expect(
      toInputSchema(
        Schema.Struct({ n: Schema.Int.annotate({ description: "blurb" }) }),
      ),
    ).toEqual({
      type: "object",
      properties: { n: { type: "integer", description: "blurb" } },
      required: ["n"],
    });
  });

  it("compacts a check's BOUNDS onto the node, where a host reads them", () => {
    // The other half of the same rc.111 change, and the one an agent feels:
    // a bound inside `allOf` is a bound the model is never shown. Every
    // keyword below used to ride an `allOf` branch.
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
    // Byte-level, not decode-equality: this string is the wire an MCP host
    // parses (hit-list rule). `tail` is an INTEGER (not the NaN-tolerant union),
    // the object is OPEN (no `additionalProperties`), and `tail` is absent from
    // `required` because it is an `optionalKey`. Every bound rides the node it
    // constrains — `id`'s uuid `pattern`/`format` and `tail`'s
    // `exclusiveMinimum` were an `allOf` branch until effect rc.111 compacted
    // them, which is the difference between a constraint a host renders and one
    // it silently drops.
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
            description:
              "Return only the last N lines (omit for the whole scrollback).",
            type: "integer",
            exclusiveMinimum: 0,
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
    // The XOR is enforced in `resolveSendInputData`, not in the schema — so
    // BOTH stay optional and neither is required.
    expect(doc.required).toEqual(["id"]);
  });
});

describe("lifecycle_create args → the JSON Schema a host reads", () => {
  it("the directory fields carry their blurb ON the node, checks and all", () => {
    const doc = toInputSchema(CreateArgsSchema);
    const described = propertyDescriptions(doc);
    // `worktree` is the one that used to lose its blurb to `allOf`: it carries
    // the wire's git-ref CHECK.
    expect(described.worktree).toMatch(/<repo>\/\.worktrees\/<name>/);
    expect(described.repo).toMatch(/Absolute path/);
    expect(described.run).toMatch(/not a spawn argv/);
    // …and the check really is there, beside the blurb rather than instead of
    // it — an agent's name is validated before the tool dials padi, and the
    // host can now say so before the model ever sends an empty string.
    expect(property(doc, "worktree").minLength).toBe(1);
    expect(property(doc, "worktree").allOf).toBe(undefined);
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
      // `awaitOutputSettled` both enforce at runtime — advertised ON the node,
      // so a host renders them beside the blurb instead of dropping an `allOf`.
      expect(node.exclusiveMinimum).toBe(0);
      expect(node.maximum).toBe(2_147_483_647);
      expect(node.allOf).toBe(undefined);
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
    expect(settledMs.exclusiveMinimum).toBe(0);
    expect(settledMs.maximum).toBe(2_147_483_647);
    expect(settledMs.description).toMatch(/CONJUNCT/);

    // `screenTail` counts LINES, so it rides the line bound, not the timer
    // ceiling — and it is on BOTH wait tools, because reading the screen after
    // a done-signal is the second half of the same race on either.
    for (const schema of [agent, toInputSchema(WaitOutputSettledArgsSchema)]) {
      const tail = property(schema, "screenTail");
      expect(tail.type).toBe("integer");
      expect(tail.exclusiveMinimum).toBe(0);
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
    // tool the only one unpinned by this file. It now reuses
    // `MillisecondsSchema`, so it is covered here for free.
    const node = property(toInputSchema(WatchNextArgsSchema), "timeoutMs");
    expect(node.type).toBe("integer");
    expect(node.anyOf).toBe(undefined);
    expect(node.exclusiveMinimum).toBe(0);
    expect(node.maximum).toBe(2_147_483_647);
    expect(typeof node.description).toBe("string");
    // `after` is an acknowledgement watermark, so ZERO is legal where a
    // duration's zero is not — and both the bound and the blurb sit on the
    // node a host renders.
    const after = property(toInputSchema(WatchNextArgsSchema), "after");
    expect(after.type).toBe("integer");
    expect(after.minimum).toBe(0);
    expect(typeof after.description).toBe("string");
    // Same for the name: bounded, and its blurb readable by a host.
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
    // Both optional — existing callers stay valid.
    expect(schema.required).toEqual(["name"]);
  });

  it("wait_agentState advertises the three buckets as a literal enum", () => {
    const until = property(toInputSchema(WaitAgentStateArgsSchema), "until");
    expect(until.type).toBe("array");
    expect(until.items).toEqual({
      type: "string",
      enum: ["working", "awaiting", "waiting"],
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

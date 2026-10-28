/**
 * The execute-path fence's COMPILE-TIME and SCHEMA half (the grep laws live in
 * `packages/tests/governance/restoreFence.test.ts`, beside the repo's other
 * file-level invariants).
 *
 * **PTY output is a sensor. Nothing that executes may read a value whose
 * provenance is PTY bytes.**
 *
 * A schema pin is stronger than a grep where it can be: the fold cannot be handed
 * a `commandRun` event at all, and the persisted memory has no key for a launch
 * line. A future feature must break the compile or add a schema field — both
 * reviewed — rather than quietly import the mark.
 */

import { describe, expect, it } from "vitest";
import { AgentMemorySchema, type TerminalEvent } from "./schema.ts";

describe("PTY output is a sensor — the execute-path fence", () => {
  it("compile-time: `TerminalEvent` has no commandRun arm to hand the fold", () => {
    type CommandRunArm = Extract<TerminalEvent, { kind: "commandRun" }>;
    const _pin: CommandRunArm extends never ? true : false = true;
    expect(_pin).toBe(true);
  });

  it("the agent event carries info + allowlisted argv as ONE value", () => {
    // The observation is a single value, so a same-identity sample that finally
    // reads the flags cannot be swallowed by an info-only dedup.
    type Observation = Extract<TerminalEvent, { kind: "agent" }>["agent"];
    type WithValue = Extract<Observation, { value: unknown }>;
    const _pin: WithValue["value"] extends {
      info: unknown;
      argv: readonly string[];
    } | null
      ? true
      : false = true;
    expect(_pin).toBe(true);
  });

  it("schema: the remembered memory pair has no launch line", () => {
    expect(Object.keys(AgentMemorySchema.fields).sort()).toEqual([
      "lastActivityAt",
      "promptedAt",
    ]);
  });
});

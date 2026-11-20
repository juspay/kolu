import { describe, expect, it } from "vitest";
import { AgentMemorySchema, type TerminalEvent } from "./schema.ts";

describe("PTY output is a sensor — the execute-path fence", () => {
  it("compile-time: `TerminalEvent` has no commandRun arm to hand the fold", () => {
    type CommandRunArm = Extract<TerminalEvent, { kind: "commandRun" }>;
    const _pin: CommandRunArm extends never ? true : false = true;
    expect(_pin).toBe(true);
  });

  it("the agent event carries info + allowlisted argv as ONE value", () => {
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

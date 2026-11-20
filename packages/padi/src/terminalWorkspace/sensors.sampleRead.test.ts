import type { AgentObservation } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { agentObservationEqual, observationFromSample } from "./sensors.ts";

const info = {
  kind: "claude-code" as const,
  state: "thinking" as const,
  sessionId: "22222222-2222-4222-8222-222222222222",
  model: null,
  summary: null,
  taskProgress: null,
  workflow: null,
  contextTokens: null,
  startedAt: null,
};

const mirror: AgentObservation = { info, argv: ["--model", "sonnet"] };

describe("observationFromSample — unread argv is not 'no flags'", () => {
  it("carries the mirror's flags across an unread sample for the same identity", () => {
    const resolved = observationFromSample({ info, argv: null }, mirror);
    expect(resolved).toEqual(mirror);
    expect(agentObservationEqual(mirror, resolved)).toBe(true);
  });

  it("a NEW identity with an unread argv records an empty list", () => {
    const other = {
      ...info,
      sessionId: "33333333-3333-4333-8333-333333333333",
    };
    expect(observationFromSample({ info: other, argv: null }, mirror)).toEqual({
      info: other,
      argv: [],
    });
  });

  it("a successful read REPLACES the flags (the dedup admits it)", () => {
    const next = { info, argv: ["--model", "opus"] };
    const resolved = observationFromSample(next, mirror);
    expect(resolved).toEqual(next);
    expect(agentObservationEqual(mirror, resolved)).toBe(false);
  });

  it("carries forward across a STATE tick with an unread argv (same identity)", () => {
    const moved = { ...info, state: "waiting" as const, contextTokens: 1234 };
    const resolved = observationFromSample({ info: moved, argv: null }, mirror);
    expect(resolved).toEqual({ info: moved, argv: mirror.argv });
  });

  it("records an empty list when there is no mirror yet", () => {
    expect(observationFromSample({ info, argv: null }, null)).toEqual({
      info,
      argv: [],
    });
  });

  it("a null sample (session ended) stays null", () => {
    expect(observationFromSample(null, mirror)).toBeNull();
    expect(agentObservationEqual(mirror, null)).toBe(false);
  });
});

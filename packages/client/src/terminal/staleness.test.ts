import type { AgentInfo } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { isStale } from "./staleness";

const HOUR = 60 * 60 * 1000;

const noAgent = null;
const working: AgentInfo = {
  kind: "claude-code",
  sessionId: "s1",
  state: "tool_use",
  model: null,
  contextTokens: null,
  summary: null,
  taskProgress: null,
};
const awaiting: AgentInfo = { ...working, state: "awaiting_user" };
const waiting: AgentInfo = { ...working, state: "waiting" };

describe("isStale", () => {
  const now = 10_000_000;

  it.each([
    {
      lastActivityAt: 0,
      agent: noAgent,
      thresholdMs: HOUR,
      expected: false,
      why: "lastActivityAt=0 → never observed, never stale",
    },
    {
      lastActivityAt: now - 30 * 60 * 1000,
      agent: noAgent,
      thresholdMs: HOUR,
      expected: false,
      why: "younger than threshold",
    },
    {
      lastActivityAt: now - HOUR,
      agent: noAgent,
      thresholdMs: HOUR,
      expected: false,
      why: "exactly at threshold (strict greater-than)",
    },
    {
      lastActivityAt: now - 24 * HOUR,
      agent: noAgent,
      thresholdMs: HOUR,
      expected: true,
      why: "older than threshold",
    },
    {
      lastActivityAt: now - 24 * HOUR,
      agent: noAgent,
      thresholdMs: null,
      expected: false,
      why: "feature off (threshold=null)",
    },
    {
      lastActivityAt: now - 24 * HOUR,
      agent: awaiting,
      thresholdMs: HOUR,
      expected: false,
      why: "awaiting_user agent is never stale even past threshold",
    },
    {
      lastActivityAt: now - 24 * HOUR,
      agent: waiting,
      thresholdMs: HOUR,
      expected: false,
      why: "waiting agent is never stale even past threshold",
    },
    {
      lastActivityAt: now - 24 * HOUR,
      agent: working,
      thresholdMs: HOUR,
      expected: true,
      why: "working (tool_use) agent still stales out past threshold",
    },
  ])("$why", ({ lastActivityAt, agent, thresholdMs, expected }) => {
    expect(isStale({ lastActivityAt, agent }, now, thresholdMs)).toBe(expected);
  });
});

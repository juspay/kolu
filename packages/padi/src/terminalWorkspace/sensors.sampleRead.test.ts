/**
 * The producer's SAMPLE-READ discipline (juspay/kolu#2326 review, blocking 2).
 *
 * "Could we read the OS?" is not "the process has no allowlisted flags". They
 * used to be one value: `liveArgv()` folded a failed/blind snapshot to `[]`, and
 * since the observation dedup key is the whole `{ info, argv }`, that transient
 * blip became a NEW observation — overwriting a good target with `argv: []`,
 * tripping the authored-fact fence, and hitting disk on the firehose the fence
 * exists to keep off it. A sleep inside that window froze a flagless target.
 *
 * Here the rule is pinned directly: an UNREAD argv (`null`) carries the mirror's
 * flags forward for the same identity, so the resolved observation is `===`-equal
 * to the mirror and `emitAgentValue` returns early — no event, no fold, no
 * authored write.
 */

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
    // The dedup gate: no event is emitted, so the fold sees nothing and the
    // authored record is never rewritten by a read failure.
    expect(agentObservationEqual(mirror, resolved)).toBe(true);
  });

  it("a NEW identity with an unread argv records an empty list", () => {
    // The identity is authoritative — withholding it would delay the agent
    // entirely. The flags arrive on a later sample, and the dedup key (the whole
    // observation) lets that later sample through.
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

  it("carries forward when there is no mirror yet", () => {
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

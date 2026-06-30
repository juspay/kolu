/**
 * `composeTerminalMetadata` (in `./surface.ts`) — the ONE join of a terminal's
 * two halves, the AUTHORED record + its OBSERVATION, into the unified
 * `TerminalMetadata`. Applied at the client read and at disk persist, never
 * served.
 *
 * These pin the load-bearing sleeping-arm invariants AFTER the awareness-derive-
 * store cutover: a sleeping terminal carries only the restore-relevant projection
 * of its observation (`cwd · git · pr` — `pr` rides it, restore-relevant now, no
 * frozen-pr special case), the churny `foreground` and lie-when-dead agent detail
 * are dropped, and the resume target rides the authored record's `restoreTarget`
 * (the discriminated resume value), joined with `location` + memory + client fields.
 */

import type { Observation } from "@kolu/terminal-workspace";
import { describe, expect, it } from "vitest";
import {
  type AgentInfo,
  type AuthoredActiveTerminal,
  type AuthoredSleepingTerminal,
  composeTerminalMetadata,
  LOCAL_LOCATION,
} from "./surface.ts";

const claude = (sessionId: string): AgentInfo => ({
  kind: "claude-code",
  state: "thinking",
  sessionId,
  model: null,
  summary: null,
  taskProgress: null,
  workflow: null,
  contextTokens: null,
  startedAt: null,
});

/** A full live observation with a resolved PR, a live agent, and a foreground
 *  process. `pr` is restore-relevant (survives onto a dormant tile); the agent
 *  DETAIL + `foreground` are lie-when-dead / churny and must not reach the
 *  sleeping wire. */
const observation = (over: Partial<Observation> = {}): Observation => ({
  cwd: "/repo",
  git: null,
  pr: { kind: "absent" },
  agent: claude("ses-A"),
  foreground: { name: "vim", title: null },
  ...over,
});

describe("composeTerminalMetadata — the sleeping arm is the restore-relevant projection", () => {
  it("the sleeping arm's pr comes from the OBSERVATION (restore-relevant, no frozen-pr special case)", () => {
    const authored: AuthoredSleepingTerminal = {
      location: LOCAL_LOCATION,
      lastActivityAt: 7,
      state: "sleeping",
      sleptAt: 123,
    };
    const wire = composeTerminalMetadata(
      authored,
      observation({ pr: { kind: "absent" } }),
    );
    if (wire.state !== "sleeping") throw new Error("expected sleeping arm");
    expect(wire.pr).toEqual({ kind: "absent" });
  });

  it("drops the live half (agent detail + foreground), keeping memory + the restore target", () => {
    const authored: AuthoredSleepingTerminal = {
      location: LOCAL_LOCATION,
      lastActivityAt: 7,
      lastAgentCommand: "claude",
      restoreTarget: {
        kind: "exact",
        command: "claude",
        agent: { kind: "claude-code", sessionId: "ses-A" },
      },
      state: "sleeping",
      sleptAt: 123,
    };
    const wire = composeTerminalMetadata(authored, observation());
    if (wire.state !== "sleeping") throw new Error("expected sleeping arm");
    // cwd survives; the live agent detail + foreground are gone.
    expect(wire.cwd).toBe("/repo");
    expect("agent" in wire).toBe(false);
    expect("foreground" in wire).toBe(false);
    // memory + the restore target rode the authored record onto the joined value.
    expect(wire.lastActivityAt).toBe(7);
    expect(wire.restoreTarget).toEqual({
      kind: "exact",
      command: "claude",
      agent: { kind: "claude-code", sessionId: "ses-A" },
    });
  });

  it("a quit-to-shell sleeping record carries a `none` restore target (bare shell)", () => {
    const authored: AuthoredSleepingTerminal = {
      location: LOCAL_LOCATION,
      lastActivityAt: 7,
      lastAgentCommand: "claude",
      restoreTarget: { kind: "none" },
      state: "sleeping",
      sleptAt: 123,
    };
    const wire = composeTerminalMetadata(
      authored,
      observation({ agent: null }),
    );
    if (wire.state !== "sleeping") throw new Error("expected sleeping arm");
    expect(wire.restoreTarget).toEqual({ kind: "none" });
  });

  it("the active arm carries the FULL observation — full agent detail + foreground", () => {
    const authored: AuthoredActiveTerminal = {
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      state: "active",
    };
    const wire = composeTerminalMetadata(authored, observation());
    if (wire.state !== "active") throw new Error("expected active arm");
    expect(wire.pr).toEqual({ kind: "absent" });
    expect(wire.agent).toEqual(claude("ses-A"));
    expect(wire.foreground).toEqual({ name: "vim", title: null });
  });
});

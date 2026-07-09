/**
 * Pins the DERIVED-count invariant on `PadiUrgency`: the wire type carries only
 * `awaitingIds`, never a parallel `awaiting` count that could disagree with it
 * (see `PadiUrgencySchema` in `./surface.ts`). `recomputeUrgency` folds the
 * registry into ids only; every reader derives the count as `.length` at its
 * own read site (`HostSelectorStrip.tsx`'s `awaiting()`).
 */

import type { AgentInfo, TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ActiveTerminalProcess,
  registerTerminal,
  unregisterTerminal,
} from "./terminal-registry.ts";
import { recomputeUrgency, urgencyEqual } from "./urgency.ts";
import { LOCAL_LOCATION } from "./vocab.ts";

function makeAgent(state: AgentInfo["state"]): AgentInfo {
  return {
    kind: "claude-code",
    state,
    sessionId: "s1",
    model: null,
    summary: null,
    taskProgress: null,
    workflow: null,
    contextTokens: null,
    startedAt: null,
  };
}

function fakeActive(
  id: string,
  agent: AgentInfo | null,
): ActiveTerminalProcess {
  const snapshot: TerminalSnapshot = {
    cwd: "/tmp",
    git: null,
    pr: { kind: "pending" },
    agent,
    foreground: null,
  };
  return {
    info: { id, pid: 0 },
    meta: { state: "active", location: LOCAL_LOCATION, lastActivityAt: 0 },
    snapshot,
    handle: {} as ActiveTerminalProcess["handle"],
  };
}

const ID_A = "urg-a";
const ID_B = "urg-b";

afterEach(() => {
  unregisterTerminal(ID_A);
  unregisterTerminal(ID_B);
});

describe("recomputeUrgency", () => {
  it("returns ONLY awaitingIds — no separate count field on the value", () => {
    registerTerminal(ID_A, fakeActive(ID_A, makeAgent("awaiting_user")));
    registerTerminal(ID_B, fakeActive(ID_B, makeAgent("thinking")));

    const urgency = recomputeUrgency();

    expect(urgency).toEqual({ awaitingIds: [ID_A] });
    // The count is derived at the read site, never carried on the value.
    expect(Object.keys(urgency).sort()).toEqual(["awaitingIds"]);
  });
});

describe("urgencyEqual", () => {
  it("is true for two readings with the same ids in the same order", () => {
    expect(
      urgencyEqual({ awaitingIds: ["a", "b"] }, { awaitingIds: ["a", "b"] }),
    ).toBe(true);
  });

  it("is false when the id set differs", () => {
    expect(
      urgencyEqual({ awaitingIds: ["a"] }, { awaitingIds: ["a", "b"] }),
    ).toBe(false);
    expect(urgencyEqual({ awaitingIds: ["a"] }, { awaitingIds: ["b"] })).toBe(
      false,
    );
  });
});

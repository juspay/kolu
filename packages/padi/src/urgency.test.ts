/**
 * Pins the DERIVED-count invariant on `PadiUrgency`: the wire type carries only
 * `awaitingIds`, never a parallel `awaiting` count that could disagree with it
 * (see `PadiUrgencySchema` in `./surface.ts`). `recomputeUrgency` folds the
 * composed `terminals` collection — the value the derived `urgency` cell reads
 * via `$.terminals()` — into ids only; every reader derives the count as
 * `.length` at its own read site (`HostSelectorStrip.tsx`'s `awaiting()`).
 */

import type { AgentInfo, TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { type PadiTerminal, urgencyEqual } from "./surface.ts";
import { recomputeUrgency } from "./urgency.ts";
import { composeTerminalMetadata, LOCAL_LOCATION } from "./vocab.ts";

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

/** A composed ACTIVE `PadiTerminal` — the exact collection value the derived
 *  `urgency` cell folds over (what `servePadi`'s `terminals.readAll` serves), so
 *  the test exercises the same discriminant the fold narrows on. */
function activeTerminal(agent: AgentInfo | null): PadiTerminal {
  const snapshot: TerminalSnapshot = {
    cwd: "/tmp",
    git: null,
    pr: { kind: "pending" },
    agent,
    foreground: null,
  };
  return composeTerminalMetadata(
    { state: "active", location: LOCAL_LOCATION, lastActivityAt: 0 },
    snapshot,
  );
}

function terminalsMap(
  entries: Array<[string, AgentInfo | null]>,
): ReadonlyMap<TerminalId, PadiTerminal> {
  return new Map(
    entries.map(([id, agent]) => [id as TerminalId, activeTerminal(agent)]),
  );
}

const ID_A = "urg-a";
const ID_B = "urg-b";

describe("recomputeUrgency", () => {
  it("returns ONLY awaitingIds — no separate count field on the value", () => {
    const urgency = recomputeUrgency(
      terminalsMap([
        [ID_A, makeAgent("awaiting_user")],
        [ID_B, makeAgent("thinking")],
      ]),
    );

    expect(urgency).toEqual({ awaitingIds: [ID_A] });
    // The count is derived at the read site, never carried on the value.
    expect(Object.keys(urgency).sort()).toEqual(["awaitingIds"]);
  });

  it("folds ids in the map's insertion order, and an agentless entry contributes 0", () => {
    const urgency = recomputeUrgency(
      terminalsMap([
        [ID_B, makeAgent("awaiting_user")],
        ["urg-c", null],
        [ID_A, makeAgent("awaiting_user")],
      ]),
    );
    expect(urgency).toEqual({ awaitingIds: [ID_B, ID_A] });
  });

  it("is empty for a map with no awaiting agents", () => {
    expect(
      recomputeUrgency(terminalsMap([[ID_A, makeAgent("thinking")]])),
    ).toEqual({ awaitingIds: [] });
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

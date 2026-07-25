/**
 * Pins the DERIVED-count invariant on `PadiUrgency`: the wire type carries only
 * `awaitingIds`, never a parallel `awaiting` count that could disagree with it
 * (see `PadiUrgencySchema` in `./surface.ts`). `recomputeUrgency` folds the
 * composed `terminals` collection — the value the derived `urgency` cell reads
 * via `$.terminals()` — into ids only; every reader derives the count as
 * `.length` at its own read site (`HostSelectorStrip.tsx`'s `awaiting()`).
 *
 * EF2: `finishedIds` is gated on `isEpisodeFinished` — sticky-aware quiet for
 * waiting agents. Tests below pass an explicit predicate so the pure fold is
 * pinned without the tracker.
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
    ports: [],
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

/** A composed SLEEPING `PadiTerminal` — a DIFFERENT arm of the union than active.
 *  Its agent identity survives the release, so `.agent` is present, but the fold
 *  must exclude it because it narrows on `state === "active"`. This is the twin of
 *  the old registry gate on `entry.meta.state`, now expressed as the composed
 *  discriminant. */
function sleepingTerminal(agent: AgentInfo | null): PadiTerminal {
  const snapshot: TerminalSnapshot = {
    cwd: "/tmp",
    git: null,
    pr: { kind: "pending" },
    agent,
    foreground: null,
    ports: [],
  };
  return composeTerminalMetadata(
    {
      state: "sleeping",
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      sleptAt: 0,
    },
    snapshot,
  );
}

const ID_A = "urg-a";
const ID_B = "urg-b";

/** Episode finished — every id has crossed quiet (or is sticky). */
const finished = (): boolean => true;
/** Still in the first-finish quiet window — not episode-finished yet. */
const stillDebouncing = (): boolean => false;

describe("recomputeUrgency", () => {
  it("carries id lists only (no separate count field) for both attention buckets", () => {
    const urgency = recomputeUrgency(
      terminalsMap([
        [ID_A, makeAgent("awaiting_user")],
        [ID_B, makeAgent("thinking")],
      ]),
      finished,
    );

    expect(urgency).toEqual({ awaitingIds: [ID_A], finishedIds: [] });
    // Each count is derived at the read site (`.length`), never carried on the value.
    expect(Object.keys(urgency).sort()).toEqual(["awaitingIds", "finishedIds"]);
  });

  it("folds episode-finished (`waiting`) agents into finishedIds, separate from awaiting", () => {
    const urgency = recomputeUrgency(
      terminalsMap([
        [ID_A, makeAgent("awaiting_user")],
        [ID_B, makeAgent("waiting")],
        ["urg-c", makeAgent("thinking")],
      ]),
      finished,
    );
    // `awaiting_user` → asking (ungated); episode-finished `waiting` → finished.
    expect(urgency).toEqual({ awaitingIds: [ID_A], finishedIds: [ID_B] });
  });

  it("holds a still-debouncing waiting agent OUT of finishedIds (first-finish quiet)", () => {
    const urgency = recomputeUrgency(
      terminalsMap([
        [ID_A, makeAgent("awaiting_user")],
        [ID_B, makeAgent("waiting")],
      ]),
      stillDebouncing,
    );
    // Asking still ungated; waiting gated by isEpisodeFinished.
    expect(urgency).toEqual({ awaitingIds: [ID_A], finishedIds: [] });
  });

  it("gates finish per-id: only episode-finished waiting ids land in finishedIds", () => {
    const done = new Set<string>([ID_A]);
    const urgency = recomputeUrgency(
      terminalsMap([
        [ID_A, makeAgent("waiting")],
        [ID_B, makeAgent("waiting")],
      ]),
      (id) => done.has(id),
    );
    expect(urgency).toEqual({ awaitingIds: [], finishedIds: [ID_A] });
  });

  it("folds ids in the map's insertion order, and an agentless entry contributes 0", () => {
    const urgency = recomputeUrgency(
      terminalsMap([
        [ID_B, makeAgent("awaiting_user")],
        ["urg-c", null],
        [ID_A, makeAgent("awaiting_user")],
      ]),
      finished,
    );
    expect(urgency).toEqual({ awaitingIds: [ID_B, ID_A], finishedIds: [] });
  });

  it("is empty for a map with no attention-worthy agents", () => {
    expect(
      recomputeUrgency(terminalsMap([[ID_A, makeAgent("thinking")]]), finished),
    ).toEqual({ awaitingIds: [], finishedIds: [] });
  });

  it("EXCLUDES a SLEEPING terminal even when its agent reads as awaiting_user", () => {
    // The migrated fold gates on the COMPOSED record's `state === "active"`
    // discriminant (previously the raw registry's `entry.meta.state`). A sleeping
    // terminal is a different arm of the union — its agent identity survives, so it
    // could read `awaiting_user`, but it must NOT count toward urgency. This pins
    // the behavioral-parity claim in `urgency.ts` (a terminal slept mid-await is not
    // urgent) as an executable invariant, not just prose.
    const map = new Map<TerminalId, PadiTerminal>([
      [ID_A as TerminalId, sleepingTerminal(makeAgent("awaiting_user"))],
      [ID_B as TerminalId, activeTerminal(makeAgent("awaiting_user"))],
    ]);
    // Only the ACTIVE awaiting terminal counts; the sleeping one is excluded.
    expect(recomputeUrgency(map, finished)).toEqual({
      awaitingIds: [ID_B],
      finishedIds: [],
    });
  });
});

describe("urgencyEqual", () => {
  it("is true for two readings with the same ids in the same order", () => {
    expect(
      urgencyEqual(
        { awaitingIds: ["a", "b"], finishedIds: ["c"] },
        { awaitingIds: ["a", "b"], finishedIds: ["c"] },
      ),
    ).toBe(true);
  });

  it("is false when the awaiting set differs", () => {
    expect(
      urgencyEqual(
        { awaitingIds: ["a"], finishedIds: [] },
        { awaitingIds: ["a", "b"], finishedIds: [] },
      ),
    ).toBe(false);
  });

  it("is false when ONLY the finished set differs — a finish must still publish", () => {
    expect(
      urgencyEqual(
        { awaitingIds: ["a"], finishedIds: [] },
        { awaitingIds: ["a"], finishedIds: ["b"] },
      ),
    ).toBe(false);
  });
});

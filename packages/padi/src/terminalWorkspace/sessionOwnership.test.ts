/** The ownership arbiter's whole rule surface, in isolation from any adapter
 *  (juspay/kolu#2057). The end-to-end reproduction lives in
 *  `agentSessionOwnership.test.ts`, which drives the real Codex adapter; these
 *  pin the arbitration itself, including the cases a real DB fixture cannot
 *  reach cheaply. */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { beforeEach, describe, expect, it } from "vitest";
import {
  claimSession,
  releaseTerminal,
  resetSessionOwnership,
} from "./sessionOwnership.ts";

const KIND = "codex";
const ONE = "term-one" as TerminalId;
const TWO = "term-two" as TerminalId;

/** An episode clock, and sessions placed either side of it. */
const EPISODE = 1_000;
const BEFORE = 500; // a leftover from an earlier run in this directory
const AFTER = 1_500; // born while this terminal's harness was running
const LATER = 2_000;

/** A candidate. Its `value` is the key itself, so the assertions read as the
 *  session the arbiter handed back rather than a lookup. */
const at = (key: string, createdAt: number | null) => ({
  key,
  createdAt,
  value: key,
});

/** Candidates whose creation time the adapter cannot report. */
const undated = (...keys: string[]) => keys.map((key) => at(key, null));

beforeEach(resetSessionOwnership);

describe("claimSession — exclusivity", () => {
  it("gives two terminals offered the SAME list two different sessions", () => {
    // The reported case: one repository, two harnesses, one candidate list.
    const list = undated("newest", "older");
    expect(claimSession(KIND, ONE, list, null)).toBe("newest");
    expect(claimSession(KIND, TWO, list, null)).toBe("older");
  });

  it("reports no session rather than lending out one already held", () => {
    expect(claimSession(KIND, ONE, undated("only"), null)).toBe("only");
    expect(claimSession(KIND, TWO, undated("only"), null)).toBeNull();
  });

  it("never lets two agents' claims collide", () => {
    // Keys are only unique within an agent; a Codex thread id and an OpenCode
    // session id sharing a string must not block each other.
    expect(claimSession("codex", ONE, undated("s"), null)).toBe("s");
    expect(claimSession("opencode", TWO, undated("s"), null)).toBe("s");
  });
});

describe("claimSession — stickiness", () => {
  it("keeps a held session when a newer one jumps to the front of the list", () => {
    // A second harness starting in the same repository puts ITS session at the
    // head of everyone's list. Following it is exactly how one row came to show
    // another harness's task.
    const mine = [at("mine", AFTER)];
    expect(claimSession(KIND, ONE, mine, EPISODE)).toBe("mine");
    const withNewcomer = [at("a-newcomer", LATER), at("mine", AFTER)];
    expect(claimSession(KIND, ONE, withNewcomer, EPISODE)).toBe("mine");
    expect(claimSession(KIND, TWO, withNewcomer, LATER)).toBe("a-newcomer");
  });

  it("is idempotent — re-asking with the same list moves nothing", () => {
    const list = undated("newest", "older");
    claimSession(KIND, ONE, list, null);
    claimSession(KIND, TWO, list, null);
    expect(claimSession(KIND, ONE, list, null)).toBe("newest");
    expect(claimSession(KIND, TWO, list, null)).toBe("older");
  });

  it("moves on when the held session leaves the candidate list", () => {
    // Archived, deleted, or superseded by a pid-anchored match — the terminal
    // must not stay pinned to a session it can no longer be running.
    expect(claimSession(KIND, ONE, undated("gone-soon"), null)).toBe(
      "gone-soon",
    );
    expect(claimSession(KIND, ONE, undated("replacement"), null)).toBe(
      "replacement",
    );
    // …and the abandoned one is free again.
    expect(claimSession(KIND, TWO, undated("gone-soon"), null)).toBe(
      "gone-soon",
    );
  });

  it("frees the session when the terminal stops offering any candidate", () => {
    expect(claimSession(KIND, ONE, undated("shared"), null)).toBe("shared");
    expect(claimSession(KIND, ONE, [], null)).toBeNull();
    expect(claimSession(KIND, TWO, undated("shared"), null)).toBe("shared");
  });
});

describe("claimSession — the episode anchor", () => {
  it("trades a leftover it grabbed first for the session its own harness made", () => {
    // These agents write their session row only after the first exchange, so at
    // the moment kolu sees the harness the only candidate is a PREVIOUS run's.
    // Keeping that is how a terminal came to show yesterday's conversation for
    // its whole life.
    const leftoverOnly = [at("yesterday", BEFORE)];
    expect(claimSession(KIND, ONE, leftoverOnly, EPISODE)).toBe("yesterday");
    const ownLanded = [at("mine", AFTER), at("yesterday", BEFORE)];
    expect(claimSession(KIND, ONE, ownLanded, EPISODE)).toBe("mine");
    // The leftover is free again — it was never this terminal's.
    expect(claimSession(KIND, TWO, [at("yesterday", BEFORE)], LATER)).toBe(
      "yesterday",
    );
  });

  it("keeps the leftover when nothing newer than the episode is on offer", () => {
    // `codex resume` of an old thread: the only candidate predates the episode
    // and is still the right answer. Never trade for nothing.
    const leftovers = [at("older", BEFORE), at("oldest", 1)];
    expect(claimSession(KIND, ONE, leftovers, EPISODE)).toBe("older");
    expect(claimSession(KIND, ONE, leftovers, EPISODE)).toBe("older");
  });

  it("does not trade a leftover for a post-episode session someone else holds", () => {
    // The neighbour's session is newer than this terminal's episode too — but
    // it is taken, and exclusivity outranks the episode anchor.
    const neighbours = [at("theirs", AFTER)];
    expect(claimSession(KIND, TWO, neighbours, EPISODE)).toBe("theirs");
    const both = [at("theirs", AFTER), at("leftover", BEFORE)];
    expect(claimSession(KIND, ONE, both, EPISODE)).toBe("leftover");
    expect(claimSession(KIND, ONE, both, EPISODE)).toBe("leftover");
  });

  it("holds a post-episode session against every later arrival", () => {
    // Once a terminal has a session its own harness made, nothing dislodges it
    // — this is the external-`codex` case the whole module exists for.
    const own = [at("own", AFTER)];
    expect(claimSession(KIND, ONE, own, EPISODE)).toBe("own");
    const stranger = [at("a-stranger", LATER), at("own", AFTER)];
    expect(claimSession(KIND, ONE, stranger, EPISODE)).toBe("own");
  });

  it("cannot judge undated candidates, so it keeps what it holds", () => {
    // OpenCode reports no creation time. Absence of proof that a hold is a
    // leftover is not proof — the arbiter falls back to plain stickiness.
    expect(claimSession(KIND, ONE, undated("first"), EPISODE)).toBe("first");
    expect(claimSession(KIND, ONE, undated("newer", "first"), EPISODE)).toBe(
      "first",
    );
  });

  it("keeps what it holds when the terminal has no episode clock", () => {
    const dated = [at("held", BEFORE)];
    expect(claimSession(KIND, ONE, dated, null)).toBe("held");
    expect(claimSession(KIND, ONE, [at("newer", LATER), ...dated], null)).toBe(
      "held",
    );
  });
});

describe("releaseTerminal", () => {
  it("hands the session to whoever runs it next", () => {
    claimSession(KIND, ONE, undated("shared"), null);
    expect(claimSession(KIND, TWO, undated("shared"), null)).toBeNull();
    releaseTerminal(KIND, ONE);
    expect(claimSession(KIND, TWO, undated("shared"), null)).toBe("shared");
  });

  it("is safe for a terminal that never claimed anything", () => {
    expect(() => releaseTerminal(KIND, ONE)).not.toThrow();
    expect(() => releaseTerminal("never-seen", ONE)).not.toThrow();
  });
});

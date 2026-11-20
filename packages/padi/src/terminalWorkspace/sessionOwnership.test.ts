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

const EPISODE = 1_000;
const BEFORE = 500;
const AFTER = 1_500;
const LATER = 2_000;

const at = (key: string, createdAt: number | null) => ({
  key,
  createdAt,
  value: key,
});

const undated = (...keys: string[]) => keys.map((key) => at(key, null));

beforeEach(resetSessionOwnership);

describe("claimSession — exclusivity", () => {
  it("gives two terminals offered the SAME list two different sessions", () => {
    const list = undated("newest", "older");
    expect(claimSession(KIND, ONE, list, null)).toBe("newest");
    expect(claimSession(KIND, TWO, list, null)).toBe("older");
  });

  it("reports no session rather than lending out one already held", () => {
    expect(claimSession(KIND, ONE, undated("only"), null)).toBe("only");
    expect(claimSession(KIND, TWO, undated("only"), null)).toBeNull();
  });

  it("never lets two agents' claims collide", () => {
    expect(claimSession("codex", ONE, undated("s"), null)).toBe("s");
    expect(claimSession("opencode", TWO, undated("s"), null)).toBe("s");
  });
});

describe("claimSession — stickiness", () => {
  it("keeps a held session when a newer one jumps to the front of the list", () => {
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
    expect(claimSession(KIND, ONE, undated("gone-soon"), null)).toBe(
      "gone-soon",
    );
    expect(claimSession(KIND, ONE, undated("replacement"), null)).toBe(
      "replacement",
    );
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
    const leftoverOnly = [at("yesterday", BEFORE)];
    expect(claimSession(KIND, ONE, leftoverOnly, EPISODE)).toBe("yesterday");
    const ownLanded = [at("mine", AFTER), at("yesterday", BEFORE)];
    expect(claimSession(KIND, ONE, ownLanded, EPISODE)).toBe("mine");
    expect(claimSession(KIND, TWO, [at("yesterday", BEFORE)], LATER)).toBe(
      "yesterday",
    );
  });

  it("keeps the leftover when nothing newer than the episode is on offer", () => {
    const leftovers = [at("older", BEFORE), at("oldest", 1)];
    expect(claimSession(KIND, ONE, leftovers, EPISODE)).toBe("older");
    expect(claimSession(KIND, ONE, leftovers, EPISODE)).toBe("older");
  });

  it("does not trade a leftover for a post-episode session someone else holds", () => {
    const neighbours = [at("theirs", AFTER)];
    expect(claimSession(KIND, TWO, neighbours, EPISODE)).toBe("theirs");
    const both = [at("theirs", AFTER), at("leftover", BEFORE)];
    expect(claimSession(KIND, ONE, both, EPISODE)).toBe("leftover");
    expect(claimSession(KIND, ONE, both, EPISODE)).toBe("leftover");
  });

  it("holds a post-episode session against every later arrival", () => {
    const own = [at("own", AFTER)];
    expect(claimSession(KIND, ONE, own, EPISODE)).toBe("own");
    const stranger = [at("a-stranger", LATER), at("own", AFTER)];
    expect(claimSession(KIND, ONE, stranger, EPISODE)).toBe("own");
  });

  it("cannot judge undated candidates, so it keeps what it holds", () => {
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

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

beforeEach(resetSessionOwnership);

describe("claimSession", () => {
  it("gives two terminals offered the SAME list two different sessions", () => {
    // The reported case: one repository, two harnesses, one candidate list.
    expect(claimSession(KIND, ONE, ["newest", "older"])).toBe("newest");
    expect(claimSession(KIND, TWO, ["newest", "older"])).toBe("older");
  });

  it("reports no session rather than lending out one already held", () => {
    expect(claimSession(KIND, ONE, ["only"])).toBe("only");
    expect(claimSession(KIND, TWO, ["only"])).toBeNull();
  });

  it("keeps a held session when a newer one jumps to the front of the list", () => {
    // A second harness starting in the same repository puts ITS session at the
    // head of everyone's list. Following it is exactly how one row came to show
    // another harness's task.
    expect(claimSession(KIND, ONE, ["mine"])).toBe("mine");
    expect(claimSession(KIND, ONE, ["a-newcomer", "mine"])).toBe("mine");
    expect(claimSession(KIND, TWO, ["a-newcomer", "mine"])).toBe("a-newcomer");
  });

  it("is idempotent — re-asking with the same list moves nothing", () => {
    claimSession(KIND, ONE, ["newest", "older"]);
    claimSession(KIND, TWO, ["newest", "older"]);
    expect(claimSession(KIND, ONE, ["newest", "older"])).toBe("newest");
    expect(claimSession(KIND, TWO, ["newest", "older"])).toBe("older");
  });

  it("moves on when the held session leaves the candidate list", () => {
    // Archived, deleted, or superseded by a pid-anchored match — the terminal
    // must not stay pinned to a session it can no longer be running.
    expect(claimSession(KIND, ONE, ["gone-soon"])).toBe("gone-soon");
    expect(claimSession(KIND, ONE, ["replacement"])).toBe("replacement");
    // …and the abandoned one is free again.
    expect(claimSession(KIND, TWO, ["gone-soon"])).toBe("gone-soon");
  });

  it("frees the session when the terminal stops offering any candidate", () => {
    expect(claimSession(KIND, ONE, ["shared"])).toBe("shared");
    expect(claimSession(KIND, ONE, [])).toBeNull();
    expect(claimSession(KIND, TWO, ["shared"])).toBe("shared");
  });

  it("never lets two agents' claims collide", () => {
    // Keys are only unique within an agent; a Codex thread id and an OpenCode
    // session id sharing a string must not block each other.
    expect(claimSession("codex", ONE, ["s"])).toBe("s");
    expect(claimSession("opencode", TWO, ["s"])).toBe("s");
  });
});

describe("releaseTerminal", () => {
  it("hands the session to whoever runs it next", () => {
    claimSession(KIND, ONE, ["shared"]);
    expect(claimSession(KIND, TWO, ["shared"])).toBeNull();
    releaseTerminal(KIND, ONE);
    expect(claimSession(KIND, TWO, ["shared"])).toBe("shared");
  });

  it("is safe for a terminal that never claimed anything", () => {
    expect(() => releaseTerminal(KIND, ONE)).not.toThrow();
    expect(() => releaseTerminal("never-seen", ONE)).not.toThrow();
  });
});

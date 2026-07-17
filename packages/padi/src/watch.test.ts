/**
 * The wait predicate over a composed record — moved here (verbatim fixtures)
 * from padi-tui's `render.test.ts` when `agentMatchesUntil`/`activeAgent`
 * graduated into the dial kit's watch module. `awaitAgentState`'s live
 * behavior (seeded-gone reconciliation, already-in-bucket met) stays pinned in
 * padi-tui's `read.test.ts` over its fake-stream client — the consumer-side
 * harness those regressions were caught with.
 */
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import type { PadiTerminal } from "./surface.ts";
import { agentMatchesUntil, WAIT_STATES } from "./watch.ts";

/** A minimal `active` composed record — the agent the wait predicate reads.
 *  Cast because the full `ActiveTerminalSchema` is large and these are the
 *  only fields under test. */
function activeWithAgent(agent: AgentInfo | null): PadiTerminal {
  return {
    state: "active",
    agent,
    git: null,
    pr: { kind: "pending" },
    foreground: null,
  } as unknown as PadiTerminal;
}

const claude = (state: AgentInfo["state"]): AgentInfo =>
  ({ kind: "claude-code", state }) as AgentInfo;

describe("agentMatchesUntil — the wait predicate over a composed record", () => {
  const awaitingOrWaiting = new Set(["awaiting", "waiting"]);

  it("matches an agent whose bucket is in the targets", () => {
    expect(
      agentMatchesUntil(
        activeWithAgent(claude("awaiting_user")),
        awaitingOrWaiting,
      ),
    ).toBe(true);
    expect(
      agentMatchesUntil(activeWithAgent(claude("waiting")), awaitingOrWaiting),
    ).toBe(true);
  });

  it("does NOT match a working agent for an awaiting/waiting wait", () => {
    expect(
      agentMatchesUntil(activeWithAgent(claude("thinking")), awaitingOrWaiting),
    ).toBe(false);
  });

  it("matches a working agent for a working wait (the two-phase phase 1)", () => {
    const working = new Set(["working"]);
    expect(
      agentMatchesUntil(activeWithAgent(claude("tool_use")), working),
    ).toBe(true);
  });

  it("never matches a record with no live agent", () => {
    expect(agentMatchesUntil(activeWithAgent(null), awaitingOrWaiting)).toBe(
      false,
    );
    // A dormant record has no `.agent` at all.
    expect(
      agentMatchesUntil(
        { state: "parked" } as unknown as PadiTerminal,
        awaitingOrWaiting,
      ),
    ).toBe(false);
  });

  it("every WAIT_STATES bucket is a real agentBucket value (no dead target)", () => {
    expect(WAIT_STATES).toEqual(["working", "awaiting", "waiting"]);
  });
});

/**
 * The finish gate's MEMBERSHIP filter — the real production glue that decides which
 * terminals the gate taps, pinned apart from the live registry + real byte taps (the
 * gate's own timer/state logic is covered in `finishGate.test.ts` against fakes). A
 * drift here — the `active` gate satisfied by a non-active arm, or the `waiting`-bucket
 * mapping — would silently degrade the episode edge the whole design leans on, and
 * nothing else in CI would catch it.
 */

import type { AgentInfo, TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import {
  selectWaitingTerminals,
  type WaitingCandidate,
} from "./padiFinishGate.ts";
import { LOCAL_LOCATION } from "./vocab.ts";

const agent = (state: AgentInfo["state"]): AgentInfo => ({
  kind: "claude-code",
  state,
  sessionId: "s1",
  model: null,
  summary: null,
  taskProgress: null,
  workflow: null,
  contextTokens: null,
  startedAt: null,
});

/** An ACTIVE registry projection carrying `a`. */
const active = (a: AgentInfo | null): WaitingCandidate => ({
  meta: { state: "active", location: LOCAL_LOCATION, lastActivityAt: 0 },
  agent: a,
});

/** A SLEEPING projection — a different `meta` arm the filter must exclude. */
const sleeping = (a: AgentInfo | null): WaitingCandidate => ({
  meta: {
    state: "sleeping",
    location: LOCAL_LOCATION,
    lastActivityAt: 0,
    sleptAt: 0,
  },
  agent: a,
});

describe("selectWaitingTerminals", () => {
  it("selects ONLY active + `waiting`-bucket terminals, mapped to their tap location", () => {
    const result = selectWaitingTerminals(
      new Map([
        ["w" as TerminalId, active(agent("waiting"))], // ✓ waiting
        ["work" as TerminalId, active(agent("thinking"))], // working bucket
        ["tool" as TerminalId, active(agent("running_background"))], // working bucket
        ["ask" as TerminalId, active(agent("awaiting_user"))], // awaiting bucket
        ["noagent" as TerminalId, active(null)], // no agent
        ["asleep" as TerminalId, sleeping(agent("waiting"))], // sleeping arm — excluded
      ]),
    );
    expect([...result.keys()]).toEqual(["w"]);
    expect(result.get("w" as TerminalId)).toEqual(LOCAL_LOCATION);
  });

  it("is empty when nothing is waiting", () => {
    const result = selectWaitingTerminals(
      new Map([
        ["a" as TerminalId, active(agent("thinking"))],
        ["b" as TerminalId, active(agent("awaiting_user"))],
      ]),
    );
    expect(result.size).toBe(0);
  });
});

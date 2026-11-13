/** The machine's line, in one line: the news comes from the EVENTS, never from
 *  the first line of the account (which is a briefing written for the agent). */

import type { ConductorWakeEvent } from "kolu-common/conductor";
import { describe, expect, it } from "vitest";
import { wakeHeadline, wakeWhen } from "./wake";

const event = (
  name: string,
  level: ConductorWakeEvent["level"],
): ConductorWakeEvent => ({
  ref: `local/${name}`,
  host: "local",
  terminalId: "aaaaaaaa-0000-4000-8000-000000000001" as never,
  hostName: "local",
  name,
  agent: "claude-code",
  level,
  at: "2026-01-01T00:00:00.000Z",
});

describe("the wake headline", () => {
  it("names each terminal and how it stands", () => {
    expect(
      wakeHeadline([event("planner", "stopped"), event("impl", "asking")]),
    ).toBe("planner stopped · impl asking");
  });

  it("says a terminal is gone, which is about the terminal and not its agent", () => {
    expect(wakeHeadline([event("review", "gone")])).toBe("review gone");
  });

  it("counts the rest once the line is full", () => {
    expect(
      wakeHeadline([
        event("one", "stopped"),
        event("two", "stopped"),
        event("three", "asking"),
        event("four", "gone"),
        event("five", "stopped"),
      ]),
    ).toBe("one stopped · two stopped · three asking · +2 more");
  });

  it("still says something for a wake with no events", () => {
    // A producer bug, not a state to draw — but a renderer says what it has
    // rather than leaving a row blank.
    expect(wakeHeadline([])).toBe("a watched terminal rang");
  });
});

describe("when it rang", () => {
  it("reads as a clock time", () => {
    expect(wakeWhen("2026-01-01T00:00:00.000Z")).toMatch(/\d{2}:\d{2}/);
  });

  it("draws nothing rather than `Invalid Date`", () => {
    expect(wakeWhen("sometime")).toBeNull();
  });
});

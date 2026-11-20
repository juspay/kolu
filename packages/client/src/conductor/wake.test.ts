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

  it("says an agent that has come up and not been spoken to is up", () => {
    expect(wakeHeadline([event("planner", "ready")])).toBe("planner is up");
  });

  it("says a watched terminal was put to sleep", () => {
    expect(wakeHeadline([event("impl", "asleep")])).toBe("impl asleep");
  });

  it("says what is MISSING when a created terminal's command ended", () => {
    expect(wakeHeadline([event("setup", "ended")])).toBe(
      "setup ended without an agent",
    );
  });

  it("says plainly that an agent exited back to its shell", () => {
    expect(wakeHeadline([event("planner", "exited")])).toBe("planner exited");
  });

  it("names the new levels beside the old ones in one line", () => {
    expect(
      wakeHeadline([event("planner", "ready"), event("impl", "asleep")]),
    ).toBe("planner is up · impl asleep");
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

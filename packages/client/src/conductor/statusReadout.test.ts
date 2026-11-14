/** THE ONE STATUS LINE's words: the phase a person already knows, what the
 *  TURN IN FLIGHT is doing (read off that turn's rows, newest first, and
 *  never off a turn that is over), and a duration that counts from the
 *  instant the turn began. */

import type { ConductorRow, ConductorToolRow } from "kolu-common/conductor";
import { DASH } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { conductorDoing, statusDetail, statusSince } from "./statusReadout";

const AT = "2026-01-01T00:00:00.000Z";
const NOW = Date.parse(AT);

const agentRow = (id: string, seq: number, text: string): ConductorRow => ({
  id,
  seq,
  since: AT,
  kind: "agent",
  text,
});

const userRow = (id: string, seq: number, text: string): ConductorRow => ({
  id,
  seq,
  since: AT,
  kind: "user",
  text,
  attachments: [],
});

const toolRow = (
  id: string,
  seq: number,
  status: ConductorToolRow["status"],
  tool: string,
): ConductorRow =>
  ({
    id,
    seq,
    since: AT,
    kind: "tool",
    status,
    tool,
    server: null,
    text: tool,
    progress: null,
    kolu: null,
    attachments: [],
  }) as unknown as ConductorToolRow;

describe("what it is doing", () => {
  it("names the newest call still out", () => {
    const doing = conductorDoing([
      agentRow("a", 1, "let me look"),
      toolRow("t1", 2, "completed", "screen_text"),
      toolRow("t2", 3, "in_progress", "wait_outputSettled"),
    ]);
    expect(doing).toBe("wait_outputSettled");
  });

  it("falls back to the last thing it SAID when nothing is out", () => {
    const doing = conductorDoing([
      agentRow("a", 1, "first"),
      toolRow("t1", 2, "completed", "screen_text"),
      agentRow("b", 3, "briefing the planner\nand then some"),
    ]);
    // The first line only: the status row is one line beside two buttons.
    expect(doing).toBe("briefing the planner");
  });

  it("says nothing for a turn that has neither spoken nor called", () => {
    expect(conductorDoing([])).toBeNull();
  });

  it("cuts a long sentence rather than pushing the line off the edge", () => {
    const long = "x".repeat(200);
    const doing = conductorDoing([agentRow("a", 1, long)]);
    expect(doing).not.toBeNull();
    expect((doing ?? "").length).toBeLessThanOrEqual(72);
    expect(doing).toMatch(/…$/);
  });
});

describe("the turn in flight is the only turn that counts", () => {
  it("says nothing when the last prose belongs to an earlier turn", () => {
    // The human asked something, got an answer, then asked again — and the
    // turn now running has only a settled call to show for itself. The old
    // walk crossed the second question and reported the FIRST answer as the
    // thing happening now.
    const doing = conductorDoing([
      userRow("u1", 1, "which hosts are up?"),
      agentRow("a1", 2, "Only pureintent is connected right now"),
      userRow("u2", 3, "start a waterfall"),
      toolRow("t1", 4, "completed", "lifecycle_create"),
    ]);
    expect(doing).toBeNull();
  });

  it("reads a wake and a divider as the same boundary", () => {
    const wakeRow: ConductorRow = {
      id: "w",
      seq: 3,
      since: AT,
      kind: "wake",
      from: "kolu",
      terminals: [],
    } as unknown as ConductorRow;
    const dividerRow: ConductorRow = {
      id: "d",
      seq: 3,
      since: AT,
      kind: "divider",
      text: "restarted",
    };
    for (const boundary of [wakeRow, dividerRow]) {
      expect(
        conductorDoing([
          agentRow("a1", 1, "an answer from before"),
          boundary,
          toolRow("t1", 4, "completed", "screen_text"),
        ]),
      ).toBeNull();
    }
  });

  it("names a call still out, over prose said earlier in the same turn", () => {
    const doing = conductorDoing([
      userRow("u", 1, "go"),
      agentRow("a", 2, "let me look"),
      toolRow("t1", 3, "in_progress", "wait_outputSettled"),
    ]);
    expect(doing).toBe("wait_outputSettled");
  });

  it("falls back to the latest prose OF THIS TURN", () => {
    const doing = conductorDoing([
      userRow("u1", 1, "which hosts are up?"),
      agentRow("a1", 2, "an answer from before"),
      userRow("u2", 3, "start a waterfall"),
      toolRow("t1", 4, "completed", "lifecycle_create"),
      agentRow("a2", 5, "briefing the planner"),
    ]);
    expect(doing).toBe("briefing the planner");
  });
});

describe("the status line's two halves", () => {
  it("names what it is doing only while it is WORKING", () => {
    // The word itself is the cell's, drawn straight: what this pins is that
    // the detail is offered for a WORKING turn only.
    const rows = [agentRow("a", 1, "thinking about it")];
    expect(statusDetail("working", rows)).toBe("thinking about it");
    // Idle: the sentence is still on screen above the composer, and repeating
    // it here would read as work still going on.
    expect(statusDetail("idle", rows)).toBeNull();
    expect(statusDetail("asking", rows)).toBeNull();
  });

  it("counts from busySince while a turn runs", () => {
    expect(statusSince("working", AT, NOW + 134_000)).toBe("2m 14s");
  });

  it("counts an `asking` turn too — it is still a turn in flight", () => {
    expect(statusSince("asking", AT, NOW + 5_000)).toBe("5s");
  });

  it("shows no clock while nothing is running, and the dash for a bad stamp", () => {
    expect(statusSince("idle", null, NOW)).toBeNull();
    // An unreadable stamp is a clock this app cannot trust, and every kolu
    // readout says that with the same dash rather than dropping the figure.
    expect(statusSince("working", "not a date", NOW)).toBe(DASH);
  });
});

/** THE ONE STATUS LINE's words: the phase a person already knows, what the
 *  conversation is doing (read off the transcript, newest first), and a
 *  duration that counts from the instant the turn began. */

import type { ConductorRow, ConductorToolRow } from "kolu-common/conductor";
import { describe, expect, it } from "vitest";
import { conductorDoing, statusReadout } from "./conductorStatus";

const AT = "2026-01-01T00:00:00.000Z";
const NOW = Date.parse(AT);

const agentRow = (id: string, seq: number, text: string): ConductorRow => ({
  id,
  seq,
  since: AT,
  kind: "agent",
  text,
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

describe("the status readout", () => {
  it("keeps the phase word the header chip used", () => {
    for (const phase of [
      "offline",
      "starting",
      "idle",
      "working",
      "asking",
    ] as const) {
      expect(statusReadout({ phase, busySince: null }, [], NOW).state).toBe(
        phase,
      );
    }
  });

  it("counts from busySince while a turn runs", () => {
    const readout = statusReadout(
      { phase: "working", busySince: AT },
      [],
      NOW + 134_000,
    );
    expect(readout.since).toBe("2m 14s");
  });

  it("counts an `asking` turn too — it is still a turn in flight", () => {
    const readout = statusReadout(
      { phase: "asking", busySince: AT },
      [],
      NOW + 5_000,
    );
    expect(readout.since).toBe("5s");
  });

  it("shows no clock while nothing is running, and none for a bad stamp", () => {
    expect(
      statusReadout({ phase: "idle", busySince: null }, [], NOW).since,
    ).toBeNull();
    expect(
      statusReadout({ phase: "working", busySince: "not a date" }, [], NOW)
        .since,
    ).toBeNull();
  });

  it("names what it is doing only while it is working", () => {
    const rows = [agentRow("a", 1, "thinking about it")];
    expect(
      statusReadout({ phase: "working", busySince: AT }, rows, NOW).detail,
    ).toBe("thinking about it");
    // Idle: the sentence is still on screen above the composer, and repeating
    // it here would read as work still going on.
    expect(
      statusReadout({ phase: "idle", busySince: null }, rows, NOW).detail,
    ).toBeNull();
  });
});

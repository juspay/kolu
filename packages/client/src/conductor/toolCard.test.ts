/** The two derivations a tool card cannot read straight off the row — what
 *  went in, and how long the wait was — plus the clock under a running call.
 *  The rest of a card is `row.kolu` read as it stands, so there is nothing
 *  between the wire and the markup left to pin here. */

import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { runningFor, sentInput, waitedFor } from "./toolCard";

const TERMINAL = "11111111-1111-4111-8111-111111111111" as TerminalId;

const sent = (text: string | null, key: string | null) =>
  sentInput({
    kind: "sendInput",
    terminalId: TERMINAL,
    host: "local",
    name: "fix-parser",
    text,
    key,
  });

describe("sentInput", () => {
  it("tells typed text and a named key apart", () => {
    expect(sent("go", null)).toEqual({ as: "text", value: "go" });
    expect(sent(null, "Enter")).toEqual({ as: "key", value: "Enter" });
  });

  it("says nothing for a call that carried neither", () => {
    expect(sent(null, null)).toBeNull();
  });
});

describe("waitedFor", () => {
  it("phrases the wait down to the second", () => {
    expect(waitedFor(134_000)).toBe("2m 14s");
  });

  it("says nothing about a wait the tool did not report — a wait with no duration is not a wait of zero", () => {
    expect(waitedFor(null)).toBeNull();
  });
});

describe("runningFor", () => {
  const started = "2026-01-01T00:00:00.000Z";
  const at = (seconds: number) => Date.parse(started) + seconds * 1000;

  it("says nothing for a call that is not running", () => {
    expect(
      runningFor({ status: "completed", startedAt: started }, at(90)),
    ).toBeNull();
  });

  it("says nothing until the wait is worth watching", () => {
    expect(
      runningFor({ status: "in_progress", startedAt: started }, at(1)),
    ).toBeNull();
  });

  it("counts from the writer's stamp, so two tabs agree", () => {
    expect(
      runningFor({ status: "in_progress", startedAt: started }, at(47)),
    ).toBe("47s");
  });

  it("says nothing when the row carries no stamp", () => {
    expect(runningFor({ status: "in_progress" }, at(90))).toBeNull();
  });
});

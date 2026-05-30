import type { SavedSession } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { parseSavedSession } from "./sessionTransfer";

const valid: SavedSession = {
  terminals: [{ id: "t1", cwd: "/home/user", git: null, lastActivityAt: 0 }],
  activeTerminalId: "t1",
  savedAt: 1_700_000_000_000,
};

describe("parseSavedSession", () => {
  it("accepts a valid session export and round-trips it", () => {
    expect(parseSavedSession(JSON.stringify(valid))).toEqual(valid);
  });

  it("accepts an empty-terminals session", () => {
    const empty: SavedSession = { terminals: [], savedAt: 1 };
    expect(parseSavedSession(JSON.stringify(empty))).toEqual(empty);
  });

  it("rejects text that is not JSON", () => {
    expect(() => parseSavedSession("not json")).toThrow(/valid JSON/);
  });

  it("rejects JSON that is not a session export", () => {
    expect(() => parseSavedSession(JSON.stringify({ foo: "bar" }))).toThrow(
      /valid kolu session export/,
    );
  });

  it("rejects a session whose terminals are malformed", () => {
    const bad = { terminals: [{ id: "t1" }], savedAt: 1 };
    expect(() => parseSavedSession(JSON.stringify(bad))).toThrow(
      /valid kolu session export/,
    );
  });
});

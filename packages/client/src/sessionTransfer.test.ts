import { LOCAL_LOCATION, type SavedSession } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";

// `sessionTransfer` imports `solid-sonner` (for toast) at module scope, which
// transitively pulls `solid-js/web`'s SSR build and fails to load under the
// Node test runner. `parseSavedSession` is pure (no toast, no DOM) by design,
// so stub the module out — the test never exercises the toast path.
vi.mock("solid-sonner", () => ({ toast: {} }));

import { parseSavedSession } from "./sessionTransfer";

const valid: SavedSession = {
  terminals: [
    {
      id: "t1",
      cwd: "/home/user",
      git: null,
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
    },
  ],
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

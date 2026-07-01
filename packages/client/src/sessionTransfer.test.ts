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
      state: "active",
      cwd: "/home/user",
      git: null,
      // `pr` is a persisted (restore-relevant) field after the
      // awareness-derive-store cutover (PR #1621), so a current-schema export
      // carries it verbatim and the parse round-trips with no backfill.
      pr: { kind: "absent" },
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

  it("backfills a legacy export missing state/location/pr so the recovery hatch works", () => {
    // A `kolu-session.json` exported before the schema gained the now-required
    // `state` discriminant, `location`, and (with the awareness-derive-store
    // cutover, PR #1621) the now-persisted `pr`. The export pre-dates the
    // migration ladder, so without the import-side backfill the discriminated
    // schema rejects it and the recovery hatch can't recover the very backup it
    // exists for. The backfill repairs all three: `state: "active"` (every
    // pre-discriminant terminal was live), `location: LOCAL_LOCATION`, and
    // `pr: { kind: "absent" }` (the live PR sensor re-resolves on restore).
    // `lastActivityAt` rides through verbatim — it predates these bumps.
    const legacy = {
      terminals: [
        { id: "t1", cwd: "/home/user", git: null, lastActivityAt: 0 },
      ],
      activeTerminalId: "t1",
      savedAt: 1_700_000_000_000,
    };
    expect(parseSavedSession(JSON.stringify(legacy))).toEqual({
      ...legacy,
      terminals: [
        {
          ...legacy.terminals[0],
          state: "active",
          location: LOCAL_LOCATION,
          pr: { kind: "absent" },
        },
      ],
    });
  });

  it("maps a pre-cutover agentSession + command to an `exact` restoreTarget (keying id → sessionId)", () => {
    // The awareness-derive-store cutover (PR #1621) collapsed the sticky
    // `agentSession: { kind, id }` resume ref and the implicit "lastAgentCommand ⇒
    // most-recent" rule into the fold-derived discriminated `restoreTarget`. A
    // pre-cutover export that carries BOTH an `agentSession` and a launch command
    // maps to an `exact` target (the EXACT conversation wake resumes by id, #1495) —
    // the inner key `id` → `sessionId` to match the agent's own field, `agentSession`
    // dropped. The same record predates persisted `pr`, so it is backfilled `absent`.
    const legacy = {
      terminals: [
        {
          id: "t1",
          state: "active",
          cwd: "/home/user",
          git: null,
          location: LOCAL_LOCATION,
          lastActivityAt: 5,
          lastAgentCommand: "claude --model sonnet",
          agentSession: { kind: "claude-code", id: "sess-123" },
        },
      ],
      activeTerminalId: "t1",
      savedAt: 1_700_000_000_000,
    };
    expect(parseSavedSession(JSON.stringify(legacy))).toEqual({
      ...legacy,
      terminals: [
        {
          id: "t1",
          state: "active",
          cwd: "/home/user",
          git: null,
          location: LOCAL_LOCATION,
          lastActivityAt: 5,
          lastAgentCommand: "claude --model sonnet",
          pr: { kind: "absent" },
          restoreTarget: {
            kind: "exact",
            command: "claude --model sonnet",
            agent: { kind: "claude-code", sessionId: "sess-123" },
          },
        },
      ],
    });
  });

  it("maps a pre-cutover command WITHOUT an agentSession to a `legacyMostRecent` target", () => {
    // A record that remembered a launch command but never captured the session id
    // (no `agentSession`) preserves the OLD most-recent behavior — but as a NAMED
    // `legacyMostRecent` value, never confused with a quit-to-shell `none`.
    const legacy = {
      terminals: [
        {
          id: "t1",
          state: "active",
          cwd: "/home/user",
          git: null,
          location: LOCAL_LOCATION,
          lastActivityAt: 5,
          lastAgentCommand: "opencode --model sonnet",
        },
      ],
      activeTerminalId: "t1",
      savedAt: 1_700_000_000_000,
    };
    expect(parseSavedSession(JSON.stringify(legacy))).toEqual({
      ...legacy,
      terminals: [
        {
          id: "t1",
          state: "active",
          cwd: "/home/user",
          git: null,
          location: LOCAL_LOCATION,
          lastActivityAt: 5,
          lastAgentCommand: "opencode --model sonnet",
          pr: { kind: "absent" },
          restoreTarget: {
            kind: "legacyMostRecent",
            command: "opencode --model sonnet",
          },
        },
      ],
    });
  });

  it("maps a pre-cutover agentSession whose KIND disagrees with the command to `legacyMostRecent`, not a mismatched `exact`", () => {
    // A corrupt / cross-agent pre-cutover record: the captured `agentSession` is a
    // claude-code conversation but the remembered command launched opencode. Building
    // an `exact` from that pair would silently resume the wrong agent — so the
    // migration falls to `legacyMostRecent` (same kind-consistency gate the live fold
    // enforces via `exactRestoreTarget`).
    const legacy = {
      terminals: [
        {
          id: "t1",
          state: "active",
          cwd: "/home/user",
          git: null,
          location: LOCAL_LOCATION,
          lastActivityAt: 5,
          lastAgentCommand: "opencode --model sonnet",
          agentSession: { kind: "claude-code", id: "sess-mismatch" },
        },
      ],
      activeTerminalId: "t1",
      savedAt: 1_700_000_000_000,
    };
    expect(parseSavedSession(JSON.stringify(legacy))).toEqual({
      ...legacy,
      terminals: [
        {
          id: "t1",
          state: "active",
          cwd: "/home/user",
          git: null,
          location: LOCAL_LOCATION,
          lastActivityAt: 5,
          lastAgentCommand: "opencode --model sonnet",
          pr: { kind: "absent" },
          restoreTarget: {
            kind: "legacyMostRecent",
            command: "opencode --model sonnet",
          },
        },
      ],
    });
  });
});

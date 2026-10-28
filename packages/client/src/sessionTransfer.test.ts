import { LOCAL_LOCATION, type SavedSession } from "@kolu/padi-client/surface";
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
      git: { kind: "none" },
      // `pr` is a persisted (restore-relevant) field after the
      // awareness-derive-store cutover (PR #1621), so a current-schema export
      // carries it verbatim and the parse round-trips with no backfill.
      pr: { kind: "absent" },
      location: LOCAL_LOCATION,
      restoreTarget: { kind: "none" },
      lastActivityAt: 0,
      promptedAt: null,
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
    const empty: SavedSession = {
      terminals: [],
      activeTerminalId: null,
      savedAt: 1,
    };
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
    // `lastActivityAt` rides through verbatim — it predates these bumps. The
    // old nullable `git` becomes the three-case fact. A record with no resume
    // target keeps ABSENT (`none` is not invented for it).
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
          // The old `git: null` could mean "no repo" or "not sensed yet"; it
          // imports as `unresolved` and restore re-samples it.
          git: { kind: "unresolved" },
          state: "active",
          location: LOCAL_LOCATION,
          pr: { kind: "absent" },
          promptedAt: null,
        },
      ],
    });
  });

  it("maps a pre-cutover agentSession to an `exact` target from its STRUCTURED identity — the captured command is dropped, never parsed", () => {
    // The awareness-derive-store cutover (PR #1621) collapsed the sticky
    // `agentSession: { kind, id }` resume ref into the fold-derived discriminated
    // `restoreTarget`. The identity is structured data, so it still maps to an
    // `exact` target (the EXACT conversation, #1495) — `id` → `sessionId` — with an
    // EMPTY argv (the flags return on the next live sample). The captured
    // `lastAgentCommand` is DELETED and never read: re-parsing it is the forgery
    // hole. The record predates persisted `pr`, so it is backfilled `absent`.
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
          git: { kind: "unresolved" },
          location: LOCAL_LOCATION,
          lastActivityAt: 5,
          pr: { kind: "absent" },
          promptedAt: null,
          restoreTarget: {
            kind: "exact",
            agent: {
              kind: "claude-code",
              sessionId: "sess-123",
              resumeRef: "sess-123",
            },
            argv: [],
          },
        },
      ],
    });
  });

  it("maps a pre-cutover command WITHOUT an agentSession to `none` — a bare shell, never a re-parsed command", () => {
    // A record that remembered a launch command but never captured the session id
    // has nothing honest to resume: `legacyMostRecent` is retired, and turning the
    // captured text back into a target is the forgery hole. It imports resumable by
    // nothing — wake lands on a bare shell.
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
          git: { kind: "unresolved" },
          location: LOCAL_LOCATION,
          lastActivityAt: 5,
          pr: { kind: "absent" },
          promptedAt: null,
          restoreTarget: { kind: "none" },
        },
      ],
    });
  });

  it("ignores a captured command that names a DIFFERENT agent than the structured identity", () => {
    // A cross-agent pre-cutover record: the structured `agentSession` is a
    // claude-code conversation while the remembered line says opencode. There is
    // no pair to reconcile any more — the line is dropped, and the resume target
    // comes from the identity alone, so a wrong-agent resume is unspellable.
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
          git: { kind: "unresolved" },
          location: LOCAL_LOCATION,
          lastActivityAt: 5,
          pr: { kind: "absent" },
          promptedAt: null,
          restoreTarget: {
            kind: "exact",
            agent: {
              kind: "claude-code",
              sessionId: "sess-mismatch",
              resumeRef: "sess-mismatch",
            },
            argv: [],
          },
        },
      ],
    });
  });
});

/** juspay/kolu#2101 G9a sweep. `session.import` is client→server, the direction
 *  where an oversized frame closes the socket rather than failing the call. */
describe("parseSavedSession refuses a file too big for one wire frame", () => {
  it("rejects before parsing, naming both sizes", () => {
    // 5 MiB of JSON — past the ~4 MiB cap, and two orders of magnitude past any
    // real export. Deliberately VALID JSON so the refusal cannot be mistaken
    // for the malformed-JSON branch: the size gate must run first.
    const huge = `{"pad":"${"x".repeat(5 * 1024 * 1024)}"}`;
    expect(() => parseSavedSession(huge)).toThrow(/the limit is/);
    expect(() => parseSavedSession(huge)).toThrow(/5\.0 MiB/);
  });

  it("still accepts an ordinary export", () => {
    // Guard the guard: a cap that rejects real sessions would be worse than no
    // cap. This is the same round-trip the suite above exercises.
    expect(() => parseSavedSession(JSON.stringify(valid))).not.toThrow();
  });
});

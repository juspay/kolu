/**
 * BYTE fixtures for padi's two hit-list formats (PLAN #17 / `recon/zod.md`).
 *
 * `SavedSession` is padi's conf-store blob AND the user-exportable
 * `kolu-session.json` the client's import hatch ingests, so its encoded bytes
 * are a compatibility surface in BOTH directions: a blob written by a previous
 * release must decode here, and a blob written here must decode there. Decode
 * EQUALITY cannot see that — it is blind to key presence, key order, and to a
 * default that accepts a missing key but then fails to emit it. So every
 * assertion below is on the encoded JSON STRING.
 *
 * `DaemonStatus` is the other half: eleven ANTI-FIELDS make a payload field
 * structurally unspellable on the arms that must not carry it. Review #11 asked
 * for exactly one thing — verify the Effect construct actually REJECTS a present
 * value rather than quietly ignoring it — so each arm is tested in both
 * directions.
 */

import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  backfillSavedSession,
  DaemonStatusSchema,
  PersistedSnapshotSchema,
  SavedSessionSchema,
  SavedTerminalSchema,
} from "./vocab.ts";

const decodeSession = Schema.decodeUnknownSync(SavedSessionSchema);
const encodeSession = Schema.encodeUnknownSync(SavedSessionSchema);
const accepts = (
  schema: Parameters<typeof Schema.decodeUnknownResult>[0],
  value: unknown,
): boolean => Result.isSuccess(Schema.decodeUnknownResult(schema)(value));

/** A minimal ACTIVE saved terminal, spelled as it appears on disk. Field order
 *  is the schema's declaration order: the persisted observation, then the
 *  authored record (server fields, then client chrome), then the discriminant,
 *  then the id — exactly what the zod `.merge` chain produced. */
const MINIMAL_ACTIVE =
  '{"cwd":"/repo","git":null,"pr":{"kind":"absent"},"location":{"kind":"local"},"lastActivityAt":null,"state":"active","id":"t-1"}';

/** The same record with every optional authored + chrome field populated. */
const FULL_SLEEPING =
  '{"cwd":"/repo","git":null,"pr":{"kind":"absent"},"location":{"kind":"remote","hostId":"zest"},' +
  '"restoreTarget":{"kind":"exact","command":"claude","agent":{"kind":"claude-code","sessionId":"s-1"}},' +
  '"lastActivityAt":1700000000000,"lastAgentCommand":"claude","themeName":"nord","parentId":"t-0",' +
  '"canvasLayout":{"x":0,"y":1,"w":2,"h":3},"subPanel":{"collapsed":false,"panelSize":40},' +
  '"rightPanel":{"collapsed":true,"activeTab":"code","codeMode":"branch"},"intent":"ship it",' +
  '"state":"sleeping","sleptAt":1700000001000,"id":"t-2"}';

describe("SavedSession — the conf store + the exported kolu-session.json", () => {
  const roundTrip = (json: string): string =>
    JSON.stringify(encodeSession(decodeSession(JSON.parse(json))));

  it("a MINIMAL active record round-trips byte-for-byte", () => {
    const stored = `{"terminals":[${MINIMAL_ACTIVE}],"activeTerminalId":"t-1","savedAt":1700000000000}`;
    expect(roundTrip(stored)).toBe(stored);
  });

  it("a FULLY-POPULATED sleeping record round-trips byte-for-byte", () => {
    const stored = `{"terminals":[${FULL_SLEEPING}],"activeTerminalId":null,"savedAt":1700000000000,"resumableIds":["t-2"]}`;
    expect(roundTrip(stored)).toBe(stored);
  });

  it("activeTerminalId: a LEGACY blob that OMITS the key decodes to null AND re-encodes WITH it", () => {
    // The whole reason the field carries a decoding default: keep decoding TOTAL
    // over a blob that pre-dates it. The emit half is what a decode-equality test
    // cannot see — and it is what keeps a record written here readable as a
    // current record by the next release, rather than as another legacy one.
    const legacy = `{"terminals":[],"savedAt":1700000000000}`;
    expect(decodeSession(JSON.parse(legacy)).activeTerminalId).toBeNull();
    expect(roundTrip(legacy)).toBe(
      '{"terminals":[],"activeTerminalId":null,"savedAt":1700000000000}',
    );
  });

  it("activeTerminalId: an EXPLICIT undefined is REJECTED — absence is the only spelling", () => {
    // Stricter than zod's `.default(null)` on in-memory `undefined` (PLAN #17),
    // deliberately: a disk blob omits a key, it never stores `undefined`. Any
    // in-process caller building a session object must OMIT the key.
    expect(
      accepts(SavedSessionSchema, {
        terminals: [],
        activeTerminalId: undefined,
        savedAt: 1,
      }),
    ).toBe(false);
  });

  it("resumableIds: the WIRE-ONLY enrichment stays ABSENT when unstamped, never null", () => {
    // `optionalKey`, never `optional`: a conf blob and an e2e fixture parse
    // without it, and a decoded record that lacked it re-encodes without it.
    // `Schema.optional` would have round-tripped it through an explicit `null`,
    // which no writer ever produced.
    const encoded = encodeSession(
      decodeSession({ terminals: [], activeTerminalId: null, savedAt: 1 }),
    ) as Record<string, unknown>;
    expect("resumableIds" in encoded).toBe(false);
  });

  it("an unknown key is DROPPED, not rejected — the tolerant-read policy, preserved", () => {
    const withJunk = {
      terminals: [],
      activeTerminalId: null,
      savedAt: 1,
      somethingNewer: 42,
    };
    expect(JSON.stringify(encodeSession(decodeSession(withJunk)))).toBe(
      '{"terminals":[],"activeTerminalId":null,"savedAt":1}',
    );
  });

  it("a record with NO state discriminant is REJECTED — which is what the backfill exists to repair", () => {
    const legacyTerminal = {
      cwd: "/repo",
      git: null,
      pr: { kind: "absent" },
      location: { kind: "local" },
      lastActivityAt: null,
      id: "t-1",
    };
    expect(accepts(SavedTerminalSchema, legacyTerminal)).toBe(false);
    // ...and the composed backfill ladder makes it decodable again, which is the
    // property both the migration ladder and the client's import hatch rest on.
    const repaired = backfillSavedSession({
      terminals: [legacyTerminal],
      savedAt: 1,
    });
    expect(accepts(SavedSessionSchema, repaired)).toBe(true);
  });

  it("the backfill ladder rebuilds a PRE-CUTOVER record (no pr, an agentSession ref)", () => {
    const preCutover = {
      cwd: "/repo",
      git: null,
      location: { kind: "local" },
      lastActivityAt: 7,
      lastAgentCommand: "claude",
      agentSession: { kind: "claude-code", id: "s-9" },
      state: "active",
      id: "t-1",
    };
    const repaired = backfillSavedSession({
      terminals: [preCutover],
      savedAt: 1,
    }) as { terminals: Record<string, unknown>[] };
    const decoded = decodeSession(repaired).terminals[0];
    expect(decoded?.pr).toEqual({ kind: "absent" });
    expect(decoded?.restoreTarget).toEqual({
      kind: "exact",
      command: "claude",
      agent: { kind: "claude-code", sessionId: "s-9" },
    });
    // The old sticky ref is DROPPED, not carried alongside its successor.
    expect("agentSession" in (repaired.terminals[0] ?? {})).toBe(false);
  });

  it("a CORRUPT agentSession falls back to legacyMostRecent instead of dropping the terminal", () => {
    // The `safeParse` → `Result` translation, pinned where it bites: a bad
    // on-disk `kind` must be a BRANCH, never a throw that loses the record.
    const repaired = backfillSavedSession({
      terminals: [
        {
          cwd: "/repo",
          git: null,
          location: { kind: "local" },
          lastActivityAt: 7,
          lastAgentCommand: "claude",
          agentSession: { kind: "not-an-agent", id: 42 },
          state: "active",
          id: "t-1",
        },
      ],
      savedAt: 1,
    });
    expect(decodeSession(repaired).terminals[0]?.restoreTarget).toEqual({
      kind: "legacyMostRecent",
      command: "claude",
    });
  });
});

describe("PersistedSnapshot — the restore-relevant projection, in bytes", () => {
  it("keeps exactly cwd · git · pr, in that order, and drops the live half", () => {
    const decoded = Schema.decodeUnknownSync(PersistedSnapshotSchema)({
      cwd: "/repo",
      git: null,
      pr: { kind: "absent" },
      // The live half a full `TerminalSnapshot` carries — dropped structurally,
      // so a future live field can never silently ride to disk.
      agent: { kind: "claude-code" },
      foreground: { name: "vim", title: null },
      ports: { status: "unknown" },
    });
    expect(
      JSON.stringify(
        Schema.encodeUnknownSync(PersistedSnapshotSchema)(decoded),
      ),
    ).toBe('{"cwd":"/repo","git":null,"pr":{"kind":"absent"}}');
  });
});

// ── review #11: the eleven anti-fields ────────────────────────────────────

describe("DaemonStatus anti-fields — a present value is REJECTED, not ignored", () => {
  const CONNECTED = {
    state: "connected",
    contractVersion: "7.0",
    startedAt: 1_700_000_000_000,
  };
  const INCOMPATIBLE = {
    state: "incompatible",
    daemonVersion: "6.0",
    requiredVersion: "7.0",
  };
  const DOWN = { state: "dead" };

  it("the baseline arms decode", () => {
    expect(accepts(DaemonStatusSchema, CONNECTED)).toBe(true);
    expect(accepts(DaemonStatusSchema, INCOMPATIBLE)).toBe(true);
    expect(accepts(DaemonStatusSchema, DOWN)).toBe(true);
  });

  it("the CONNECTED arm cannot spell the skew fields", () => {
    // This is the check review #11 asked to VERIFY rather than assume:
    // `Schema.optionalKey(Schema.Never)` must REFUSE a present value, or the
    // eleven anti-fields are decoration.
    for (const field of ["daemonVersion", "requiredVersion"]) {
      expect(
        accepts(DaemonStatusSchema, { ...CONNECTED, [field]: "6.0" }),
      ).toBe(false);
      // An explicit `undefined` is refused too — the key must be ABSENT.
      expect(
        accepts(DaemonStatusSchema, { ...CONNECTED, [field]: undefined }),
      ).toBe(false);
    }
  });

  it("the INCOMPATIBLE arm cannot spell the connected payload", () => {
    const present: Record<string, unknown> = {
      identity: { staleKey: "k", navigableCommit: "c" },
      contractVersion: "7.0",
      startedAt: 1,
      adopted: 1,
      adoptedAt: 1,
      lifetime: { kind: "forever" },
    };
    for (const [field, value] of Object.entries(present)) {
      expect(
        accepts(DaemonStatusSchema, { ...INCOMPATIBLE, [field]: value }),
      ).toBe(false);
    }
    // ...but `socketPath` IS spellable on this arm (it is a real field here).
    expect(
      accepts(DaemonStatusSchema, { ...INCOMPATIBLE, socketPath: "/run/k" }),
    ).toBe(true);
  });

  it("a NON-CONNECTED arm cannot spell either payload", () => {
    const present: Record<string, unknown> = {
      identity: { staleKey: "k", navigableCommit: "c" },
      contractVersion: "7.0",
      startedAt: 1,
      adopted: 1,
      adoptedAt: 1,
      lifetime: { kind: "forever" },
      daemonVersion: "6.0",
      requiredVersion: "7.0",
    };
    for (const [field, value] of Object.entries(present)) {
      expect(accepts(DaemonStatusSchema, { ...DOWN, [field]: value })).toBe(
        false,
      );
    }
    expect(accepts(DaemonStatusSchema, { ...DOWN, socketPath: "/run/k" })).toBe(
      true,
    );
  });

  it("BYTES: the connected arm emits its optional fields only when present", () => {
    const encode = Schema.encodeUnknownSync(DaemonStatusSchema);
    const decode = Schema.decodeUnknownSync(DaemonStatusSchema);
    expect(JSON.stringify(encode(decode(CONNECTED)))).toBe(
      '{"state":"connected","contractVersion":"7.0","startedAt":1700000000000}',
    );
    expect(JSON.stringify(encode(decode(INCOMPATIBLE)))).toBe(
      '{"state":"incompatible","daemonVersion":"6.0","requiredVersion":"7.0"}',
    );
  });
});

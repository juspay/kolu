import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  backfillRestoreTargetArgv,
  backfillSavedSession,
  backfillSnapshotCutover,
  DaemonStatusSchema,
  DEFAULT_PADI_PROCESS_MEMORY,
  type PadiProcessMemory,
  PadiProcessMemorySchema,
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

const SAVED_ID_1 = "11111111-1111-4111-8111-111111111111";
const SAVED_ID_2 = "22222222-2222-4222-8222-222222222222";
const SAVED_PARENT_ID = "00000000-0000-4000-8000-000000000000";

const MINIMAL_ACTIVE =
  '{"cwd":"/repo","git":{"kind":"none"},"pr":{"kind":"absent"},"location":{"kind":"local"},"restoreTarget":{"kind":"none"},"lastActivityAt":null,"promptedAt":null,"state":"active","id":"' +
  `${SAVED_ID_1}"}`;

const FULL_SLEEPING =
  '{"cwd":"/repo","git":{"kind":"none"},"pr":{"kind":"absent"},"location":{"kind":"remote","hostId":"zest"},' +
  '"restoreTarget":{"kind":"exact","agent":{"kind":"claude-code","sessionId":"s-1","resumeRef":"s-1"},"argv":["--model","sonnet"]},' +
  `"lastActivityAt":1700000000000,"promptedAt":1699999999000,"themeName":"nord","parentId":"${SAVED_PARENT_ID}",` +
  '"canvasLayout":{"x":0,"y":1,"w":2,"h":3},"subPanel":{"collapsed":false,"panelSize":40},' +
  '"rightPanel":{"collapsed":true,"activeTab":"code","codeMode":"branch"},"intent":"ship it",' +
  `"state":"sleeping","sleptAt":1700000001000,"id":"${SAVED_ID_2}"}`;

describe("SavedSession — the conf store + the exported kolu-session.json", () => {
  const roundTrip = (json: string): string =>
    JSON.stringify(encodeSession(decodeSession(JSON.parse(json))));

  it("a MINIMAL active record round-trips byte-for-byte", () => {
    const stored = `{"terminals":[${MINIMAL_ACTIVE}],"activeTerminalId":"${SAVED_ID_1}","savedAt":1700000000000}`;
    expect(roundTrip(stored)).toBe(stored);
  });

  it("a FULLY-POPULATED sleeping record round-trips byte-for-byte", () => {
    const stored = `{"terminals":[${FULL_SLEEPING}],"activeTerminalId":null,"savedAt":1700000000000,"resumableIds":["${SAVED_ID_2}"]}`;
    expect(roundTrip(stored)).toBe(stored);
  });

  it("promptedAt: a LEGACY terminal that OMITS the key decodes to null AND re-encodes WITH it", () => {
    const legacy = MINIMAL_ACTIVE.replace('"promptedAt":null,', "");
    const stored = (t: string) =>
      `{"terminals":[${t}],"activeTerminalId":"${SAVED_ID_1}","savedAt":1700000000000}`;
    expect(
      decodeSession(JSON.parse(stored(legacy))).terminals[0]?.promptedAt,
    ).toBeNull();
    expect(roundTrip(stored(legacy))).toBe(stored(MINIMAL_ACTIVE));
  });

  it('git: a LEGACY stored `"git":null` backfills to unresolved AND re-encodes in the new shape', () => {
    const legacy = MINIMAL_ACTIVE.replace('"git":{"kind":"none"}', '"git":null')
      .replace('"promptedAt":null,', "")
      .replace('"restoreTarget":{"kind":"none"},', "");
    const migrated = MINIMAL_ACTIVE.replace(
      '"git":{"kind":"none"}',
      '"git":{"kind":"unresolved"}',
    ).replace('"restoreTarget":{"kind":"none"},', "");
    const stored = (t: string) =>
      `{"terminals":[${t}],"activeTerminalId":"${SAVED_ID_1}","savedAt":1700000000000}`;
    expect(accepts(SavedSessionSchema, JSON.parse(stored(legacy)))).toBe(false);
    expect(
      JSON.stringify(
        encodeSession(
          decodeSession(backfillSavedSession(JSON.parse(stored(legacy)))),
        ),
      ),
    ).toBe(stored(migrated));
  });

  it("activeTerminalId: a LEGACY blob that OMITS the key decodes to null AND re-encodes WITH it", () => {
    const legacy = `{"terminals":[],"savedAt":1700000000000}`;
    expect(decodeSession(JSON.parse(legacy)).activeTerminalId).toBeNull();
    expect(roundTrip(legacy)).toBe(
      '{"terminals":[],"activeTerminalId":null,"savedAt":1700000000000}',
    );
  });

  it("activeTerminalId: an EXPLICIT undefined is REJECTED — absence is the only spelling", () => {
    expect(
      accepts(SavedSessionSchema, {
        terminals: [],
        activeTerminalId: undefined,
        savedAt: 1,
      }),
    ).toBe(false);
  });

  it("resumableIds: the WIRE-ONLY enrichment stays ABSENT when unstamped, never null", () => {
    const encoded = encodeSession(
      decodeSession({ terminals: [], activeTerminalId: null, savedAt: 1 }),
    ) as Record<string, unknown>;
    expect("resumableIds" in encoded).toBe(false);
  });

  it("id: a record whose id is NOT a TerminalId is REFUSED at the decode", () => {
    const terminal = {
      cwd: "/repo",
      git: { kind: "none" },
      pr: { kind: "absent" },
      location: { kind: "local" },
      lastActivityAt: null,
      state: "active",
    };
    expect(
      accepts(SavedSessionSchema, {
        terminals: [{ ...terminal, id: "0" }],
        activeTerminalId: null,
        savedAt: 1,
      }),
    ).toBe(false);
    expect(
      accepts(
        SavedSessionSchema,
        backfillSavedSession({
          terminals: [{ ...terminal, id: "not-a-uuid" }],
          savedAt: 1,
        }),
      ),
    ).toBe(false);
    expect(
      accepts(SavedSessionSchema, {
        terminals: [{ ...terminal, id: SAVED_ID_1 }],
        activeTerminalId: null,
        savedAt: 1,
      }),
    ).toBe(true);
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
      id: SAVED_ID_1,
    };
    expect(accepts(SavedTerminalSchema, legacyTerminal)).toBe(false);
    const repaired = backfillSavedSession({
      terminals: [legacyTerminal],
      savedAt: 1,
    });
    expect(accepts(SavedSessionSchema, repaired)).toBe(true);
  });

  it("the backfill ladder rebuilds a PRE-CUTOVER record from its STRUCTURED identity", () => {
    const preCutover = {
      cwd: "/repo",
      git: null,
      location: { kind: "local" },
      lastActivityAt: 7,
      lastAgentCommand: "LD_PRELOAD=/x claude --settings '{}'",
      agentSession: { kind: "claude-code", id: "s-9" },
      state: "active",
      id: SAVED_ID_1,
    };
    const repaired = backfillSavedSession({
      terminals: [preCutover],
      savedAt: 1,
    }) as { terminals: Record<string, unknown>[] };
    const decoded = decodeSession(repaired).terminals[0];
    expect(decoded?.pr).toEqual({ kind: "absent" });
    expect(decoded?.restoreTarget).toEqual({
      kind: "exact",
      agent: { kind: "claude-code", sessionId: "s-9", resumeRef: "s-9" },
      argv: [],
    });
    expect("agentSession" in (repaired.terminals[0] ?? {})).toBe(false);
    expect("lastAgentCommand" in (repaired.terminals[0] ?? {})).toBe(false);
  });

  it("a record that ONLY remembered a launch line restores NOTHING — the text is never re-parsed", () => {
    const repaired = backfillSavedSession({
      terminals: [
        {
          cwd: "/repo",
          git: null,
          location: { kind: "local" },
          lastActivityAt: 7,
          lastAgentCommand: "LD_PRELOAD=/x claude --settings '{}'",
          state: "active",
          id: SAVED_ID_1,
        },
      ],
      savedAt: 1,
    });
    expect(decodeSession(repaired).terminals[0]?.restoreTarget).toEqual({
      kind: "none",
    });
  });

  it("a CORRUPT agentSession yields `none` instead of dropping the terminal", () => {
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
          id: SAVED_ID_1,
        },
      ],
      savedAt: 1,
    });
    expect(decodeSession(repaired).terminals[0]?.restoreTarget).toEqual({
      kind: "none",
    });
  });

  it("migrates an old exact{command} target to exact{argv:[]} without reading the command", () => {
    const repaired = backfillSavedSession({
      terminals: [
        {
          cwd: "/repo",
          git: null,
          pr: { kind: "absent" },
          location: { kind: "local" },
          lastActivityAt: 7,
          restoreTarget: {
            kind: "exact",
            command: "LD_PRELOAD=/x claude --settings '{}'",
            agent: {
              kind: "claude-code",
              sessionId: "s-9",
              resumeRef: "s-9",
            },
          },
          state: "active",
          id: SAVED_ID_1,
        },
      ],
      savedAt: 1,
    });
    const target = decodeSession(repaired).terminals[0]?.restoreTarget;
    expect(target).toEqual({
      kind: "exact",
      agent: { kind: "claude-code", sessionId: "s-9", resumeRef: "s-9" },
      argv: [],
    });
    expect(JSON.stringify(target)).not.toContain("LD_PRELOAD");
  });

  it("leaves an ABSENT restore target absent — absence is its own spelling", () => {
    const repaired = backfillSavedSession({
      terminals: [
        {
          cwd: "/repo",
          git: null,
          location: { kind: "local" },
          lastActivityAt: 7,
          state: "active",
          id: SAVED_ID_1,
        },
      ],
      savedAt: 1,
    }) as { terminals: Record<string, unknown>[] };
    expect("restoreTarget" in (repaired.terminals[0] ?? {})).toBe(false);
    expect(decodeSession(repaired).terminals[0]?.restoreTarget).toBeUndefined();
  });

  it("splits the transition across rungs: #1621 emits its era's shape, 1.3.0 converts", () => {
    const command = "LD_PRELOAD=/x claude --settings '{}'";
    const cutover = backfillSnapshotCutover({
      cwd: "/repo",
      git: null,
      lastAgentCommand: command,
      agentSession: { kind: "claude-code", id: "s-9" },
      state: "active",
      id: SAVED_ID_1,
    });
    expect(cutover.restoreTarget).toEqual({
      kind: "exact",
      command,
      agent: { kind: "claude-code", sessionId: "s-9", resumeRef: "s-9" },
    });
    expect(cutover.lastAgentCommand).toBe(command);
    const converted = backfillRestoreTargetArgv(cutover);
    expect(converted.restoreTarget).toEqual({
      kind: "exact",
      agent: { kind: "claude-code", sessionId: "s-9", resumeRef: "s-9" },
      argv: [],
    });
    expect("lastAgentCommand" in converted).toBe(false);
  });

  it("migrates legacyMostRecent to none — it named no conversation", () => {
    const repaired = backfillSavedSession({
      terminals: [
        {
          cwd: "/repo",
          git: null,
          pr: { kind: "absent" },
          location: { kind: "local" },
          lastActivityAt: 7,
          restoreTarget: { kind: "legacyMostRecent", command: "claude" },
          state: "active",
          id: SAVED_ID_1,
        },
      ],
      savedAt: 1,
    });
    expect(decodeSession(repaired).terminals[0]?.restoreTarget).toEqual({
      kind: "none",
    });
  });

  describe("pr: a resolved PR saved before the forge said draft", () => {
    const OLD_OK_PR =
      '{"kind":"ok","value":{"number":7,"title":"Fix the parser",' +
      '"url":"https://github.example/o/r/pull/7","state":"open","checks":"pass",' +
      '"checkRuns":[],"reviewDecision":null,"mergeStateStatus":"CLEAN",' +
      '"headSha":"4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3"}}';
    const NEW_OK_PR = OLD_OK_PR.replace("}}", ',"isDraft":true}}');
    const withPr = (record: string, pr: string) =>
      record.replace('"pr":{"kind":"absent"}', `"pr":${pr}`);
    const stored = (...terminals: string[]) =>
      `{"terminals":[${terminals.join(",")}],"activeTerminalId":null,"savedAt":1700000000000}`;
    const PENDING = '{"kind":"pending"}';

    it("is refused by the schema alone, and becomes pending on BOTH arms through the backfill", () => {
      const legacy = stored(
        withPr(MINIMAL_ACTIVE, OLD_OK_PR),
        withPr(FULL_SLEEPING, OLD_OK_PR),
      );
      expect(accepts(SavedSessionSchema, JSON.parse(legacy))).toBe(false);
      expect(
        JSON.stringify(
          encodeSession(
            decodeSession(backfillSavedSession(JSON.parse(legacy))),
          ),
        ),
      ).toBe(
        stored(withPr(MINIMAL_ACTIVE, PENDING), withPr(FULL_SLEEPING, PENDING)),
      );
    });

    it("is idempotent: a second pass over the backfilled session changes nothing", () => {
      const once = backfillSavedSession(
        JSON.parse(stored(withPr(MINIMAL_ACTIVE, OLD_OK_PR))),
      );
      expect(backfillSavedSession(once)).toEqual(once);
    });

    it("leaves a PR that says draft, and every other kind, as found — and saves isDraft in bytes", () => {
      const current = stored(
        withPr(MINIMAL_ACTIVE, NEW_OK_PR),
        withPr(FULL_SLEEPING, '{"kind":"unsupported"}'),
      );
      expect(
        JSON.stringify(
          encodeSession(
            decodeSession(backfillSavedSession(JSON.parse(current))),
          ),
        ),
      ).toBe(current);
      expect(roundTrip(current)).toContain(
        '"headSha":"4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3","isDraft":true}}',
      );
    });
  });
});

describe("PersistedSnapshot — the restore-relevant projection, in bytes", () => {
  it("keeps exactly cwd · git · pr, in that order, and drops the live half", () => {
    const decoded = Schema.decodeUnknownSync(PersistedSnapshotSchema)({
      cwd: "/repo",
      git: { kind: "none" },
      pr: { kind: "absent" },
      agent: { kind: "claude-code" },
      foreground: { name: "vim", title: null, shell: false },
      ports: { status: "unknown" },
    });
    expect(
      JSON.stringify(
        Schema.encodeUnknownSync(PersistedSnapshotSchema)(decoded),
      ),
    ).toBe('{"cwd":"/repo","git":{"kind":"none"},"pr":{"kind":"absent"}}');
  });
});

describe("PadiProcessMemory — the processMemory cell's wire bytes", () => {
  const encode = (value: PadiProcessMemory): string =>
    JSON.stringify(Schema.encodeUnknownSync(PadiProcessMemorySchema)(value));

  it("keeps padi BEFORE kaval, each an independent three-way arm", () => {
    expect(
      encode({
        padi: { status: "ok", rssBytes: 10_485_760 },
        kaval: { status: "absent" },
      }),
    ).toBe(
      '{"padi":{"status":"ok","rssBytes":10485760},"kaval":{"status":"absent"}}',
    );
  });

  it("the three arms of each side survive the round trip byte-for-byte", () => {
    expect(
      encode({
        padi: { status: "ok", rssBytes: 1 },
        kaval: { status: "error" },
      }),
    ).toBe('{"padi":{"status":"ok","rssBytes":1},"kaval":{"status":"error"}}');
    expect(
      encode({ padi: { status: "error" }, kaval: { status: "error" } }),
    ).toBe('{"padi":{"status":"error"},"kaval":{"status":"error"}}');
    expect(encode(DEFAULT_PADI_PROCESS_MEMORY)).toBe(
      '{"padi":{"status":"absent"},"kaval":{"status":"absent"}}',
    );
  });

  it("an `ok` arm without rssBytes is REJECTED — the number is the whole fact", () => {
    expect(
      accepts(PadiProcessMemorySchema, {
        padi: { status: "ok" },
        kaval: { status: "absent" },
      }),
    ).toBe(false);
  });

  it("a stale rssBytes on a NON-ok arm never reaches the wire", () => {
    const encoded = Schema.encodeUnknownSync(PadiProcessMemorySchema)(
      Schema.decodeUnknownSync(PadiProcessMemorySchema)({
        padi: { status: "absent", rssBytes: 1 },
        kaval: { status: "error", rssBytes: 2 },
      }),
    );
    expect(JSON.stringify(encoded)).toBe(
      '{"padi":{"status":"absent"},"kaval":{"status":"error"}}',
    );
  });
});

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
    for (const field of ["daemonVersion", "requiredVersion"]) {
      expect(
        accepts(DaemonStatusSchema, { ...CONNECTED, [field]: "6.0" }),
      ).toBe(false);
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

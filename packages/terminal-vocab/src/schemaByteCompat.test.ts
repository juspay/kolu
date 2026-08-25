/**
 * BYTE-level fixtures for the terminal vocabulary — the formats on the
 * migration's byte-compatibility hit list that THIS package owns.
 *
 * `TerminalSnapshot` is persisted (padi seeds terminals from stored records on
 * cold boot) and served on `terminalWorkspace.snapshots`; `AgentMemory` is the
 * flat on-disk memory pair. Both cross a wire between processes of DIFFERENT
 * builds, so the assertions here are on the encoded JSON **string**, not on
 * decode-equality: a schema change that reorders keys, renames a discriminant,
 * or starts omitting a key would pass a `toEqual` and still break a rolling
 * deploy.
 *
 * The three properties pinned:
 *   1. ENCODED BYTES — `JSON.stringify(encodeSync(...))` character for character.
 *   2. LEGACY DECODE — a record written before `lastActivityAt` existed decodes
 *      to the honest `null` (the documented backfill e2e steps rely on), and a
 *      record without `lastAgentCommand` decodes without the key.
 *   3. DISCRIMINANTS — every arm of the five unions keeps its field name and its
 *      literal values.
 */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { PortInfoSchema, TcpPortSchema } from "./ports.ts";
import {
  AgentMemorySchema,
  ForegroundSchema,
  ProcessRssSchema,
  PrResultSchema,
  PrUnavailableSourceSchema,
  RepoChangePulseSchema,
  seedMemory,
  seedSnapshot,
  TerminalIdSchema,
  TerminalPortsSchema,
  TerminalSnapshotSchema,
} from "./schema.ts";

/** Encode through the schema and serialize — the only assertion that catches a
 *  key reorder, a dropped key, or a renamed discriminant. */
const encodeJson = <T, E>(schema: Schema.Codec<T, E>) => {
  const encode = Schema.encodeSync(schema);
  return (value: T): string => JSON.stringify(encode(value));
};

describe("AgentMemory — the flat on-disk memory pair", () => {
  it("encodes lastActivityAt=null with the key PRESENT", () => {
    // The `null` is a value on disk, not an absence: `withDecodingDefaultKey`
    // passes through on encode, so a fresh writer emits exactly what every
    // previous kolu wrote.
    expect(encodeJson(AgentMemorySchema)(seedMemory())).toBe(
      '{"lastActivityAt":null}',
    );
  });

  it("encodes a live memory with both keys, in declaration order", () => {
    expect(
      encodeJson(AgentMemorySchema)({
        lastActivityAt: 1_712_345_678_901,
        lastAgentCommand: "claude --model sonnet",
      }),
    ).toBe(
      '{"lastActivityAt":1712345678901,"lastAgentCommand":"claude --model sonnet"}',
    );
  });

  it("BACKFILLS a legacy record with no lastActivityAt key to null", () => {
    // The documented rolling-deploy/backfill tolerance: a record persisted
    // before the field existed must still load, reading as "never active"
    // rather than a forged Unix-epoch 0.
    expect(Schema.decodeUnknownSync(AgentMemorySchema)({})).toEqual({
      lastActivityAt: null,
    });
    expect(
      Schema.decodeUnknownSync(AgentMemorySchema)({
        lastAgentCommand: "codex",
      }),
    ).toEqual({ lastActivityAt: null, lastAgentCommand: "codex" });
  });

  it("leaves lastAgentCommand ABSENT rather than undefined when unset", () => {
    const decoded = Schema.decodeUnknownSync(AgentMemorySchema)({
      lastActivityAt: 5,
    });
    expect("lastAgentCommand" in decoded).toBe(false);
    expect(JSON.stringify(decoded)).toBe('{"lastActivityAt":5}');
  });

  it("round-trips a stored record byte-for-byte", () => {
    const stored = '{"lastActivityAt":1712345678901,"lastAgentCommand":"grok"}';
    const decoded = Schema.decodeUnknownSync(AgentMemorySchema)(
      JSON.parse(stored),
    );
    expect(encodeJson(AgentMemorySchema)(decoded)).toBe(stored);
  });

  it("rejects a non-numeric lastActivityAt instead of quietly defaulting", () => {
    expect(
      Schema.decodeUnknownResult(AgentMemorySchema)({ lastActivityAt: "5" })
        ._tag,
    ).toBe("Failure");
  });
});

describe("TerminalSnapshot — the persisted + served producer emission", () => {
  it("encodes a seed snapshot to the exact stored bytes", () => {
    expect(
      encodeJson(TerminalSnapshotSchema)(seedSnapshot("/home/u/code")),
    ).toBe(
      '{"cwd":"/home/u/code","git":null,"pr":{"kind":"pending"},"agent":null,' +
        '"foreground":null,"ports":{"status":"unknown"}}',
    );
  });

  it("encodes a fully populated snapshot to the exact stored bytes", () => {
    const full = {
      cwd: "/home/u/code/kolu",
      git: {
        repoRoot: "/home/u/code/kolu",
        repoName: "kolu",
        worktreePath: "/home/u/code/kolu",
        branch: "effect",
        isWorktree: false,
        mainRepoRoot: "/home/u/code/kolu",
        remoteUrl: "https://github.com/juspay/kolu",
      },
      pr: {
        kind: "ok",
        value: {
          number: 2100,
          title: "Wave 3",
          url: "https://github.com/juspay/kolu/pull/2100",
          state: "open",
          checks: "pass",
          checkRuns: [{ name: "unit", outcome: "pass" }],
          reviewDecision: "APPROVED",
          mergeStateStatus: "CLEAN",
        },
      },
      agent: {
        kind: "claude-code",
        state: "thinking",
        sessionId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        model: "claude-opus-5",
        summary: null,
        taskProgress: null,
        workflow: null,
        contextTokens: 47_000,
        startedAt: 1_712_345_678_901,
      },
      foreground: { name: "claude", title: "user@host: ~/code" },
      ports: {
        status: "known",
        list: [{ port: 5173, name: "node", scope: "loopback", family: "v4" }],
      },
    } as const satisfies typeof TerminalSnapshotSchema.Type;

    expect(encodeJson(TerminalSnapshotSchema)(full)).toBe(
      '{"cwd":"/home/u/code/kolu",' +
        '"git":{"repoRoot":"/home/u/code/kolu","repoName":"kolu","worktreePath":"/home/u/code/kolu",' +
        '"branch":"effect","isWorktree":false,"mainRepoRoot":"/home/u/code/kolu",' +
        '"remoteUrl":"https://github.com/juspay/kolu"},' +
        '"pr":{"kind":"ok","value":{"number":2100,"title":"Wave 3",' +
        '"url":"https://github.com/juspay/kolu/pull/2100","state":"open","checks":"pass",' +
        '"checkRuns":[{"name":"unit","outcome":"pass"}],' +
        '"reviewDecision":"APPROVED","mergeStateStatus":"CLEAN"}},' +
        '"agent":{"kind":"claude-code","state":"thinking",' +
        '"sessionId":"f47ac10b-58cc-4372-a567-0e02b2c3d479","model":"claude-opus-5",' +
        '"summary":null,"taskProgress":null,"workflow":null,"contextTokens":47000,' +
        '"startedAt":1712345678901},' +
        '"foreground":{"name":"claude","title":"user@host: ~/code"},' +
        '"ports":{"status":"known","list":[{"port":5173,"name":"node","scope":"loopback","family":"v4"}]}}',
    );
  });

  it("decodes an OLDER producer's payload whose PR carries no checkRuns / review / merge keys", () => {
    // Rolling deploy: the anyforge leaf's field backfills have to survive
    // being composed into this snapshot, not just decoded standalone.
    const decoded = Schema.decodeUnknownSync(TerminalSnapshotSchema)({
      cwd: "/w",
      git: null,
      pr: {
        kind: "ok",
        value: {
          number: 1,
          title: "t",
          url: "u",
          state: "open",
          checks: null,
        },
      },
      agent: null,
      foreground: null,
      ports: { status: "unknown" },
    });
    expect(decoded.pr).toEqual({
      kind: "ok",
      value: {
        number: 1,
        title: "t",
        url: "u",
        state: "open",
        checks: null,
        checkRuns: [],
        reviewDecision: null,
        mergeStateStatus: "UNKNOWN",
      },
    });
  });

  it("drops unknown keys rather than carrying a newer producer's fields through", () => {
    const decoded = Schema.decodeUnknownSync(TerminalSnapshotSchema)({
      ...seedSnapshot("/w"),
      somethingNewer: 1,
    });
    expect(Object.keys(decoded)).toEqual([
      "cwd",
      "git",
      "pr",
      "agent",
      "foreground",
      "ports",
    ]);
  });
});

describe("discriminants — the five unions keep their field and values", () => {
  it("PrResult: kind ∈ pending|ok|absent|unsupported|unavailable", () => {
    const encode = encodeJson(PrResultSchema);
    expect(encode({ kind: "pending" })).toBe('{"kind":"pending"}');
    expect(encode({ kind: "absent" })).toBe('{"kind":"absent"}');
    expect(encode({ kind: "unsupported" })).toBe('{"kind":"unsupported"}');
    expect(
      encode({
        kind: "unavailable",
        source: { provider: "gh", code: "timed-out" },
      }),
    ).toBe(
      '{"kind":"unavailable","source":{"provider":"gh","code":"timed-out"}}',
    );
  });

  it("PrUnavailableSource: provider is the tag, gh is the only arm today", () => {
    expect(
      encodeJson(PrUnavailableSourceSchema)({
        provider: "gh",
        code: "not-installed",
      }),
    ).toBe('{"provider":"gh","code":"not-installed"}');
    expect(
      Schema.decodeUnknownResult(PrUnavailableSourceSchema)({
        provider: "gitlab",
        code: "unknown",
      })._tag,
    ).toBe("Failure");
  });

  it("TerminalPorts: status ∈ known|unknown, and known carries `list`", () => {
    const encode = encodeJson(TerminalPortsSchema);
    expect(encode({ status: "unknown" })).toBe('{"status":"unknown"}');
    expect(encode({ status: "known", list: [] })).toBe(
      '{"status":"known","list":[]}',
    );
    expect(
      encode({
        status: "known",
        list: [{ port: 8080, name: "node", scope: "any", family: "v6" }],
      }),
    ).toBe(
      '{"status":"known","list":[{"port":8080,"name":"node","scope":"any","family":"v6"}]}',
    );
  });

  it("ProcessRss: status ∈ ok|absent|error, and ok carries `rssBytes`", () => {
    const encode = encodeJson(ProcessRssSchema);
    expect(encode({ status: "ok", rssBytes: 123_456 })).toBe(
      '{"status":"ok","rssBytes":123456}',
    );
    expect(encode({ status: "absent" })).toBe('{"status":"absent"}');
    expect(encode({ status: "error" })).toBe('{"status":"error"}');
  });

  it("AgentInfo: `kind` selects the per-agent arm inside a snapshot", () => {
    const decoded = Schema.decodeUnknownSync(TerminalSnapshotSchema)({
      ...seedSnapshot("/w"),
      agent: {
        kind: "codex",
        state: "thinking",
        sessionId: "s",
        model: null,
        summary: null,
        taskProgress: null,
        contextTokens: null,
        startedAt: null,
      },
    });
    expect(decoded.agent?.kind).toBe("codex");
  });
});

describe("leaf schemas", () => {
  it("Foreground keeps a nullable title", () => {
    const encode = encodeJson(ForegroundSchema);
    expect(encode({ name: "vim", title: "vim file.ts" })).toBe(
      '{"name":"vim","title":"vim file.ts"}',
    );
    expect(encode({ name: "bash", title: null })).toBe(
      '{"name":"bash","title":null}',
    );
  });

  it("TerminalId accepts a UUID and refuses anything else", () => {
    const id = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    expect(Schema.decodeUnknownSync(TerminalIdSchema)(id)).toBe(id);
    expect(Schema.decodeUnknownResult(TerminalIdSchema)("t1")._tag).toBe(
      "Failure",
    );
  });

  it("PortInfo encodes its four fields in declaration order", () => {
    expect(
      encodeJson(PortInfoSchema)({
        port: 1,
        name: "sshd",
        scope: "interface",
        family: "v4",
      }),
    ).toBe('{"port":1,"name":"sshd","scope":"interface","family":"v4"}');
  });

  it("TcpPort holds the 1..65535 range", () => {
    const parse = Schema.decodeUnknownResult(TcpPortSchema);
    expect(parse(1)._tag).toBe("Success");
    expect(parse(65_535)._tag).toBe("Success");
    expect(parse(0)._tag).toBe("Failure");
    expect(parse(65_536)._tag).toBe("Failure");
    expect(parse(80.5)._tag).toBe("Failure");
  });

  it("RepoChangePulse holds seq as a non-negative integer", () => {
    expect(encodeJson(RepoChangePulseSchema)({ seq: 0 })).toBe('{"seq":0}');
    expect(
      Schema.decodeUnknownResult(RepoChangePulseSchema)({ seq: -1 })._tag,
    ).toBe("Failure");
    expect(
      Schema.decodeUnknownResult(RepoChangePulseSchema)({ seq: 1.5 })._tag,
    ).toBe("Failure");
  });
});

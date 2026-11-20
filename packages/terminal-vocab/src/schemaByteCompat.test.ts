import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { PortInfoSchema, TcpPortSchema } from "./ports.ts";
import {
  AgentMemorySchema,
  ForegroundSchema,
  HostListenersSchema,
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

const encodeJson = <T, E>(schema: Schema.Codec<T, E>) => {
  const encode = Schema.encodeSync(schema);
  return (value: T): string => JSON.stringify(encode(value));
};

describe("AgentMemory — the flat on-disk memory pair", () => {
  it("encodes lastActivityAt=null and promptedAt=null with the keys PRESENT", () => {
    expect(encodeJson(AgentMemorySchema)(seedMemory())).toBe(
      '{"lastActivityAt":null,"promptedAt":null}',
    );
  });

  it("encodes a live memory with every key, in declaration order", () => {
    expect(
      encodeJson(AgentMemorySchema)({
        lastActivityAt: 1_712_345_678_901,
        promptedAt: 1_712_345_600_000,
      }),
    ).toBe('{"lastActivityAt":1712345678901,"promptedAt":1712345600000}');
  });

  it("has NO remembered launch line — a captured command is not memory", () => {
    const decoded = Schema.decodeUnknownSync(AgentMemorySchema)({
      lastActivityAt: 1,
      lastAgentCommand: "LD_PRELOAD=/x claude --settings '{}'",
    });
    expect(encodeJson(AgentMemorySchema)(decoded)).toBe(
      '{"lastActivityAt":1,"promptedAt":null}',
    );
  });

  it("BACKFILLS a legacy record with no lastActivityAt / promptedAt key to null", () => {
    expect(Schema.decodeUnknownSync(AgentMemorySchema)({})).toEqual({
      lastActivityAt: null,
      promptedAt: null,
    });
  });

  it("round-trips a stored record byte-for-byte", () => {
    const stored =
      '{"lastActivityAt":1712345678901,"promptedAt":1712345600000}';
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
      '{"cwd":"/home/u/code","git":{"kind":"unresolved"},"pr":{"kind":"pending"},"agent":null,' +
        '"foreground":null,"ports":{"status":"unknown"}}',
    );
  });

  it("encodes a fully populated snapshot to the exact stored bytes", () => {
    const full = {
      cwd: "/home/u/code/kolu",
      git: {
        kind: "repo",
        info: {
          repoRoot: "/home/u/code/kolu",
          repoName: "kolu",
          worktreePath: "/home/u/code/kolu",
          branch: "effect",
          isWorktree: false,
          mainRepoRoot: "/home/u/code/kolu",
          remoteUrl: "https://github.com/juspay/kolu",
          isBare: false,
        },
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
          headSha: "4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3",
          isDraft: false,
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
      foreground: { name: "claude", title: "user@host: ~/code", shell: false },
      ports: {
        status: "known",
        list: [
          {
            port: 5173,
            name: "node",
            command: "node vite",
            scope: "loopback",
            family: "v4",
          },
        ],
      },
    } as const satisfies typeof TerminalSnapshotSchema.Type;

    expect(encodeJson(TerminalSnapshotSchema)(full)).toBe(
      '{"cwd":"/home/u/code/kolu",' +
        '"git":{"kind":"repo","info":{"repoRoot":"/home/u/code/kolu","repoName":"kolu","worktreePath":"/home/u/code/kolu",' +
        '"branch":"effect","isWorktree":false,"mainRepoRoot":"/home/u/code/kolu",' +
        '"remoteUrl":"https://github.com/juspay/kolu","isBare":false}},' +
        '"pr":{"kind":"ok","value":{"number":2100,"title":"Wave 3",' +
        '"url":"https://github.com/juspay/kolu/pull/2100","state":"open","checks":"pass",' +
        '"checkRuns":[{"name":"unit","outcome":"pass"}],' +
        '"reviewDecision":"APPROVED","mergeStateStatus":"CLEAN",' +
        '"headSha":"4f21a9c0d3e5b7a9c1d3e5f7a9b1c3d5e7f9a1b3","isDraft":false}},' +
        '"agent":{"kind":"claude-code","state":"thinking",' +
        '"sessionId":"f47ac10b-58cc-4372-a567-0e02b2c3d479","model":"claude-opus-5",' +
        '"summary":null,"taskProgress":null,"workflow":null,"contextTokens":47000,' +
        '"startedAt":1712345678901},' +
        '"foreground":{"name":"claude","title":"user@host: ~/code","shell":false},' +
        '"ports":{"status":"known","list":[{"port":5173,"name":"node","command":"node vite","scope":"loopback","family":"v4"}]}}',
    );
  });

  it("decodes a payload whose PR carries no checkRuns / review / merge / head keys, and refuses one with no isDraft", () => {
    const minimal = {
      number: 1,
      title: "t",
      url: "u",
      state: "open",
      checks: null,
    };
    expect(() =>
      Schema.decodeUnknownSync(TerminalSnapshotSchema)({
        cwd: "/w",
        git: { kind: "none" },
        pr: { kind: "ok", value: minimal },
        agent: null,
        foreground: null,
        ports: { status: "unknown" },
      }),
    ).toThrow();
    const decoded = Schema.decodeUnknownSync(TerminalSnapshotSchema)({
      cwd: "/w",
      git: { kind: "none" },
      pr: {
        kind: "ok",
        value: { ...minimal, isDraft: false },
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
        mergeStateStatus: null,
        headSha: null,
        isDraft: false,
      },
    });
  });

  it("omits an ABSENT grid and appends a PRESENT one, key last", () => {
    expect(
      encodeJson(TerminalSnapshotSchema)({
        ...seedSnapshot("/w"),
        grid: { cols: 120, rows: 40 },
      }),
    ).toBe(
      '{"cwd":"/w","git":{"kind":"unresolved"},"pr":{"kind":"pending"},"agent":null,' +
        '"foreground":null,"ports":{"status":"unknown"},' +
        '"grid":{"cols":120,"rows":40}}',
    );
  });

  it("refuses half a grid and refuses a grid no pty can have", () => {
    const decode = (grid: unknown) =>
      Schema.decodeUnknownExit(TerminalSnapshotSchema)({
        ...seedSnapshot("/w"),
        grid,
      })._tag;
    expect(decode({ cols: 120 })).toBe("Failure");
    expect(decode({ cols: 120, rows: 0 })).toBe("Failure");
    expect(decode({ cols: 120.5, rows: 40 })).toBe("Failure");
    expect(decode({ cols: 120, rows: 40 })).toBe("Success");
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
        list: [
          {
            port: 8080,
            name: "node",
            command: "node server.js",
            scope: "any",
            family: "v6",
          },
        ],
      }),
    ).toBe(
      '{"status":"known","list":[{"port":8080,"name":"node","command":"node server.js","scope":"any","family":"v6"}]}',
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
  it("Foreground keeps a nullable title and says whether it is the shell", () => {
    const encode = encodeJson(ForegroundSchema);
    expect(encode({ name: "vim", title: "vim file.ts", shell: false })).toBe(
      '{"name":"vim","title":"vim file.ts","shell":false}',
    );
    expect(encode({ name: "bash", title: null, shell: true })).toBe(
      '{"name":"bash","title":null,"shell":true}',
    );
  });

  it("TerminalId accepts a UUID and refuses anything else", () => {
    const id = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    expect(Schema.decodeUnknownSync(TerminalIdSchema)(id)).toBe(id);
    expect(Schema.decodeUnknownResult(TerminalIdSchema)("t1")._tag).toBe(
      "Failure",
    );
  });

  it("PortInfo encodes its five fields in declaration order", () => {
    expect(
      encodeJson(PortInfoSchema)({
        port: 1,
        name: "sshd",
        command: "sshd -D",
        scope: "interface",
        family: "v4",
      }),
    ).toBe(
      '{"port":1,"name":"sshd","command":"sshd -D","scope":"interface","family":"v4"}',
    );
  });

  it("HostListeners: status ∈ known|unknown, known carries claimed + an unclaimed two-way", () => {
    const encode = encodeJson(HostListenersSchema);
    expect(encode({ status: "unknown" })).toBe('{"status":"unknown"}');
    expect(
      encode({
        status: "known",
        claimed: [],
        unclaimed: { status: "unknown" },
      }),
    ).toBe('{"status":"known","claimed":[],"unclaimed":{"status":"unknown"}}');
    expect(
      encode({
        status: "known",
        claimed: [],
        unclaimed: {
          status: "known",
          list: [{ port: 631, scope: "loopback", family: "v6" }],
        },
      }),
    ).toBe(
      '{"status":"known","claimed":[],"unclaimed":{"status":"known","list":[{"port":631,"scope":"loopback","family":"v6"}]}}',
    );
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

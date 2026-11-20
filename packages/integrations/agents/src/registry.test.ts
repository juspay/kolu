import { Result, Schema } from "effect";
import { buildCliRegistry } from "anyagent";
import type { OmpInfo } from "kolu-omp/schemas";
import type { PiInfo } from "kolu-pi/schemas";
import { describe, expect, expectTypeOf, it } from "vitest";
import { AGENT_DIR_ENV_KEYS, AGENT_PLUGINS } from "./index.ts";
import {
  AGENT_CLI,
  AGENT_VOCABS,
  AgentPresenceSchema,
  type AgentInfo,
  AgentInfoSchema,
  AgentKindSchema,
  type AgentKind,
  agentCliGrammar,
  agentVocab,
  isAgentKind,
  isAgentPresence,
} from "./vocab.ts";

const KINDS = Object.keys(AGENT_VOCABS) as AgentKind[];

describe("AGENT_VOCABS ↔ AGENT_PLUGINS", () => {
  it("every kind has a plugin whose vocab IS the vocab (reference equality)", () => {
    for (const kind of KINDS) {
      expect(AGENT_PLUGINS[kind].vocab).toBe(AGENT_VOCABS[kind]);
    }
  });

  it("every vocab's kind and every adapter's kind agree with its registry key", () => {
    for (const kind of KINDS) {
      expect(AGENT_VOCABS[kind].kind).toBe(kind);
      expect(AGENT_PLUGINS[kind].adapter.kind).toBe(kind);
    }
  });

  it("AgentKindSchema accepts exactly the registered kinds", () => {
    const decode = Schema.decodeUnknownResult(AgentKindSchema);
    for (const kind of KINDS) {
      expect(Result.isSuccess(decode(kind))).toBe(true);
    }
    expect(Result.isFailure(decode("not-an-agent"))).toBe(true);
    expect(Result.isFailure(decode("claude"))).toBe(true);
  });
});

describe("AgentInfoSchema — a closed discriminated union", () => {
  it("has one member per vocab, plus the one kind-agnostic presence", () => {
    const [session, presence] = AgentInfoSchema.members;
    expect(session.members.length).toBe(KINDS.length);
    expect(presence).toBe(AgentPresenceSchema);
  });

  it("decodes a presence state of any kind as a presence, never as that kind's transcript info", () => {
    for (const kind of KINDS) {
      const decoded = Schema.decodeUnknownSync(AgentInfoSchema)({
        kind,
        state: "fresh",
        sessionId: null,
        model: null,
        summary: null,
        taskProgress: null,
        contextTokens: null,
        startedAt: null,
      });
      expect(isAgentPresence(decoded)).toBe(true);
    }
  });

  it("narrows on `kind` per member (kind ↔ Info correlation survives)", () => {
    expectTypeOf<Extract<AgentInfo, { kind: "pi" }>>().toExtend<PiInfo>();
    expectTypeOf<Extract<AgentInfo, { kind: "omp" }>>().toExtend<OmpInfo>();
  });

  it("decodes an oh-my-pi payload through the union on its `kind`", () => {
    const decoded = Schema.decodeUnknownSync(AgentInfoSchema)({
      kind: "omp",
      state: "awaiting_user",
      sessionId: "01a0a0e3-1843-701b-bfde-c9c816e3e92f",
      sessionPath:
        "/home/u/.omp/agent/sessions/-code-proj/2026-09-14T17-07-12-579Z_01a0a0e3-1843-701b-bfde-c9c816e3e92f.jsonl",
      model: "deepseek-v4.1-flash",
      summary: "Run echo hello bash command",
      taskProgress: null,
      contextTokens: 30676,
      startedAt: 1787509701451,
      lastPromptId: "686ac209",
      lastPromptText: "Run echo hello bash command",
    });
    expect(decoded).toMatchObject({
      kind: "omp",
      state: "awaiting_user",
      summary: "Run echo hello bash command",
    });
  });
});

describe("the CLI registry", () => {
  it("resolves every vocab by KIND", () => {
    for (const kind of KINDS) {
      expect(AGENT_CLI.byKind(kind)).toBe(AGENT_VOCABS[kind]);
    }
    expect(AGENT_CLI.byKind("not-an-agent")).toBeUndefined();
  });

  it("THROWS on a duplicate kind (the load-time fence)", () => {
    const a = agentVocab("claude-code");
    const b = { ...a, cli: { ...a.cli, basename: "other" } };
    expect(() => buildCliRegistry([a, b])).toThrow(/duplicate agent kind/);
  });

  it("basenames are unique across vocabs", () => {
    const names = KINDS.map((k) => AGENT_VOCABS[k].cli.basename);
    expect(new Set(names).size).toBe(names.length);
  });

  it("agentCliGrammar crashes loudly on an unknown kind; isAgentKind does not narrow it", () => {
    expect(agentCliGrammar("opencode")).toBe(AGENT_VOCABS.opencode.cli);
    expect(() => agentCliGrammar("not-an-agent")).toThrow(/unknown agent kind/);
    expect(isAgentKind("not-an-agent")).toBe(false);
  });
});

describe("AGENT_DIR_ENV_KEYS", () => {
  it("is the unique, KOLU_-prefixed union of every plugin's env keys", () => {
    const keys = [...AGENT_DIR_ENV_KEYS];
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key.startsWith("KOLU_")).toBe(true);
    for (const kind of KINDS) {
      const pluginKeys = AGENT_PLUGINS[kind].envKeys;
      expect(pluginKeys.length).toBeGreaterThan(0);
      for (const key of pluginKeys) expect(keys).toContain(key);
    }
  });
});

/** Registry invariants — the ONE list of agents, and the facts that must hold
 *  across its halves (vocab ↔ plugin ↔ CLI registry). These are what make
 *  "adding an agent is one package plus one row" safe: a mis-wired row fails
 *  here rather than in the field. */

import { Result, Schema } from "effect";
import { buildCliRegistry } from "anyagent";
import type { OmpInfo } from "kolu-omp/schemas";
import type { PiInfo } from "kolu-pi/schemas";
import { describe, expect, it } from "vitest";
import { AGENT_DIR_ENV_KEYS, AGENT_PLUGINS } from "./index.ts";
import {
  AGENT_CLI,
  AGENT_VOCABS,
  type AgentInfo,
  AgentInfoSchema,
  AgentKindSchema,
  type AgentKind,
  agentVocab,
  DETECT_ONLY_AGENTS,
} from "./vocab.ts";

const KINDS = Object.keys(AGENT_VOCABS) as AgentKind[];

describe("AGENT_VOCABS ↔ AGENT_PLUGINS", () => {
  it("every kind has a plugin whose vocab IS the vocab (reference equality)", () => {
    for (const kind of KINDS) {
      // Reference equality, not deep — so a plugin cannot be built from
      // hand-copied vocab fields that then drift.
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
  it("has one member per vocab", () => {
    expect(AgentInfoSchema.members.length).toBe(KINDS.length);
  });

  it("narrows on `kind` per member (kind ↔ Info correlation survives)", () => {
    // Compile-time pin: the `pi` arm of the union IS `PiInfo`. If the registry
    // ever widened to a bare `Schema<AgentInfo>`, this stops compiling.
    const check: Extract<AgentInfo, { kind: "pi" }> extends PiInfo
      ? true
      : false = true;
    expect(check).toBe(true);
    // …and the `omp` arm IS `OmpInfo`.
    const ompCheck: Extract<AgentInfo, { kind: "omp" }> extends OmpInfo
      ? true
      : false = true;
    expect(ompCheck).toBe(true);
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
    });
    expect(decoded).toMatchObject({
      kind: "omp",
      state: "awaiting_user",
      summary: "Run echo hello bash command",
    });
  });
});

describe("the CLI registry", () => {
  it("indexes every vocab and every detect-only grammar by basename", () => {
    for (const kind of KINDS) {
      expect(AGENT_CLI.byBasename(AGENT_VOCABS[kind].cli.basename)).toBe(
        AGENT_VOCABS[kind],
      );
    }
    for (const grammar of DETECT_ONLY_AGENTS) {
      expect(AGENT_CLI.byBasename(grammar.basename)).toBe(grammar);
    }
  });

  it("THROWS on a duplicate basename (the load-time fence)", () => {
    // Same basename, DIFFERENT kind — isolates the basename check from the kind
    // check (which would otherwise fire first).
    const dupBasename = {
      ...agentVocab("claude-code"),
      kind: "codex" as const,
    };
    expect(() =>
      buildCliRegistry([agentVocab("claude-code"), dupBasename], []),
    ).toThrow(/duplicate agent basename/);
    expect(() =>
      buildCliRegistry([], [DETECT_ONLY_AGENTS[0]!, DETECT_ONLY_AGENTS[0]!]),
    ).toThrow(/duplicate agent basename/);
  });

  it("THROWS on a duplicate kind", () => {
    const a = agentVocab("claude-code");
    const b = { ...a, cli: { ...a.cli, basename: "other" } };
    expect(() => buildCliRegistry([a, b], [])).toThrow(/duplicate agent kind/);
  });

  it("basenames are unique across vocabs and detect-only grammars", () => {
    const names = [
      ...KINDS.map((k) => AGENT_VOCABS[k].cli.basename),
      ...DETECT_ONLY_AGENTS.map((g) => g.basename),
    ];
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("AGENT_DIR_ENV_KEYS", () => {
  it("is the unique, KOLU_-prefixed union of every plugin's env keys", () => {
    // Structural invariants, NOT a pinned list: a pinned list is the old
    // padiBinding table moved into a test, and the next agent with a
    // `KOLU_<AGENT>_DIR` key would have to edit it — the per-agent edit the
    // registry exists to remove.
    const keys = [...AGENT_DIR_ENV_KEYS];
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key.startsWith("KOLU_")).toBe(true);
    for (const kind of KINDS) {
      const pluginKeys = AGENT_PLUGINS[kind].envKeys;
      // Every agent contributes at least one detection dir/db override.
      expect(pluginKeys.length).toBeGreaterThan(0);
      for (const key of pluginKeys) expect(keys).toContain(key);
    }
  });
});

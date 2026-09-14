/** Registry invariants — the ONE list of agents, and the facts that must hold
 *  across its halves (vocab ↔ plugin ↔ CLI registry). These are what make
 *  "adding an agent is one package plus one row" safe: a mis-wired row fails
 *  here rather than in the field. */

import { Result, Schema } from "effect";
import { buildCliRegistry } from "anyagent";
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
  it("equals the legacy hand-list padiBinding forwarded (set, order-free)", () => {
    expect([...AGENT_DIR_ENV_KEYS].sort()).toEqual(
      [
        "KOLU_CLAUDE_SESSIONS_DIR",
        "KOLU_CLAUDE_PROJECTS_DIR",
        "KOLU_CODEX_DIR",
        "KOLU_CODEX_DB",
        "KOLU_GROK_DIR",
        "KOLU_OPENCODE_DB",
        "KOLU_PI_DIR",
      ].sort(),
    );
  });
});

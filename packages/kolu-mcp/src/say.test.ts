/**
 * `resolveSay` — the recipe selection and every refusal, pinned apart from the
 * wire (the tool handler is text → settle → keys over this).
 *
 * The RECORDS here are padi's own shape, cast once at the fixture: what this
 * file is about is the decision table over `(agent, state)`, and the per-agent
 * recipes it reads are the real ones from `kolu-agents` — a test that stubbed
 * them would pin this file's idea of claude-code's keys rather than the one
 * `agent_say` will actually press.
 */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import { ToolFailure } from "@kolu/surface-mcp";
import { describe, expect, it } from "vitest";
import { agentVocab } from "kolu-agents/vocab";
import { resolveSay, type SayRefusal } from "./say.ts";

const ID = "11111111-1111-4111-8111-111111111111";

/** An ACTIVE terminal running `kind` in `state`. */
const withAgent = (kind: string, state: string): PadiTerminal =>
  ({
    state: "active",
    title: "worker",
    agent: { kind, state },
  }) as unknown as PadiTerminal;

/** An active terminal at a plain shell — the `agent: null` case. */
const SHELL = {
  state: "active",
  title: "shell",
  agent: null,
} as unknown as PadiTerminal;

const refusalFrom = (
  text: string,
  record: PadiTerminal,
): ToolFailure<SayRefusal> => {
  try {
    resolveSay(ID, text, record);
  } catch (e) {
    if (e instanceof ToolFailure) return e as ToolFailure<SayRefusal>;
    throw new Error(`expected a ToolFailure, got ${String(e)}`);
  }
  throw new Error("expected a refusal, but the say resolved");
};

describe("resolveSay — which keys, and what they do", () => {
  it("an IDLE agent gets its idle keys, and the words start a turn", () => {
    const say = resolveSay(ID, "ship it", withAgent("omp", "waiting"));
    expect(say.agent).toBe("omp");
    expect(say.working).toBe(false);
    expect(say.keys).toEqual(agentVocab("omp").say?.idle);
    expect(say.delivery).toBe("submitted");
  });

  it("an agent BLOCKED ON THE HUMAN is not working — it is at a prompt", () => {
    const say = resolveSay(
      ID,
      "yes",
      withAgent("claude-code", "awaiting_user"),
    );
    expect(say.working).toBe(false);
    expect(say.delivery).toBe("submitted");
  });

  it("a WORKING agent gets its mid-turn keys and its own delivery word", () => {
    // Two agents measured to differ in exactly this, which is the whole reason
    // the answer carries a delivery at all: omp hands the words to the running
    // turn, claude-code holds them for the next one.
    const steering = resolveSay(
      ID,
      "also the Nile",
      withAgent("omp", "thinking"),
    );
    expect(steering.working).toBe(true);
    expect(steering.delivery).toBe("steer");

    const queueing = resolveSay(
      ID,
      "also the Nile",
      withAgent("claude-code", "tool_use"),
    );
    expect(queueing.working).toBe(true);
    expect(queueing.delivery).toBe("queue");
  });

  it("the TEXT is encoded by the shared send policy, paste rule included", () => {
    const one = resolveSay(ID, "hello", withAgent("codex", "waiting"));
    expect(one.text.write).toBe("hello");
    expect(one.text.paste).toBe(false);

    const many = resolveSay(ID, "a\nb", withAgent("codex", "waiting"));
    expect(many.text.write).toBe("\x1b[200~a\nb\x1b[201~");
    expect(many.text.paste).toBe(true);
  });

  it("every agent kolu detects has a recipe for both states", () => {
    // The fence that matters for the tool's promise ("the conductor never
    // needs per-agent key knowledge again"): an agent added to the registry
    // without a measured recipe fails HERE, beside the claim, rather than in a
    // live turn as a refusal nobody expected.
    for (const kind of [
      "claude-code",
      "codex",
      "opencode",
      "grok",
      "pi",
      "omp",
      "xyne",
    ] as const) {
      const recipe = agentVocab(kind).say;
      expect(recipe, `${kind} has no say recipe`).not.toBeNull();
      expect(recipe?.idle.length, `${kind} idle keys`).toBeGreaterThan(0);
      expect(recipe?.verified, `${kind} verified`).toMatch(/\w/);
      expect(resolveSay(ID, "hi", withAgent(kind, "waiting")).keys).toEqual(
        recipe?.idle,
      );
    }
  });
});

describe("resolveSay — every refusal reaches the agent as DATA", () => {
  it("empty text is refused by the shared policy, never written as 0 bytes", () => {
    const refusal = refusalFrom("", withAgent("omp", "waiting"));
    expect(refusal.detail).toEqual({ kind: "text-refused" });
    expect(refusal.message).toMatch(/nothing to send/);
  });

  it("a plain shell is refused — the words are not typed at a bash prompt", () => {
    const refusal = refusalFrom("ship it", SHELL);
    expect(refusal.detail).toEqual({ kind: "no-agent", id: ID });
    expect(refusal.message).toMatch(/no agent/);
    // The recovery is named, so a driver that genuinely meant the shell knows
    // which tool to reach for.
    expect(refusal.message).toMatch(/lifecycle_sendInput/);
  });

  it("a DORMANT terminal is refused as asleep, not as a shell with no agent", () => {
    // The trap this closes: a sleeping record carries no agent, so a reader
    // that only asked "is there an agent" would tell the conductor its worker
    // is a plain shell.
    const asleep = { state: "sleeping" } as unknown as PadiTerminal;
    const refusal = refusalFrom("ship it", asleep);
    expect(refusal.detail).toMatchObject({
      kind: "terminal-not-active",
      tag: "TerminalNotActive",
      state: "sleeping",
      id: ID,
    });

    const parked = { state: "parked" } as unknown as PadiTerminal;
    expect(refusalFrom("ship it", parked).message).toMatch(/parked/);
  });

  it("the refusal names the terminal, so the fleet face can re-qualify it", () => {
    // `fleet/lift.ts` rewrites `detail.id` and the prose into `<host>/<id>`;
    // that only works while every refusal carries the bare id it names.
    const refusal = refusalFrom("ship it", SHELL);
    expect(refusal.detail).toMatchObject({ id: ID });
    expect(refusal.message).toContain(ID);
  });
});

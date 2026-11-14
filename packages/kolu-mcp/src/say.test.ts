/**
 * `resolveSay` — the recipe selection and every refusal, pinned apart from the
 * wire (the tool handler is text → settle → keys over this).
 *
 * The RECORDS here are padi's own shape, cast once at the fixture: what this
 * file is about is the decision table over `(agent, state)`, and the per-agent
 * recipes it reads are the real ones from `kolu-agents` — a test that stubbed
 * them would pin this file's idea of claude-code's keys rather than the one
 * `agent_say` will actually press.
 *
 * The ONE place a stub is right is the last suite: the two refusals for an
 * agent kolu cannot steer are unreachable through the registry (all seven
 * shipped agents have a measured recipe for both states), so they are reached
 * through the vocabulary ARGUMENT `resolveSay` takes — a branch nobody can
 * enter is a branch nobody has run.
 */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import { ToolFailure } from "@kolu/surface-mcp";
import { describe, expect, it } from "vitest";
import { agentVocab } from "kolu-agents/vocab";
import {
  resolveSay,
  type SayRefusal,
  type SayVocabulary,
  sayTook,
} from "./say.ts";

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

  it("a FRESH agent — up, settled, never prompted — gets the idle keys", () => {
    // padi's presence, before the agent has written a line of transcript.
    // This is the moment a conductor briefs a worker it just launched, and a
    // first prompt is an ordinary idle submit.
    const say = resolveSay(ID, "here is the brief", withAgent("omp", "fresh"));
    expect(say.working).toBe(false);
    expect(say.keys).toEqual(agentVocab("omp").say?.idle);
    expect(say.delivery).toBe("submitted");
  });

  it("a PROMPTED agent — submitted to, no transcript yet — is WORKING, and a second say steers or queues", () => {
    // The window between a fresh agent's first submit and its first transcript
    // line (omp's lasts the whole first reply). Read as idle, a second say here
    // would press the idle keys into an agent that is working.
    const omp = resolveSay(ID, "also this", withAgent("omp", "prompted"));
    expect(omp.working).toBe(true);
    expect(omp.keys).toEqual(agentVocab("omp").say?.working?.keys);
    expect(omp.delivery).toBe("steer");
    const claude = resolveSay(
      ID,
      "also this",
      withAgent("claude-code", "prompted"),
    );
    expect(claude.delivery).toBe("queue");
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

  it("an agent still COMING UP is refused — its screen is still being drawn", () => {
    // Keys pressed into a TUI that has not finished painting itself are read
    // by whatever it draws next, if anything. The refusal names the wait that
    // ends it rather than inviting a blind resend.
    const refusal = refusalFrom(
      "here is the brief",
      withAgent("omp", "starting"),
    );
    expect(refusal.detail).toEqual({
      kind: "agent-starting",
      id: ID,
      agent: "omp",
    });
    expect(refusal.message).toMatch(/still coming up/);
    expect(refusal.message).toMatch(/fresh/);
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

describe("the two refusals no shipped agent can reach", () => {
  // Every one of the seven agents kolu detects has a measured recipe, and
  // every recipe answers for both states — which is the promise the suite
  // above pins, and which makes these two arms unreachable through the
  // registry. They are kept because the brief requires an agent kolu cannot
  // steer to be REFUSED with a reason rather than guessed at, and they are
  // reached here the only honest way: by handing the resolver a vocabulary.
  const fake = (say: SayVocabulary["say"]): SayVocabulary => ({
    displayName: "Rumour",
    say,
  });

  it("an agent with NO recipe is refused by name, never guessed at", () => {
    try {
      resolveSay(ID, "ship it", withAgent("omp", "waiting"), () => fake(null));
    } catch (e) {
      const refusal = e as ToolFailure<SayRefusal>;
      expect(refusal.detail).toEqual({
        kind: "agent-cannot-be-told",
        id: ID,
        agent: "omp",
      });
      expect(refusal.message).toContain("Rumour");
      return;
    }
    throw new Error("expected a refusal, but the say resolved");
  });

  it("an agent with no MID-TURN recipe is refused only while it works", () => {
    const idleOnly = fake({
      idle: ["Enter"],
      working: null,
      verified: "a test",
    });
    // Idle: the same vocabulary says the words plainly.
    const said = resolveSay(
      ID,
      "ship it",
      withAgent("omp", "waiting"),
      () => idleOnly,
    );
    expect(said.keys).toEqual(["Enter"]);
    expect(said.delivery).toBe("submitted");

    try {
      resolveSay(ID, "ship it", withAgent("omp", "thinking"), () => idleOnly);
    } catch (e) {
      const refusal = e as ToolFailure<SayRefusal>;
      expect(refusal.detail).toEqual({
        kind: "agent-cannot-be-told-while-working",
        id: ID,
        agent: "omp",
      });
      // The recovery, named: wait for the turn and say it then.
      expect(refusal.message).toMatch(/Wait for it to finish/);
      return;
    }
    throw new Error("expected a refusal, but the say resolved");
  });
});

describe("sayTook — did the keys take, and what the answer says either way", () => {
  it("an idle agent that starts working took it", () => {
    const took = sayTook("submitted", {
      kind: "met",
      agent: { kind: "omp", state: "thinking" } as never,
      elapsedMs: 120,
    });
    expect(took).toMatchObject({ observed: "began-working", afterMs: 120 });
    expect(took.note).toContain("120");
  });

  it("an idle agent that does NOT start is an ANSWER, not a failure — and it names the screen read", () => {
    // The failure mode this exists to stop: a tool that reports nothing but
    // "sent" invites the caller to say it again, which types the prompt twice.
    const took = sayTook("submitted", { kind: "timeout", elapsedMs: 3000 });
    expect(took).toMatchObject({ observed: "did-not-begin", waitedMs: 3000 });
    expect(took.note).toContain("keys were sent");
    expect(took.note).toContain("screen_text");
  });

  it("a WORKING agent is told plainly that taking is not observable — with its delivery", () => {
    const steered = sayTook("steer", null);
    expect(steered.observed).toBe("not-observable");
    expect(steered.note).toContain("turn that is running");

    const queued = sayTook("queue", null);
    expect(queued.observed).toBe("not-observable");
    expect(queued.note).toContain("next turn");
  });

  it("losing sight of the terminal says which way it was lost", () => {
    expect(sayTook("submitted", { kind: "gone", elapsedMs: 10 })).toMatchObject(
      { observed: "lost-sight", why: "gone" },
    );
    expect(
      sayTook("submitted", { kind: "closed", error: "link dropped" }),
    ).toMatchObject({ observed: "lost-sight", why: "closed" });
    expect(
      sayTook("submitted", { kind: "closed", error: "link dropped" }).note,
    ).toContain("link dropped");
    expect(sayTook("submitted", { kind: "interrupted" })).toMatchObject({
      observed: "lost-sight",
      why: "interrupted",
    });
  });
});

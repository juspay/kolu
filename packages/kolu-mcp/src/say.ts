/**
 * `agent_say` — say this to the agent in that terminal, and let kolu do the
 * keystrokes.
 *
 * The verb exists because the keystrokes are NOT the caller's business and
 * never were. A conductor driving six workers had to know that omp wants a
 * settle before its Enter, that claude-code's Enter opens a new turn rather
 * than joining the running one, that pi and xyne put the line in a steering
 * pane — knowledge it could only get by being told, one agent at a time, by a
 * human who had just watched a message vanish. kolu already knows WHICH agent
 * runs in a terminal (that is what agent detection is for), so the recipe lives
 * with the detection — each agent's own vocab (`packages/integrations/<agent>`,
 * `AgentVocab.say`) — and this tool performs it.
 *
 * What it does, in order:
 *
 *   1. **Read the terminal's record** — the live agent (`activeAgent`, padi's
 *      own narrowing) and its coarse state bucket (`agentBucket`). Nothing is
 *      typed before this: a plain shell, a sleeping terminal and an agent kolu
 *      has no recipe for are all REFUSED, never guessed at. Typing a sentence
 *      meant for an agent into a bash prompt is a command the human did not
 *      write.
 *   2. **Write the words** — through the SAME encoder `lifecycle_sendInput`
 *      uses (`@kolu/terminal-protocol`), so multiline text is bracketed-pasted
 *      and an empty payload is refused with the shared sentence. One policy,
 *      two faces.
 *   3. **Let the terminal settle** — a hard-capped `awaitOutputSettled`
 *      (`SAY_SETTLE_IDLE_MS` quiet, `SAY_SETTLE_TIMEOUT_MS` at the outside).
 *      This is the step the folklore was about: an Enter sent in the same
 *      breath as the paste is eaten by the TUI's paste debounce, which reads
 *      exactly like "this agent needs a second Enter". It needs a settle, and
 *      the settle is bounded here because a tool whose job is one keystroke
 *      must not become a place to block.
 *   4. **Press the recipe's keys** — one send per key, in order, so a recipe
 *      that ever needs two keys cannot deliver them fused into one write that a
 *      TUI reads as a single chord.
 *
 * Then it ANSWERS what it did: which agent, whether that agent was working, the
 * keys pressed, and — the fact a caller actually needs — whether those keys
 * STEER the running turn or QUEUE behind it. "I said it" and "it heard it" are
 * different claims, and only the agent's own recipe knows which one this was.
 */

import { terminalAsleepRefusal } from "./asleep.ts";
import { padiOf } from "./bundleClient.ts";
// `PadiSurfaceClient` is a TYPE import of the dial entry — erased, so the
// table's static-load fence (`tools.test.ts`) is untouched by it.
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { PadiTerminal } from "@kolu/padi-client/surface";
// A PURE leaf of the dial kit — the narrowing only, no socket (that package's
// `terminalVocab.ts` exists for exactly this: `tools.test.ts`'s fence bans
// `@kolu/padi-client/dial` and `…/watch`, not the vocabulary below them).
import { activeAgent } from "@kolu/padi-client/terminalVocab";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { type BespokeTool, ToolFailure } from "@kolu/surface-mcp/tools";
import {
  encodeSend,
  type SendPlan,
  type SendVocabulary,
} from "@kolu/terminal-protocol";
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { Effect, Schema } from "effect";
import type { AgentSayRecipe } from "kolu-agents/vocab";
import { agentVocab } from "kolu-agents/vocab";

export const AgentSayArgsSchema = Schema.Struct({
  id: TerminalIdSchema,
  // The blurb sits on the encoded-side node (the `jsonschema.ts` law this
  // package's arg schemas all obey) — and it is where a model learns that this
  // tool is the one that knows the keys, so it stops inventing them.
  text: Schema.String.annotate({
    description:
      "What to say to the agent. kolu types it and presses that agent's own submit keys — never send Enter yourself. Multiline text is bracketed-paste wrapped automatically.",
  }),
});
export type AgentSayArgs = typeof AgentSayArgsSchema.Type;

/** This face's spelling of the shared send policy. `keyName` and
 *  `submitRitual` describe what a caller would otherwise have done BY HAND,
 *  because the only refusal this tool can raise through the shared policy is
 *  the empty-text one — and that sentence ends with "or use <keyName> to send a
 *  key", which must name a tool that exists. On this face that is
 *  `lifecycle_sendInput`'s `key`. */
const SAY_SEND_VOCABULARY: SendVocabulary = {
  keyName: "lifecycle_sendInput { key }",
  submitRitual:
    "  agent_say { id, text }   # kolu types the text, waits for the settle, and presses that agent's submit keys",
};

/** How quiet the terminal must go after the text before the submit keys are
 *  pressed, and how long that is worth waiting for.
 *
 *  Both are small ON PURPOSE. The settle exists to clear a TUI's paste
 *  debounce — tens of milliseconds of redraw — not to wait for an agent to
 *  think. A terminal that is still printing after `SAY_SETTLE_TIMEOUT_MS` gets
 *  its keys anyway: a working agent's screen may never go quiet (that is what
 *  working looks like), and refusing to submit into a busy terminal would make
 *  the mid-turn half of this tool unusable exactly when it matters. */
export const SAY_SETTLE_IDLE_MS = 250;
export const SAY_SETTLE_TIMEOUT_MS = 2_000;

/** Why `agent_say` would not say it. Each kind is a different recovery:
 *
 *   - `text-refused` — the shared encoder refused the words (today: empty).
 *   - `terminal-not-active` — the terminal is asleep or parked (`asleep.ts`'s
 *     refusal, verbatim, so the one sentence about dormant terminals is the one
 *     sentence every tool here gives).
 *   - `no-agent` — a plain shell. Deliberately NOT "type it anyway": a sentence
 *     addressed to an agent, submitted at a bash prompt, is a command the human
 *     never wrote.
 *   - `agent-cannot-be-told` — kolu detects this agent but has no verified
 *     recipe for it. A guessed keystroke lands in someone's half-finished work,
 *     so the answer is a refusal that names the agent.
 *   - `agent-cannot-be-told-while-working` — there IS a recipe, but not for an
 *     agent mid-turn: this agent's TUI drops or mangles input while it works.
 *     The recovery is to wait for the turn to end and say it then. */
export type SayRefusal =
  | { readonly kind: "text-refused" }
  | { readonly kind: "no-agent"; readonly id: string }
  | {
      readonly kind: "agent-cannot-be-told";
      readonly id: string;
      readonly agent: string;
    }
  | {
      readonly kind: "agent-cannot-be-told-while-working";
      readonly id: string;
      readonly agent: string;
    };

/** What the keys did, as the answer reports it.
 *
 *   - `submitted` — the agent was idle, so the words START a turn.
 *   - `steer` / `queue` — the agent was working; the recipe says whether its
 *     TUI hands the words to the running turn or holds them for the next one.
 *     This is the distinction the caller cannot see and cannot change. */
export type SayDelivery = "submitted" | "steer" | "queue";

/** Everything the handler needs after reading the record: what to write, what
 *  to press, and what to say it did. Resolved PURELY so the recipe selection
 *  and every refusal are unit-tested without a padi. */
export interface SayPerformance {
  readonly text: SendPlan;
  readonly keys: readonly string[];
  readonly agent: AgentInfo["kind"];
  readonly working: boolean;
  readonly delivery: SayDelivery;
}

/** The live agent in a record, or the refusal that says why there is none to
 *  talk to — dormant terminal and plain shell are different facts and get
 *  different sentences. */
function sayableAgent(id: string, record: PadiTerminal): AgentInfo {
  if (record.state !== "active") throw terminalAsleepRefusal(id, record.state);
  const agent = activeAgent(record);
  if (agent === null) {
    throw new ToolFailure<SayRefusal>(
      `Terminal ${id} has no agent — it is a plain shell, and a sentence meant for an agent typed at a shell prompt is a command nobody wrote. Use lifecycle_sendInput if you meant to type into the shell.`,
      { kind: "no-agent", id },
    );
  }
  return agent;
}

/** The recipe for this agent in this state, or the refusal that names the agent
 *  and why kolu will not improvise. */
function sayableRecipe(
  id: string,
  agent: AgentInfo,
): { readonly keys: readonly string[]; readonly delivery: SayDelivery } {
  const vocab = agentVocab(agent.kind);
  const recipe: AgentSayRecipe | null = vocab.say;
  if (recipe === null) {
    throw new ToolFailure<SayRefusal>(
      `kolu has no verified way to say something to ${vocab.displayName} (terminal ${id}): nobody has established which keys submit a message in its TUI, and a guessed keystroke lands in whatever that agent is doing. Say it to the human, or drive the terminal yourself with lifecycle_sendInput.`,
      { kind: "agent-cannot-be-told", id, agent: agent.kind },
    );
  }
  if (agentBucket(agent.state) !== "working") {
    return { keys: recipe.idle, delivery: "submitted" };
  }
  if (recipe.working === null) {
    throw new ToolFailure<SayRefusal>(
      `${vocab.displayName} (terminal ${id}) is working, and kolu has no verified way to hand it words mid-turn — its input is dropped or mangled while a turn runs, so typing now would lose what you said silently. Wait for it to finish and say it then.`,
      { kind: "agent-cannot-be-told-while-working", id, agent: agent.kind },
    );
  }
  return { keys: recipe.working.keys, delivery: recipe.working.delivery };
}

/** Resolve a record plus the words into the whole performance — pure, throwing
 *  {@link ToolFailure} for every refusal, so the branch table is testable
 *  without a terminal. */
export function resolveSay(
  id: string,
  text: string,
  record: PadiTerminal,
): SayPerformance {
  // The words are encoded FIRST: an empty `text` is refused before the record
  // read decides whose fault the silence is, and the refusal is the shared
  // policy's own sentence (`kolu send` gives the same one for the same intent).
  const encoded = encodeSend(
    {
      kind: "text",
      text,
      sourceLabel: "text",
      paste: undefined,
      fromStream: false,
    },
    SAY_SEND_VOCABULARY,
  );
  if (encoded.kind === "refused") {
    throw new ToolFailure<SayRefusal>(encoded.message, {
      kind: "text-refused",
    });
  }
  const agent = sayableAgent(id, record);
  const { keys, delivery } = sayableRecipe(id, agent);
  return {
    text: encoded.plan,
    keys,
    agent: agent.kind,
    working: agentBucket(agent.state) === "working",
    delivery,
  };
}

/** One key, as its own write. Per key rather than one fused write: a recipe
 *  with two keys in one `sendInput` arrives as a single byte run, which a TUI
 *  may read as one chord — and the whole point of this tool is that the
 *  keystrokes are correct. */
function pressKey(
  padi: PadiSurfaceClient,
  id: string,
  name: string,
): Effect.Effect<void, unknown> {
  const encoded = encodeSend(
    { kind: "keys", names: [name] },
    SAY_SEND_VOCABULARY,
  );
  if (encoded.kind === "refused") {
    // A recipe naming a key the shared grammar does not know is a BUG in the
    // agent's vocab, not a user's mistake — so it crashes with the recipe
    // named, rather than reaching the caller as a refusal they cannot act on.
    throw new Error(
      `kolu-mcp agent_say: the say recipe names key ${JSON.stringify(name)}, which @kolu/terminal-protocol does not encode — ${encoded.message}`,
    );
  }
  return Effect.asVoid(
    padi.surface.lifecycle.sendInput({ id, data: encoded.plan.write }),
  );
}

export const agentSayTool: BespokeTool = {
  input: AgentSayArgsSchema,
  mutates: true,
  title: "Say something to the agent in a terminal",
  description:
    'Say this to the agent running in that terminal — kolu knows which agent it is and presses that agent\'s own submit keys, so you never send Enter yourself. Types the text, waits for the terminal to settle (hard-capped), then submits. Answers what it did: the agent, whether it was WORKING, the keys pressed, and the delivery — "steer" (the words reach the running turn), "queue" (they wait for the current turn to end) or "submitted" (it was idle, so they start a turn). REFUSED, never guessed: a terminal with no agent (a plain shell), an agent with no verified recipe, an agent that cannot be told anything mid-turn, a terminal that is asleep, and empty text.',
  handler: (args, client, signal) => {
    const { id, text } = args as AgentSayArgs;
    const padi = padiOf(client);
    return Effect.flatMap(
      // The ROSTER read, not a screen read: who is in there and what are they
      // doing. `firstFrameOrThrow` because a collection `get` is a live stream
      // and this is a one-shot question.
      firstFrameOrThrow(
        padi.surface.terminals.get({ key: id }),
        `terminal ${id} answered no record — it is not in this host's roster, so there is no agent to say anything to.`,
      ),
      (record) =>
        // `Effect.try`, not a bare throw inside `suspend`: a synchronous throw
        // while BUILDING an effect is a defect, and a defect skips the error
        // channel — which is what the fleet face rewrites a refusal's terminal
        // id in (`fleet/lift.ts`). A refusal raised as a defect still reaches
        // the agent, but naming a bare id no tool on that face accepts.
        Effect.flatMap(
          Effect.try({
            try: () => resolveSay(id, text, record as PadiTerminal),
            catch: (refusal) => refusal,
          }),
          (say) =>
            Effect.flatMap(
              padi.surface.lifecycle.sendInput({ id, data: say.text.write }),
              () =>
                Effect.flatMap(
                  // The settle, bounded. Lifted out of `@kolu/padi-client/watch`
                  // at CALL time (the table's static-load fence: a tool module
                  // may not drag the mirror onto every `kolu --help`), and given
                  // the request's signal so an interrupted call stops waiting.
                  Effect.tryPromise(async (fiberSignal) => {
                    const { awaitOutputSettled } = await import(
                      "@kolu/padi-client/watch"
                    );
                    return awaitOutputSettled(padi, {
                      id,
                      idleMs: SAY_SETTLE_IDLE_MS,
                      timeoutMs: SAY_SETTLE_TIMEOUT_MS,
                      signal: signal ?? fiberSignal,
                    });
                  }),
                  // The outcome is deliberately not branched on. `timeout` is the
                  // expected answer for a WORKING agent (its screen never goes
                  // quiet), and `gone`/`closed` are answered by the key send
                  // itself failing with padi's own words — a second verdict here
                  // would be this face guessing about a terminal padi can speak
                  // for.
                  () =>
                    Effect.as(
                      Effect.forEach(
                        say.keys,
                        (key) => pressKey(padi, id, key),
                        {
                          discard: true,
                        },
                      ),
                      {
                        said: {
                          agent: say.agent,
                          working: say.working,
                          keys: say.keys,
                          delivery: say.delivery,
                          textBytes: say.text.bytes,
                        },
                      },
                    ),
                ),
            ),
        ),
    );
  },
};

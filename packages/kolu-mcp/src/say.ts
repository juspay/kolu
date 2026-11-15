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
 *      typed before this: a plain shell, a sleeping terminal, an agent kolu
 *      has no recipe for and an agent that is still COMING UP (its screen is
 *      still being drawn) are all REFUSED, never guessed at. Typing a sentence
 *      meant for an agent into a bash prompt is a command the human did not
 *      write; typing one into a TUI that has not finished painting itself is a
 *      sentence nobody can say where it went.
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
 *   5. **Watch, briefly, whether it TOOK** — for an agent that was IDLE, a
 *      hard-capped wait ({@link SAY_TAKE_CAP_MS}) for its state to turn
 *      `working`; for a WORKING agent that steers and whose steer kolu can
 *      see, a hard-capped watch ({@link SAY_STEER_CAP_MS}) for the newest
 *      prompt in its transcript to change, then one screen read for its
 *      steering pane. A dropped Enter is the whole reason this verb exists,
 *      so "the keys were sent" is not a good enough answer; and because a
 *      refusal here would invite a blind resend, every outcome is an answer.
 *
 * Then it ANSWERS what it did: which agent, whether that agent was working, the
 * keys pressed, and — the fact a caller actually needs — whether those keys
 * STEER the running turn or QUEUE behind it; plus whether it took: an idle
 * agent began working, a steer LANDED in the turn or is HELD for the running
 * step to end. "I said it" and "it heard it" are different claims, and this
 * tool reports both rather than letting one stand for the other.
 */

import { terminalAsleepRefusal } from "./asleep.ts";
import { padiOf } from "./bundleClient.ts";
// `PadiSurfaceClient` is a TYPE import of the dial entry — erased, so the
// table's static-load fence (`tools.test.ts`) is untouched by it.
import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import type { PadiTerminal } from "@kolu/padi-client/surface";
// The agent-state wait's OUTCOME type, for the verdict mapper below — a type
// import of the banned `…/watch` entry, which the fence exempts because it is
// erased. The wait itself is pulled at call time, in the handler.
import type { AgentStateOutcome } from "@kolu/padi-client/watch";
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
import {
  agentBucket,
  type WaitState,
} from "@kolu/terminal-vocab/agentProjection";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { Effect, Schema } from "effect";
import type { AgentSayRecipe, SteerSight } from "kolu-agents/vocab";
import { agentSayRecipe, agentVocab, isAgentPresence } from "kolu-agents/vocab";
import { rosterStandingOf, stillSettling } from "./rosterEvidence.ts";

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

/** How long an IDLE agent is given to BEGIN WORKING after its submit keys,
 *  before the answer says it did not.
 *
 *  A hard constant, and small: this is not a wait on the agent's turn (the
 *  Conductor never waits on one — it is woken when a watched terminal stops),
 *  it is the question "did the Enter land", and a TUI that accepted a prompt
 *  flips its state within a beat. Past this the tool still ANSWERS — the keys
 *  were sent, and the honest report is that taking was not observed, which is
 *  a screen to read rather than a reason to type the words again. */
export const SAY_TAKE_CAP_MS = 3_000;

/** How long a STEER is given to show up in the running turn's transcript
 *  before kolu reads the screen for the steering pane.
 *
 *  Measured on omp 18.20.2 (2026-11-15): a steer omp could take at once (it
 *  backgrounded a running `bash` call for it) was in the transcript within
 *  seconds, and a held one took up to ~5 s to be DRAWN in the steering pane
 *  while omp was busy — so the screen is read no sooner than that. */
export const SAY_STEER_CAP_MS = 5_000;

/** The screen rows the held check reads: the steering pane sits just above
 *  the input box, at the bottom of the screen. */
export const SAY_STEER_SCREEN_TAIL = 40;

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
 *     The recovery is to wait for the turn to end and say it then.
 *   - `agent-starting` — the agent's process is up but its screen is still
 *     being drawn (padi's `starting` presence). Keys pressed into a TUI that
 *     is still painting itself are read by whatever it puts on screen next, or
 *     by nothing at all. The recovery is to WAIT — the Conductor's watch rings
 *     `ready`, a driver waits for the `fresh` bucket — and say it then. */
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
    }
  | {
      readonly kind: "agent-starting";
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

/** What kolu can WATCH after the keys to say whether they took — one arm per
 *  thing that can be seen, so the handler cannot open a wait the recipe has
 *  no evidence for:
 *
 *   - `start` — an idle agent: its state turning `working` is the proof.
 *   - `steer` — a working agent whose steer is seen ({@link SteerSight}): the
 *     newest prompt in its transcript (`before`, read with the record) moving
 *     is the proof, and its steering pane says whether it is held.
 *   - `nothing` — a working agent that queues, or one whose steer nobody has
 *     measured: there is no fact to watch. */
export type SayWatch =
  | { readonly kind: "start" }
  | {
      readonly kind: "steer";
      readonly sight: SteerSight<AgentInfo>;
      readonly before: string | null;
    }
  | { readonly kind: "nothing" };

/** Everything the handler needs after reading the record: what to write, what
 *  to press, what to say it did, and what to watch. Resolved PURELY so the
 *  recipe selection and every refusal are unit-tested without a padi. */
export interface SayPerformance {
  readonly text: SendPlan;
  readonly keys: readonly string[];
  readonly agent: AgentInfo["kind"];
  readonly working: boolean;
  readonly delivery: SayDelivery;
  readonly watch: SayWatch;
}

/** The one bucket whose arrival PROVES the words took ({@link SayTook}), for
 *  every idle agent alike. An agent idle mid-conversation turns `working` when
 *  its transcript starts the turn; one that was `fresh` (up, never prompted)
 *  turns `working` the instant padi forwards the submit, as the `prompted`
 *  presence — padi's own reading of the input it carried, so a first prompt
 *  needs no transcript to be seen landing. */
export const SAY_TAKES: ReadonlySet<WaitState> = new Set<WaitState>([
  "working",
]);

/** Whether the words TOOK — the half of this tool's promise the delivery word
 *  cannot answer.
 *
 *  An Enter that is silently dropped is the whole reason `agent_say` exists,
 *  so the answer may not stop at "the keys were sent". For an agent that was
 *  IDLE, kolu watches its state for {@link SAY_TAKE_CAP_MS} and says which of
 *  the two happened. Neither is a failure — a refusal here would invite a
 *  blind resend, which is how a prompt gets typed twice — so both arms are an
 *  answer, and the one that did not take names the screen read that settles
 *  it.
 *
 *   - `began-working` — its transcript started a turn: the agent itself says
 *     it is working. It took.
 *   - `submit-landed` — the agent had written no transcript yet (it was
 *     `fresh`), and padi saw the submit reach it: it is `prompted`, padi's own
 *     reading of the input it carried. A DIFFERENT fact from `began-working`,
 *     and named as one, because it is made by the very keys this tool pressed —
 *     it says the Enter got there, not that the agent has answered. What comes
 *     of it arrives with the transcript; the Conductor's watch rings when it
 *     does.
 *   - `did-not-begin` — it had not within the cap. The keys WERE sent.
 *   - `not-observable` — the agent was already working and kolu has nothing
 *     to watch (it queues, or its steer is unmeasured); what happens to the
 *     words is the recipe's `delivery`, which the answer carries.
 *   - `landed` — a steer: the running turn's transcript gained a new prompt
 *     after the keys. The words are in the turn.
 *   - `held` — a steer: not in the transcript yet, and the screen shows them
 *     in the agent's steering pane. The TUI took them and is holding them for
 *     the running step to end, which it then hands them over at on its own.
 *   - `did-not-land` — a steer: neither in the transcript nor held. The keys
 *     WERE sent.
 *   - `lost-sight` — the watch ended for its own reason (the terminal went
 *     away, the subscription dropped, the call was interrupted) before either
 *     verdict. */
export type SayTook =
  | {
      readonly observed: "began-working";
      readonly afterMs: number;
      readonly note: string;
    }
  | {
      readonly observed: "submit-landed";
      readonly afterMs: number;
      readonly note: string;
    }
  | {
      readonly observed: "did-not-begin";
      readonly waitedMs: number;
      readonly note: string;
    }
  | { readonly observed: "not-observable"; readonly note: string }
  | {
      readonly observed: "landed";
      readonly afterMs: number;
      readonly note: string;
    }
  | {
      readonly observed: "held";
      readonly waitedMs: number;
      readonly note: string;
    }
  | {
      readonly observed: "did-not-land";
      readonly waitedMs: number;
      readonly note: string;
    }
  | {
      readonly observed: "lost-sight";
      readonly why: "gone" | "closed" | "interrupted";
      readonly note: string;
    };

/** Where a steer stands once the watch is over. */
export type SteerOutcome =
  | { readonly kind: "landed"; readonly elapsedMs: number }
  | { readonly kind: "held"; readonly waitedMs: number }
  | { readonly kind: "did-not-land"; readonly waitedMs: number };

/** What the watch after the keys saw, by the {@link SayWatch} it ran. */
export type SayWatched =
  | { readonly kind: "nothing" }
  | { readonly kind: "start"; readonly outcome: AgentStateOutcome }
  | { readonly kind: "steer"; readonly outcome: SteerOutcome };

/** Has the newest prompt in this agent's transcript MOVED since `before`? A
 *  prompt id appearing where there was none counts; none at all does not. */
function promptMoved(
  sight: SteerSight<AgentInfo>,
  before: string | null,
  agent: AgentInfo,
): boolean {
  const now = sight.lastPrompt(agent);
  return now !== null && now !== before;
}

/** The steer's verdict once the watch ran out without seeing it land — pure,
 *  over the screen and the record read AFTER it (in that order, so a step that
 *  ends between the two reads is caught by the record: the words left the
 *  pane because the turn took them). */
export function steerVerdict(input: {
  readonly sight: SteerSight<AgentInfo>;
  readonly before: string | null;
  readonly after: AgentInfo | null;
  readonly screen: string;
  readonly words: string;
  readonly waitedMs: number;
}): SteerOutcome {
  const { sight, before, after, screen, words, waitedMs } = input;
  if (after !== null && promptMoved(sight, before, after)) {
    return { kind: "landed", elapsedMs: waitedMs };
  }
  return sight.held(screen, words)
    ? { kind: "held", waitedMs }
    : { kind: "did-not-land", waitedMs };
}

/** The watch's outcome, read as the answer's verdict — pure, so every arm is
 *  pinned without a terminal that refuses to start working on cue. */
export function sayTook(delivery: SayDelivery, watched: SayWatched): SayTook {
  switch (watched.kind) {
    case "nothing":
      return {
        observed: "not-observable",
        note: `The agent was already working, so there is no state change that would prove it heard this; the keys went in with delivery "${delivery}" — ${delivery === "steer" ? "its TUI hands them to the turn that is running at its next step" : "its TUI holds them for the next turn"}. Read the screen to see them land.`,
      };
    case "steer":
      return steerTook(watched.outcome);
    case "start":
      return startTook(watched.outcome);
  }
}

function steerTook(outcome: SteerOutcome): SayTook {
  switch (outcome.kind) {
    case "landed":
      return {
        observed: "landed",
        afterMs: outcome.elapsedMs,
        note: `The words are in its transcript ${outcome.elapsedMs} ms after the keys: the running turn took them.`,
      };
    case "held":
      return {
        observed: "held",
        waitedMs: outcome.waitedMs,
        note: "Its TUI accepted the words and is HOLDING them in its steering pane: the step it is running cannot be interrupted (a long tool call), and the words join the turn when that step ends, on their own. Do NOT say it again, and do not send Enter: a bare Enter delivers a held steer in omp by INTERRUPTING the running tool, which kills that step.",
      };
    case "did-not-land":
      return {
        observed: "did-not-land",
        waitedMs: outcome.waitedMs,
        note: `The keys were sent, but ${outcome.waitedMs} ms later the words are neither in its transcript nor held in its steering pane. Do NOT say it again blind — read the screen (screen_text): they may still be in its input box, or a dialog may have taken the keys.`,
      };
  }
}

function startTook(outcome: AgentStateOutcome): SayTook {
  switch (outcome.kind) {
    case "met":
      // A presence in the `working` bucket is `prompted`: padi's sight of the
      // submit, before any transcript — said as that, never as a turn.
      return isAgentPresence(outcome.agent)
        ? {
            observed: "submit-landed",
            afterMs: outcome.elapsedMs,
            note: `The submit reached the agent ${outcome.elapsedMs} ms after the keys; it has written nothing yet, so this says the Enter got there, not that it has answered. Do not say it again — its reply arrives with its transcript.`,
          }
        : {
            observed: "began-working",
            afterMs: outcome.elapsedMs,
            note: `The agent began a turn ${outcome.elapsedMs} ms after the keys — it took.`,
          };
    case "timeout":
      return {
        observed: "did-not-begin",
        waitedMs: outcome.elapsedMs,
        note: `The keys were sent, but the agent had not begun working ${outcome.elapsedMs} ms later. Do NOT say it again blind — read the screen (screen_text): the words may be staged at its prompt, it may be waiting on a dialog, or it may just be slow to start.`,
      };
    case "gone":
      return {
        observed: "lost-sight",
        why: "gone",
        note: "The keys were sent, and then the terminal went away — whatever was said died with it. Nothing is running there.",
      };
    case "interrupted":
      return {
        observed: "lost-sight",
        why: "interrupted",
        note: "The keys were sent; the call was interrupted before kolu could see whether the agent started. Read the screen.",
      };
    case "closed":
      return {
        observed: "lost-sight",
        why: "closed",
        note: `The keys were sent; the watch over this terminal dropped before kolu could see whether the agent started${outcome.error === undefined ? "" : ` (${outcome.error})`} — the terminal is not known to be dead. Read the screen.`,
      };
  }
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

/** The slice of an agent's vocab the recipe selection reads. Named as its own
 *  shape so {@link sayableRecipe} is a pure function OVER a vocabulary rather
 *  than over the registry: the `say: null` and `working: null` arms are
 *  refusals the shipped agents cannot reach today (every one of the seven has
 *  a measured recipe), and a branch no test can enter is a branch nobody has
 *  ever run. A fake vocabulary reaches both. */
export interface SayVocabulary {
  readonly displayName: string;
  readonly say: AgentSayRecipe<AgentInfo> | null;
}

/** Every agent's vocab, by kind — the production lookup, and the default of
 *  the one argument {@link resolveSay} takes for it. */
export type SayVocabularyOf = (kind: AgentInfo["kind"]) => SayVocabulary;

/** The registry's answer: the agent's display name, and its say recipe with
 *  the steer sight read over the wire union (`agentSayRecipe`). */
const registryVocabulary: SayVocabularyOf = (kind) => ({
  displayName: agentVocab(kind).displayName,
  say: agentSayRecipe(kind),
});

/** The recipe for this agent in this state, or the refusal that names the agent
 *  and why kolu will not improvise. */
export function sayableRecipe(
  id: string,
  agent: AgentInfo,
  vocab: SayVocabulary,
): {
  readonly keys: readonly string[];
  readonly delivery: SayDelivery;
  readonly watch: SayWatch;
} {
  const recipe: AgentSayRecipe<AgentInfo> | null = vocab.say;
  if (recipe === null) {
    throw new ToolFailure<SayRefusal>(
      `kolu has no verified way to say something to ${vocab.displayName} (terminal ${id}): nobody has established which keys submit a message in its TUI, and a guessed keystroke lands in whatever that agent is doing. Say it to the human, or drive the terminal yourself with lifecycle_sendInput.`,
      { kind: "agent-cannot-be-told", id, agent: agent.kind },
    );
  }
  // WHICH RECIPE, by the agent's coarse bucket — an exhaustive switch rather
  // than a `!== "working"` test, because the fold now carries the two PRESENCE
  // buckets and they do not mean the same thing: one of them is a refusal. A
  // bucket added to `agentBucket` stops this compiling instead of silently
  // taking the idle keys.
  const bucket = agentBucket(agent.state);
  switch (bucket) {
    case "starting":
      throw new ToolFailure<SayRefusal>(
        `${vocab.displayName} (terminal ${id}) is still coming up — its process is there, but its screen is still being drawn. Keys pressed into a TUI that has not finished painting itself are read by whatever it draws next, or by nothing at all. Wait until it is READY and say it then: the Conductor's watch rings "ready" on its own, and a driver can wait for it with wait_agentState until: ["fresh"].`,
        { kind: "agent-starting", id, agent: agent.kind },
      );
    case "fresh":
    case "waiting":
    case "awaiting":
    case "other":
      // UP AND NOT MID-TURN, so the words start a turn. `fresh` is an agent
      // that has come up and never been prompted — exactly the agent a
      // conductor briefs, and its first prompt is an ordinary idle submit.
      return {
        keys: recipe.idle,
        delivery: "submitted",
        watch: { kind: "start" },
      };
    case "working":
      break;
    default:
      // The fence: every bucket above is answered, so nothing reaches here.
      bucket satisfies never;
      break;
  }
  if (recipe.working === null) {
    throw new ToolFailure<SayRefusal>(
      `${vocab.displayName} (terminal ${id}) is working, and kolu has no verified way to hand it words mid-turn — its input is dropped or mangled while a turn runs, so typing now would lose what you said silently. Wait for it to finish and say it then.`,
      { kind: "agent-cannot-be-told-while-working", id, agent: agent.kind },
    );
  }
  const working = recipe.working;
  return {
    keys: working.keys,
    delivery: working.delivery,
    watch:
      working.delivery === "queue" || working.sight === "unmeasured"
        ? { kind: "nothing" }
        : {
            kind: "steer",
            sight: working.sight,
            before: working.sight.lastPrompt(agent),
          },
  };
}

/** Resolve a record plus the words into the whole performance — pure, throwing
 *  {@link ToolFailure} for every refusal, so the branch table is testable
 *  without a terminal. */
export function resolveSay(
  id: string,
  text: string,
  record: PadiTerminal,
  vocabOf: SayVocabularyOf = registryVocabulary,
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
  const { keys, delivery, watch } = sayableRecipe(
    id,
    agent,
    vocabOf(agent.kind),
  );
  const bucket = agentBucket(agent.state);
  return {
    text: encoded.plan,
    keys,
    agent: agent.kind,
    working: bucket === "working",
    delivery,
    watch,
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

/** Watch the record until this agent's newest prompt MOVES past `before`, or
 *  the cap passes. Answers the milliseconds it took, or `null` at the cap.
 *  The watch kit is lifted at CALL time — the table's static-load fence, the
 *  same as the settle's. A record that leaves the collection simply never
 *  lands; the verdict that follows reads the screen and says so. */
async function awaitPromptMoved(
  padi: PadiSurfaceClient,
  id: AgentSayArgs["id"],
  sight: SteerSight<AgentInfo>,
  before: string | null,
  signal: AbortSignal,
): Promise<number | null> {
  const { watchTerminals } = await import("@kolu/padi-client/watch");
  const started = Date.now();
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), SAY_STEER_CAP_MS);
  let landedAfter: number | null = null;
  try {
    await watchTerminals(padi, {
      signal: AbortSignal.any([stop.signal, signal]),
      handlers: {
        onUpsert: (key, value) => {
          if (key !== id) return;
          const agent = activeAgent(value);
          if (agent === null || !promptMoved(sight, before, agent)) return;
          landedAfter = Date.now() - started;
          stop.abort();
        },
        onRemove: () => {},
      },
    });
  } finally {
    clearTimeout(timer);
  }
  return landedAfter;
}

/** Did the steer land: the transcript watch, then — only if it ran out — one
 *  screen read and one record read for {@link steerVerdict}. */
function watchSteer(
  padi: PadiSurfaceClient,
  id: AgentSayArgs["id"],
  watch: Extract<SayWatch, { kind: "steer" }>,
  words: string,
  signal: AbortSignal | undefined,
): Effect.Effect<SteerOutcome, unknown> {
  return Effect.flatMap(
    Effect.tryPromise((fiberSignal) =>
      awaitPromptMoved(
        padi,
        id,
        watch.sight,
        watch.before,
        signal ?? fiberSignal,
      ),
    ),
    (landedAfter) =>
      landedAfter !== null
        ? Effect.succeed<SteerOutcome>({
            kind: "landed",
            elapsedMs: landedAfter,
          })
        : Effect.map(
            Effect.all([
              padi.surface.screen.text({ id, tail: SAY_STEER_SCREEN_TAIL }),
              firstFrameOrThrow(
                padi.surface.terminals.get({ key: id }),
                `terminal ${id} answered no record after the steer — read the screen.`,
              ),
            ]),
            ([screen, record]) =>
              steerVerdict({
                sight: watch.sight,
                before: watch.before,
                after: activeAgent(record as PadiTerminal),
                screen,
                words,
                waitedMs: SAY_STEER_CAP_MS,
              }),
          ),
  );
}

/** The watch the recipe allows, run after the keys — exhaustive over
 *  {@link SayWatch}, so a recipe with nothing to see opens no wait at all. */
function watchAfterKeys(
  padi: PadiSurfaceClient,
  id: AgentSayArgs["id"],
  watch: SayWatch,
  words: string,
  signal: AbortSignal | undefined,
): Effect.Effect<SayWatched, unknown> {
  switch (watch.kind) {
    case "nothing":
      return Effect.succeed({ kind: "nothing" });
    case "start":
      return Effect.map(
        Effect.tryPromise(async (fiberSignal) => {
          // Same call-time lift as the settle, and for the same fence.
          const { awaitAgentState } = await import("@kolu/padi-client/watch");
          return awaitAgentState(padi, {
            id,
            targets: SAY_TAKES,
            timeoutMs: SAY_TAKE_CAP_MS,
            signal: signal ?? fiberSignal,
          });
        }),
        (outcome) => ({ kind: "start", outcome }),
      );
    case "steer":
      return Effect.map(
        watchSteer(padi, id, watch, words, signal),
        (outcome) => ({ kind: "steer", outcome }),
      );
  }
}

export const agentSayTool: BespokeTool = {
  input: AgentSayArgsSchema,
  mutates: true,
  title: "Say something to the agent in a terminal",
  description:
    'Say this to the agent running in that terminal — kolu knows which agent it is and presses that agent\'s own submit keys, so you never send Enter yourself. Types the text, waits for the terminal to settle (hard-capped), then submits. Answers what it did: the agent, whether it was WORKING, the keys pressed, and the delivery — "steer" (the words join the running turn at its next step), "queue" (they wait for the current turn to end) or "submitted" (it was idle or freshly up, so they start a turn) — AND whether it took. For an agent that was not working kolu watches a few seconds and reports "began-working" (its transcript started a turn), "submit-landed" (an agent that has written nothing yet: kolu saw the Enter reach it, and its reply comes with its transcript — do not say it again) or "did-not-begin". For a steer kolu can see, it reports "landed" (the words are in the running turn\'s transcript), "held" (its TUI is holding them in its steering pane until the running step — a long tool call — ends, then hands them over on its own: do not say it again and do not press Enter, which in omp interrupts the running tool) or "did-not-land". The keys were sent either way — read the screen rather than saying it again. REFUSED, never guessed: a terminal with no agent (a plain shell), an agent with no verified recipe, an agent that cannot be told anything mid-turn, an agent that is still COMING UP (its screen is still being drawn — wait until it is ready), a terminal that is asleep, and empty text.',
  handler: (args, client, signal) => {
    const { id, text } = args as AgentSayArgs;
    const padi = padiOf(client);
    return Effect.flatMap(
      // THE HOST'S ROSTER FIRST. "No record" only means "there is no such
      // terminal" once this host has finished adopting the terminals it
      // supervises AND does not hold this one; before that it means "no
      // answer yet", and saying the agent is gone is the defect of
      // juspay/kolu#2376. The standing and the census are one frame, so the
      // two facts cannot arrive apart.
      Effect.flatMap(rosterStandingOf(padi, id, id), (standing) =>
        // The RECORD read, not a screen read: who is in there and what are
        // they doing. `firstFrameOrThrow` because a collection `get` is a
        // live stream and this is a one-shot question. A host that HOLDS the
        // terminal and has no record for it yet is late, not empty — the
        // sentence says so rather than declaring the agent gone.
        firstFrameOrThrow(
          padi.surface.terminals.get({ key: id }),
          standing === "absent"
            ? `terminal ${id} answered no record — it is not in this host's roster, so there is no agent to say anything to.`
            : stillSettling(id),
        ),
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
                    Effect.flatMap(
                      Effect.forEach(
                        say.keys,
                        (key) => pressKey(padi, id, key),
                        {
                          discard: true,
                        },
                      ),
                      // DID IT TAKE — by what the recipe says can be seen: an
                      // idle agent's state turning `working`, a steer's prompt
                      // landing in the transcript (or its steering pane holding
                      // it), or nothing at all for a queue. Every cap is a
                      // constant, and the answer is an answer either way — see
                      // {@link sayTook}.
                      () =>
                        Effect.map(
                          watchAfterKeys(padi, id, say.watch, text, signal),
                          (watched) => ({
                            said: {
                              agent: say.agent,
                              working: say.working,
                              keys: say.keys,
                              delivery: say.delivery,
                              textBytes: say.text.bytes,
                            },
                            took: sayTook(say.delivery, watched),
                          }),
                        ),
                    ),
                ),
            ),
        ),
    );
  },
};

/** The agent VOCABULARY contracts — what every agent package must declare
 *  about itself, and what the registry (`kolu-agents`) folds.
 *
 *  This leaf names no agent (the anyforge note: the kernel is the receptacle,
 *  not a registry of plugs). It owns only the SHAPE of the facts an agent
 *  brings — its brand mark, its CLI grammar, its resume policy, its info
 *  schema — and the CLI algorithms that consume them. The DATA lives in each
 *  `kolu-<agent>` package; the LISTING lives in `kolu-agents`.
 *
 *  Browser-safe: types + `effect`'s Schema only. An agent's `infoSchema` is an
 *  Effect schema so the registry can compose the wire union without any agent
 *  package importing another. */

import type { Schema } from "effect";
import type { AgentInfoShape } from "./agent-adapter.ts";

/** Whether a stable flag consumes the token that follows it as its value
 *  (`--model sonnet` → `"value"`) or is a standalone boolean switch
 *  (`--dangerously-skip-permissions` → `"boolean"`). Co-located with each
 *  flag's membership in `AgentCliGrammar.stableFlags`, so arity and membership
 *  — two facets of the same flag, introduced by the same event — cannot drift
 *  apart. Stating the arity is mandatory, which is what keeps a trailing prompt
 *  positional out of the MRU (the living-clue / kolu#1895 leak fix). */
export type FlagArity = "boolean" | "value";

/** The interpreter/package-manager foregrounds a Node-distributed agent hides
 *  behind: npm/pnpm/yarn/bun installs all run as their runtime, so the kernel
 *  basename is the interpreter, not the agent. A shared VALUE — the packaging
 *  fact is the same for every Node-distributed CLI — while each vocab still
 *  declares the field (the boundary that revs with its own packaging). An agent
 *  on another runtime declares its own set (Xyne: `python`/`uv`). */
export const NODE_CLI_SHIMS: ReadonlySet<string> = new Set([
  "node",
  "nodejs",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "deno",
]);

/** A canonical UUID (session ids for most agents, and Xyne's resume ref). */
export const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** An agent whose resume ref may be EITHER a native id or a transcript PATH
 *  (pi, omp): an absolute path ending in `.jsonl`, or a UUID. */
export const SESSION_PATH_OR_UUID_RE =
  /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|\/[\w .,@=+(){}#%/~-]*\.jsonl)$/;

/** THE brand mark for an agent, as data — ONE mark, rendered by both the
 *  tile-chrome icon and the dock pip. Structurally identical to
 *  `@kolu/solid-statepip`'s `PipGlyphDef` — no import in either direction; TS
 *  structural typing is the seam. The value each agent declares is the 24×24
 *  normalized mark that paints identically in both contexts. */
export interface AgentMark {
  viewBox: string;
  paint: "fill" | "stroke";
  paths: readonly string[];
  strokeWidth?: number;
}

/** An agent's CLI grammar — the two facts kolu needs to turn the agent's
 *  REGISTRY vocab plus a live process's argv into a launch line. `basename` is
 *  the binary name (`"claude"`, `"xyne"`); `stableFlags` is the allowlist of
 *  flags that define a meaningfully different invocation.
 *
 *  No exit/non-session carve-outs live here any more: those existed to decide
 *  whether a user-TYPED line named an agent session. kolu no longer reads a
 *  captured command line at all — an agent is identified by the foreground
 *  process and its session file, and its flags are read from the LIVE process's
 *  argv, which by definition belongs to a running session. */
export interface AgentCliGrammar {
  /** The binary name, e.g. `"claude"`, `"xyne"`. */
  readonly basename: string;
  /** Foreground process names that HIDE this agent's CLI: an npm/pip-installed
   *  agent runs as its interpreter, so the kernel basename never names it. A
   *  shell's preexec hint may break the tie ONLY against one of these — the exact
   *  case juspay/kolu#673 needed. Declared per agent, beside
   *  `basename`/`stableFlags`, so it revs with the agent's OWN packaging: a
   *  `uv`-installed agent adds `uv` in its own package, and one agent's shims can
   *  never claim another agent.
   *
   *  This does NOT close the residual: a forged mark naming THIS agent while one
   *  of these interpreters runs a non-agent program (`node` running vite) still
   *  matches, and a cwd-keyed resolver (codex / opencode / pi / xyne) can then
   *  claim a session from the directory. The alternative — never trusting a hint
   *  — blinds every npm-installed agent, which is why the window exists. */
  readonly shims: ReadonlySet<string>;
  /** Allowlist of flags that define a meaningfully different invocation, each
   *  mapped to its arity. Only these survive capture from the process argv; a
   *  flag not listed is dropped silently — the safe default. */
  readonly stableFlags: ReadonlyMap<string, FlagArity>;
}

/** How an agent resumes a prior conversation — the whole per-agent resume
 *  policy, declared in the agent's own vocab, so "how does agent X resume?" is
 *  one thing in one place.
 *
 *  Three facets:
 *   - `byId`  — resume the EXACT conversation by its native ref (juspay/kolu#1495).
 *   - `idPattern` — the shell-inert shape gate a ref must pass before it is
 *       spliced via `byId`. Fail-closed: a ref that fails this pattern yields NO
 *       resume (a bare shell) — there is no most-recent fallback to downgrade to.
 *   - `ref`   — the persisted resume ref for a live session's info. Four agents
 *       write `(i) => i.sessionId`; pi (the fifth) writes `(i) => i.sessionPath`.
 *       REQUIRED, not optional: no default, no `??` collapse (conventions: no
 *       override knobs).
 *
 *  There is deliberately no `last` spelling: resume always names the conversation
 *  kolu observed, so the "most recent in this directory" fallback has no reader
 *  and is gone with the captured-launch-line world. */
export interface AgentResumePolicy<Info> {
  readonly byId: (ref: string) => string;
  readonly idPattern: RegExp;
  readonly ref: (info: Info) => string;
}

/** What a message handed to a WORKING agent actually does to the turn that is
 *  running — the half of a say recipe that is about the agent's behaviour
 *  rather than about keys.
 *
 *   - `steer` — the words join the running turn at its next STEP: the TUI holds
 *     them in a steering pane and hands them over between one tool/model step
 *     and the next. A step the agent can interrupt ends early for them (omp
 *     backgrounds a running `bash` call); a step it cannot (an omp eval cell,
 *     any pi tool) holds them until it ends — minutes, if the step is a long
 *     wait. omp, pi, xyne and codex steer.
 *   - `queue` — the words wait for the current turn to END and then start a new
 *     one. claude-code and grok do this: the message is never lost, but it has
 *     no effect on what the agent is doing right now.
 *
 *  The distinction is reported back to the caller rather than hidden, because a
 *  conductor that told a worker "stop, the plan changed" needs to know whether
 *  that lands now or in ten minutes — and no keystroke can turn one into the
 *  other without cost: in omp a second Enter on the empty prompt delivers a
 *  held steer by INTERRUPTING the running tool, which kills the step. */
export type AgentSayDelivery = "steer" | "queue";

/** The newest user message in an agent's transcript, as a steer sight reads
 *  it: its id, and the text it carries. The TEXT is what makes a landing this
 *  steer's rather than anyone's — an older held steer being taken, or the
 *  human typing in that terminal, moves the id too. `text` is null when the
 *  entry carried no readable text (no text part at all): a prompt kolu cannot
 *  compare, which `agent_say` says it cannot tell about rather than claiming. */
export interface SteerPrompt {
  readonly id: string;
  readonly text: string | null;
}

/** What a steering pane says about THESE words. Three-valued on purpose: a
 *  pane the reader could not parse (wrapped rows, a label a new agent version
 *  changed, an item the cut left unidentifiable) is NOT an empty pane, and
 *  reporting it as one would be `agent_say` claiming kolu saw an absence it
 *  never saw. `why` names what the reader could not do with it. */
export type PaneReading =
  | { readonly kind: "holds" }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable"; readonly why: string };

/** How kolu SEES a steer — what lets `agent_say` answer whether the words
 *  reached the running turn instead of naming a delivery it never saw.
 *
 *  Both halves are the agent's own records, read rather than inferred:
 *
 *   - `lastPrompt` — the newest user message in the transcript ({@link
 *     SteerPrompt}). A steer is written there when the turn TAKES it and not
 *     before (measured: omp 18.20.2 and pi 1.5.2 append the user entry at the
 *     step boundary that hands it over), so a new id whose text IS these words
 *     is the words having landed.
 *   - `pane` — what the agent's steering pane shows about these words: typed,
 *     accepted, and waiting for a step that cannot be interrupted to end.
 *     Measured, a held steer is delivered on its own when the step ends;
 *     nothing needs pressing. */
export interface SteerSight<Info> {
  readonly lastPrompt: (info: Info) => SteerPrompt | null;
  readonly pane: (screen: string, words: string) => PaneReading;
}

/** How much of a prompt's text a sight carries, and the one normalisation both
 *  sides of the comparison pass through. A whole prompt can be a pasted file,
 *  and it rides every record upsert for that terminal, so what is carried is
 *  the whitespace-collapsed text CUT to this many characters. Both sides are
 *  cut at the same place, so the comparison stays an equality — never "one is
 *  a prefix of the other", which is the ambiguity {@link paneHolds} exists to
 *  refuse. */
export const LAST_PROMPT_TEXT_CHARS = 512;

/** A prompt's text as a sight carries and compares it. */
export function normalisePromptText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, LAST_PROMPT_TEXT_CHARS);
}

/** Is the text of a transcript's newest prompt THESE words? Equality over
 *  {@link normalisePromptText}, so a prompt that moved because someone else's
 *  words landed is not read as this steer landing. */
export function promptTextIs(stored: string, words: string): boolean {
  const kept = normalisePromptText(stored);
  return kept !== "" && kept === normalisePromptText(words);
}

/** The TEXT of a transcript user entry's `content` parts, normalised the way a
 *  sight carries it — omp and pi write the same shape
 *  (`[{ "type": "text", "text": … }]`), so the reader is shared rather than
 *  copied into each fold. Null when the entry carried no text part at all: a
 *  prompt kolu cannot compare, said as that rather than as an empty string. */
export function promptTextOfParts(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;
  const texts: string[] = [];
  for (const part of parts) {
    if (part === null || typeof part !== "object") continue;
    const { type, text } = part as { type?: unknown; text?: unknown };
    if (type === "text" && typeof text === "string") texts.push(text);
  }
  if (texts.length === 0) return null;
  const kept = normalisePromptText(texts.join("\n"));
  return kept === "" ? null : kept;
}

/** What a steering pane's ITEMS say about these words — the comparison every
 *  pane reader shares, so a sight states only how its own pane is drawn and
 *  hands the rows here.
 *
 *  A pane draws an item on one row: cut to the width with a trailing `…`, a
 *  multiline message joined by a newline mark (omp's `↵`). So the WHOLE of the
 *  words — every line, the marks dropped and the whitespace collapsed — must be
 *  the whole of an item. A prefix counts only where the pane CUT the item, and
 *  only when exactly one item can be it. Two cut items that could both be these
 *  words, or an item the cut left empty, are `unreadable`: kolu saw a pane it
 *  cannot read, which is not an empty one. */
export function paneHolds(
  items: readonly string[],
  words: string,
): PaneReading {
  const collapse = (s: string): string =>
    s.replace(/↵/g, " ").replace(/\s+/g, " ").trim();
  const want = collapse(words);
  if (want === "")
    return { kind: "unreadable", why: "the words collapse to nothing" };
  let cutCandidates = 0;
  let uncomparable = 0;
  for (const item of items) {
    const cut = /…\s*$/.test(item);
    const drawn = collapse(item.replace(/…\s*$/, ""));
    if (drawn === "") {
      uncomparable++;
      continue;
    }
    if (!cut) {
      if (drawn === want) return { kind: "holds" };
      continue;
    }
    if (want.startsWith(drawn)) cutCandidates++;
  }
  if (cutCandidates === 1) return { kind: "holds" };
  if (cutCandidates > 1) {
    return {
      kind: "unreadable",
      why: `${cutCandidates} items in the pane are cut short and any of them could be these words`,
    };
  }
  if (uncomparable > 0) {
    return {
      kind: "unreadable",
      why: `${uncomparable} item(s) in the pane were drawn with no readable text`,
    };
  }
  return { kind: "absent" };
}

/** How to hand this agent words while it is WORKING: which keys submit, and
 *  what submitting then does ({@link AgentSayDelivery}). `null` on a recipe
 *  means kolu will not try — see {@link AgentSayRecipe.working}.
 *
 *  A `steer` names how it is SEEN ({@link SteerSight}), or `"unmeasured"` for
 *  an agent whose transcript and steering pane nobody has measured — `agent_say`
 *  then says the landing is not observable rather than guess at it. A `queue`
 *  has nothing to see mid-turn: the words wait for the turn to end. */
export type AgentSayWhileWorking<Info> =
  | { readonly keys: readonly string[]; readonly delivery: "queue" }
  | {
      readonly keys: readonly string[];
      readonly delivery: "steer";
      readonly sight: SteerSight<Info> | "unmeasured";
    };

/** THE per-agent keystroke recipe for "say this to the agent in that terminal"
 *  — what kolu-mcp's `agent_say` performs so no driver ever has to learn one
 *  agent's submit ritual (the human having to tell a conductor that omp needed
 *  a second Enter is the bug this exists to delete).
 *
 *  A recipe is the keys that follow the TEXT, never the text itself: the text
 *  is written by the shared send encoder (`@kolu/terminal-protocol`, bracketed
 *  paste for multiline), the terminal is then allowed to settle, and only then
 *  are these keys pressed — the same text → settle → submit discipline
 *  `lifecycle_sendInput` documents, and the reason a single `Enter` suffices
 *  for every agent kolu has measured (an Enter fused to the paste is eaten by
 *  the TUI's paste debounce, which is what a "second Enter" was papering over).
 *
 *  `verified` is REQUIRED and says how this recipe is known to be true — the
 *  agent version and the date it was run here, or the docs URL for an agent
 *  this machine cannot run. A recipe nobody can source is a guess, and a guess
 *  typed into someone's half-finished work is worse than a refusal. */
export interface AgentSayRecipe<Info> {
  /** Keys to press after the text when the agent is idle at its prompt. */
  readonly idle: readonly string[];
  /** The same while the agent is WORKING, or `null` when kolu must refuse
   *  mid-turn for this agent (its TUI drops or mangles input during a turn).
   *  Not a fallback to `idle`: typing into a TUI that is not listening loses
   *  the words silently, which is the one outcome worse than a refusal. */
  readonly working: AgentSayWhileWorking<Info> | null;
  /** How this recipe was established — `"ran omp 18.18.8 on 2026-11-13"`, or a
   *  documentation URL for an agent that is not installed here. */
  readonly verified: string;
}

/** Everything kolu must know about one agent, declared in its own package.
 *  An agent that forgets a facet fails to compile in its own package — the
 *  `satisfies never` fence relocated to the right home. */
export interface AgentVocab<Info extends AgentInfoShape> {
  /** Discriminator matching `Info["kind"]` (e.g. "claude-code", "opencode"). */
  readonly kind: Info["kind"];
  /** Human display name (`"Claude Code"`, `"OpenCode"`). */
  readonly displayName: string;
  /** The brand mark, rendered by both the tile chrome and the dock pip. */
  readonly mark: AgentMark;
  /** CLI recognition + normalization grammar. */
  readonly cli: AgentCliGrammar;
  /** How this agent resumes a prior conversation. */
  readonly resume: AgentResumePolicy<Info>;
  /** The wire schema for this agent's info — composed into the registry's
   *  closed `AgentInfoSchema` union. Typed `Codec` (not the wider `Schema`) so
   *  each member keeps `DecodingServices = never`; widening to `Schema<Info>`
   *  erases it to `unknown`, which then poisons every schema composed with the
   *  union (the `TerminalSnapshotSchema` decoders). */
  readonly infoSchema: Schema.Codec<Info>;
  /** How to say something to this agent through its TUI — the keys `agent_say`
   *  presses after the text, per state. `null` for an agent kolu cannot steer
   *  at all: the tool then refuses by name instead of guessing keys. */
  readonly say: AgentSayRecipe<Info> | null;
}

// biome-ignore lint/suspicious/noExplicitAny: `Info` is the existential here — the registry stores vocabs of different `Info` and looks them up by kind, and `AgentVocab<AgentInfoShape>` is NOT a supertype (the resume `ref` is contravariant in `Info`), so the erasure must be `any`.
export type AnyAgentVocab = AgentVocab<any>;

/** **The prop bag's vocabulary, as values — and the narrowing that fills the bag
 *  from a wire that carries it as plain text.**
 *
 *  The row's props name six closed sets: the agent's `state`, the pip's
 *  `variant` / `glyph` / `motion`, the row's paint `bucket`, and the recency
 *  `mode`. A consumer that renders this row does not always *receive* them
 *  typed. A fleet mirror's own transport deliberately carries agent state as a
 *  plain nullable string, because the alternative is worse: kolu's state
 *  literals do not exist as an array anywhere upstream — they live in five
 *  per-agent packages and compose as a union — so importing them into an
 *  outline wire spec compiles the whole per-agent schema graph into it.
 *
 *  So the consumer arrives holding strings. There are exactly two ways to get
 *  from there into the bag, and only one of them is safe:
 *
 *    · **declare your own copy of the literals** — a SECOND closed set for one
 *      vocabulary. Two closed sets drift, and the drift is silent: kolu's
 *      `satisfies never` fences fire in kolu, not in the consumer, so a new
 *      agent state lands as a literal the mirror has simply never heard of.
 *    · **narrow against the vocabulary itself** — what this module is for. The
 *      closed set has ONE home, this package's prop bag, and the bag ships the
 *      guard that fills it. A consumer casts nothing.
 *
 *  The pip trio's guards live with the pip vocabulary (`@kolu/solid-statepip`)
 *  and are re-exported through `./rowValues` beside these, so filling the bag is
 *  one import even though the vocabulary has two homes. Location is structure;
 *  the door is ergonomics.
 *
 *  **Unknown degrades VISIBLY.** Every array below is `Object.keys` of a
 *  `Record` keyed by the union itself, so a member cannot slip out of the list —
 *  but a *wire* can still name a state this build has never heard of (an older
 *  mirror against a newer padi, or the reverse). {@link narrowAgentState} does
 *  not silently normalise that onto a known state and does not drop it: it
 *  withholds the typed literal (so no fold is handed a state it cannot decide)
 *  while KEEPING the raw word, which is what `data-agent-state` carries and what
 *  the row's subline shows. That is kolu's own answer for an unrecognised state
 *  — `agentBucket` returns `other`, `fleetStateLabel` prints the word verbatim,
 *  the row ranks it idle and paints it quiet. You read the strange word on the
 *  row; you never read a blank line, and you never read a lie. */

import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import type { DockRowBucket } from "./pipBind.ts";
import type { RecencyMode } from "./recency.ts";
import { stateLabels } from "./rowSubline.ts";

/** The agent state the row's `agentState` prop and its subline speak. */
export type RowAgentState = AgentInfo["state"];

/** Every agent state, off the label record that already fences the union — the
 *  ONE enumeration of kolu's agent-state vocabulary that exists as an array. */
export const ROW_AGENT_STATES = Object.keys(
  stateLabels,
) as readonly RowAgentState[];

/** Is this string an agent state?
 *
 *  `Object.hasOwn`, never `in`: `in` walks the prototype chain, so a wire word
 *  of `"toString"` or `"constructor"` would narrow as a member of a set it is
 *  not in — and then index the label record to `undefined`, putting a literal
 *  `undefined` in the row's subline. Every guard below reads the same way. */
export function isRowAgentState(raw: string): raw is RowAgentState {
  return Object.hasOwn(stateLabels, raw);
}

/** Fenced key set for {@link DockRowBucket} — a `Record` keyed by the union, so
 *  a seventh bucket stops this compiling rather than vanishing from the list. */
const DOCK_ROW_BUCKET_KEYS: Record<DockRowBucket, null> = {
  awaiting: null,
  linger: null,
  working: null,
  none: null,
  idle: null,
  sleeping: null,
  parked: null,
};

/** Every row paint/order bucket. */
export const DOCK_ROW_BUCKETS = Object.keys(
  DOCK_ROW_BUCKET_KEYS,
) as readonly DockRowBucket[];

/** Is this string a row bucket? */
export function isDockRowBucket(raw: string): raw is DockRowBucket {
  return Object.hasOwn(DOCK_ROW_BUCKET_KEYS, raw);
}

/** Fenced key set for {@link RecencyMode}. */
const RECENCY_MODE_KEYS: Record<RecencyMode, null> = {
  "wait-chip": null,
  hidden: null,
  ago: null,
};

/** Every recency rendering. */
export const RECENCY_MODES = Object.keys(
  RECENCY_MODE_KEYS,
) as readonly RecencyMode[];

/** Is this string a recency mode? */
export function isRecencyMode(raw: string): raw is RecencyMode {
  return Object.hasOwn(RECENCY_MODE_KEYS, raw);
}

/** What a row shows for one agent's state, narrowed from a wire that carries
 *  that state as a plain nullable string. Nothing here is a cast, and nothing
 *  here is a silent default — see the module header on unknown states. */
export type NarrowedAgentState = {
  /** The closed literal when this build knows it, `undefined` when it does not.
   *  Feed this to the folds that demand the vocabulary; they will read an
   *  unknown state as "no agent state", which is honest, rather than as some
   *  neighbouring state, which would not be. */
  state: RowAgentState | undefined;
  /** What the row's `agentState` prop takes — the wire's own word, recognised
   *  or not. `data-agent-state` is a verbatim debug/e2e handle, and printing an
   *  unfamiliar word there is more honest than dropping it. `undefined` only
   *  when the wire said there is no agent at all. */
  attr: string | undefined;
  /** The words for the row's subline: the state's own label when recognised,
   *  else the raw literal. Empty only when there is no agent. */
  label: string;
  /** False when the wire named a state this build's vocabulary does not have —
   *  the one bit a consumer might want to log, count, or paint an "unknown"
   *  affordance from. */
  known: boolean;
};

/** Narrow a wire's agent-state string into what the row needs from it. */
export function narrowAgentState(
  raw: string | null | undefined,
): NarrowedAgentState {
  if (raw === null || raw === undefined || raw === "") {
    return { state: undefined, attr: undefined, label: "", known: true };
  }
  if (isRowAgentState(raw)) {
    return { state: raw, attr: raw, label: stateLabels[raw], known: true };
  }
  return { state: undefined, attr: raw, label: raw, known: false };
}

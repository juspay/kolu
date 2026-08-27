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

import { isPipGlyphId, isPipVariant } from "@kolu/solid-statepip/pipVariant";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import {
  type DockRowBucket,
  FALLBACK_PIP_GLYPH,
  FALLBACK_PIP_VARIANT,
  FALLBACK_ORDER_BUCKET,
  pipMotionKind,
  pipShellLive,
  type StatePipBind,
} from "./pipBind.ts";
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

/** ONE wire row's kolu VOCABULARY, as text — in the shape the wire already has.
 *
 *  `bucket` is a SIBLING of the pip bag, never a member of it, and the nesting
 *  is the whole point rather than a formality. The row's `bucket` is the ORDER
 *  fold (`classifyDockRow` → `Exclude<DockRowBucket, "linger">`); the pip's
 *  `variant` is the PAINT fold ({@link pipVariant} over `paintDockRow`'s
 *  answer). kolu keeps the two apart on purpose and they DISAGREE in a case it
 *  names: a fresh `waiting` agent paints `linger` — a dim glow — while the order
 *  bucket ranks it `idle`. Flattening them into one bag would say, in an
 *  exported type, that one is derivable from the other; it is not, and the
 *  `Exclude` is the proof (`pipVariant(orderBucket)` can never return `linger`,
 *  while the real variant does). Narrow each against its own vocabulary. */
export type WireRowVocab = {
  /** The bound pip as a wire carries it: {@link StatePipBind} with its two
   *  closed-set IDENTITY members widened to string, and its two DERIVED members
   *  gone. `Omit` off the bag, never a re-typed copy, so a new field on the bag
   *  is a new field here.
   *
   *  **THE RULE, because this is the third field it has decided: a DERIVED FIELD
   *  IS NOT A WIRE FACT.** If a member of the bag is a total function of other
   *  members, it does not cross — the wire carries the INPUTS and this end runs
   *  the fold. Two members qualify today:
   *
   *    · `motion` — `pipMotionKind({ variant, active })`;
   *    · `shellLive` — `pipShellLive({ variant, hasAgent, bytesLive })`, whose
   *      one input the bag does not itself carry is `hasAgent`, so THAT crosses
   *      instead. Send the input, not the answer.
   *
   *  Two reasons, and the second is the one that makes it a rule rather than a
   *  tidy-up. **A carried derived field admits combinations no producer can
   *  generate** — `spin` beside `active: false`, `shellLive: true` beside
   *  `variant: "working"` — each field honest alone and lying jointly, which is
   *  the shape a per-field review cannot see. **And a carried one would have to
   *  agree with the variant THIS build paints**, which after narrowing may not
   *  be the variant the wire named: an unrecognised `variant` falls back to
   *  `idle`, and a transported `motion` computed against the word the wire sent
   *  would then contradict the mark actually drawn. Recomputing is not a
   *  belt-and-braces check on the wire's answer; it is the only answer that can
   *  be right.
   *
   *  A fourth field arriving is decided by the rule, not by a third argument. */
  pip: Omit<StatePipBind, "variant" | "glyph" | "motion" | "shellLive"> & {
    variant: string;
    glyph: string;
    /** WHETHER AN AGENT IS DRIVING the terminal — the one `shellLive` input the
     *  bag does not itself carry, and the reason `shellLive` can leave the wire
     *  the way `motion` did. Send this, not the answer. */
    hasAgent: boolean;
  };
  /** The row's ORDER bucket (`data-bucket`), verbatim. */
  bucket: string;
};

/** A bound bag → the wire shape, so the two DERIVED members leave by
 *  construction rather than by remembering to strip them.
 *
 *  The type alone is only half a contract: excess-property checks do not fire
 *  through a variable, so a producer holding a {@link StatePipBind} could assign
 *  it into a `WireRowVocab` and transport the very fields the type exists to
 *  exclude. This is the other half — the README's "do not send `motion`"
 *  becomes a function rather than a sentence. */
export function toWireRowVocab(row: {
  pip: StatePipBind;
  bucket: DockRowBucket;
  /** Whether an agent is driving the terminal — {@link WireRowVocab}'s own
   *  `pip.hasAgent`, which the bound bag does not carry. */
  hasAgent: boolean;
}): WireRowVocab {
  const { motion: _motion, shellLive: _shellLive, ...pip } = row.pip;
  return { pip: { ...pip, hasAgent: row.hasAgent }, bucket: row.bucket };
}

/** Which wire word this build did not recognise. Three, not four: `motion` is
 *  never a wire word — see {@link WireRowVocab}. */
export type RowVocabField = "variant" | "glyph" | "bucket";

/** What the row needs from a wire's vocabulary, narrowed. Nothing here is a
 *  cast, and no unknown word is swallowed — see {@link narrowRowVocab}. */
export type NarrowedRowVocab = {
  /** The bag `<DockRow>` and `<StatePip>` take, whole. */
  pip: StatePipBind;
  /** The row's `bucket` prop — `data-bucket`, and the order the row ranks at. */
  bucket: DockRowBucket;
} & (
  | {
      /** This build recognised every word.
       *
       *  NOT "the two builds agree": a NEWER mirror against an OLDER wire
       *  produces no unknown words at all, so nothing surfaces and nothing
       *  should. */
      known: true;
    }
  | {
      known: false;
      /** The wire's OWN words for the members this build did not recognise,
       *  keyed by field — non-empty by construction, because this arm is the
       *  one that exists when something was not recognised.
       *
       *  A UNION and not a `known` boolean beside an always-present bag: the
       *  two would be one fact in two places, and `{ known: true, unrecognised:
       *  { variant: "zzz" } }` would typecheck for anyone building this value —
       *  which, this type being exported for exactly that, is not hypothetical.
       *  Here the payload exists only on the arm that has one, so reading it
       *  means having checked.
       *
       *  It exists at all because the pip cannot do what the agent state does.
       *  An unrecognised agent state keeps its raw word and the row PRINTS it —
       *  `data-agent-state` carries it, the subline shows it. A pip is a 20px
       *  picture with no text channel, so a strange word cannot reach the screen
       *  through the mark itself; withholding the mark instead would draw
       *  nothing, and "nothing" reads as "there is nothing here", which is a lie
       *  rather than an absence. So the mark is drawn from kolu's own default
       *  and the word survives BESIDE it, as a value to log, count, or paint an
       *  "unknown" affordance from. The fallback is what the row DRAWS; this is
       *  the fact it must not cost you. */
      unrecognised: Partial<Record<RowVocabField, string>>;
    }
);

/** Narrow one wire row's kolu vocabulary into the row's prop bags — each guard
 *  and its default in ONE place, so a consumer never spells a member of a closed
 *  set.
 *
 *  Every guard this package exports had no paired default, so every consumer
 *  wrote the default itself — and wrote it silently: the first one to do so
 *  spelled `"idle"`, `"shell"`, `"none"`, `"idle"` in four places, and no line
 *  of it could afterwards tell that a fallback had fired. That, not the
 *  copy-paste, is what this closes.
 *
 *  **Each default is kolu's own answer, and READ from it rather than re-typed.**
 *  `FALLBACK_PIP_VARIANT`, `FALLBACK_PIP_GLYPH` and `FALLBACK_ORDER_BUCKET` are the
 *  same constants `paintDockRow`'s last line and {@link pipGlyphFor}'s terminal
 *  `else` return, so the claim is mechanical instead of a docstring
 *  cross-reference: an absent paint is the quiet `idle` body (never `empty`,
 *  which would swallow the identity glyph), an unknown driver is the `shell`
 *  prompt, an unrecognised order bucket ranks `idle`. Spelled here as fresh
 *  literals they would have been one fact in two places, kept in step by a
 *  comment — the exact defect this module exists to retire.
 *
 *  And the two DERIVED members are not guessed at all: `motion` and `shellLive`
 *  are RE-FOLDED from the narrowed variant through {@link pipMotionKind} and
 *  {@link pipShellLive} — the same folds that produced the wire's answers
 *  server-side. That is two fewer hand-picked literals, and strictly better
 *  than the `"none"` a consumer reached for, which stills the mark on a
 *  terminal the same bag says is active.
 *
 *  **It does not throw, and that is not a softness.** The fail-fast rule is about
 *  values this build owns — bake them in, crash if one is absent. A word off
 *  another build's wire is untrusted INPUT, and the guard is its validation. A
 *  `narrowRowVocab` that threw would take down, inside a render, the very row
 *  that was about to tell you the two builds have diverged: it would destroy the
 *  evidence it exists to surface. Rank it idle, paint it quiet, keep the word —
 *  the same answer this module's header already gives for an unrecognised state. */
export function narrowRowVocab(wire: WireRowVocab): NarrowedRowVocab {
  const unrecognised: Partial<Record<RowVocabField, string>> = {};

  /** Narrow one field, or record the wire's word and hand back kolu's answer.
   *  One helper so the "keep the word" step cannot be forgotten on a fifth
   *  field the way it was forgotten on all four downstream.
   *
   *  `fallback` is a VALUE, not a thunk: every one of them is a constant this
   *  package already names, so deferring costs an allocation and reads as
   *  though the default were expensive or effectful — a false signal about the
   *  one thing this function most wants to be legible. */
  function narrow<T extends string>(
    field: RowVocabField,
    raw: string,
    is: (value: string) => value is T,
    fallback: T,
  ): T {
    if (is(raw)) return raw;
    unrecognised[field] = raw;
    return fallback;
  }

  const variant = narrow(
    "variant",
    wire.pip.variant,
    isPipVariant,
    FALLBACK_PIP_VARIANT,
  );
  const glyph = narrow(
    "glyph",
    wire.pip.glyph,
    isPipGlyphId,
    FALLBACK_PIP_GLYPH,
  );
  const bucket = narrow(
    "bucket",
    wire.bucket,
    isDockRowBucket,
    FALLBACK_ORDER_BUCKET,
  );
  // Never narrowed, always FOLDED — from the variant this build will actually
  // paint, not the one the wire named. See {@link WireRowVocab}.
  const { hasAgent, ...rest } = wire.pip;
  const motion = pipMotionKind({ variant, active: wire.pip.active });
  const shellLive = pipShellLive({
    variant,
    hasAgent,
    bytesLive: wire.pip.bytesLive,
  });

  const pip = { ...rest, variant, glyph, motion, shellLive };
  const words = Object.keys(unrecognised);
  return words.length === 0
    ? { pip, bucket, known: true }
    : { pip, bucket, known: false, unrecognised };
}

/**
 * The agent-state projection — the ONE schema-fenced home for "how an
 * `AwarenessValue`/`AgentInfo['state']` folds to a coarse class". Pure functions
 * over the schema types, no colours, no labels, no DOM, no OpenTUI, so a new
 * agent state can't drift across the consumers that fold it. Each fold is a
 * switch over the closed state set ({thinking, tool_use, running_background,
 * awaiting_user, waiting}) with a `state satisfies never` fence, so a literal
 * added to `AgentInfoSchema` compile-fails HERE — beside the schema — rather
 * than in a hand-copied switch downstream. It depends on nothing but the
 * `AgentInfo['state']` type: no transport, no renderer, no `@kolu/padi-tui`.
 *
 * This is the shared agent-state VOCABULARY that kolu's on-canvas **Dock** draws
 * from, kept renderer-agnostic so every fleet surface reads the SAME folds
 * instead of re-deriving them. The browser fleet mirror it was built alongside —
 * **pulam-web** — has since retired into padi, and `padi-tui` (the terminal
 * viewer, pulam-tui's replacement) draws only the coarse `agentBucket` here; a
 * downstream fleet mirror (drishti) can read the rest. A surface that hasn't
 * adopted a fold yet is a GAP to fill, not a sign the fold is kolu-only. The
 * folds:
 *  - `agentUrgency` (→ {need, work, idle}) + `URGENCY_RANK` — the needs-you
 *    ordering. Read by the Dock rows (and any fleet mirror that ranks needs-you).
 *  - `agentPaintClass` (→ {awaiting, linger, working, none}) — the pip/glyph
 *    paint class. Read by the Dock pip (and a fleet mirror's agent glyph). It
 *    deliberately differs from urgency on `waiting`: a just-finished agent
 *    paints `linger` (the dimmed lingering dot) but RANKS idle — order≠colour.
 *    It is `attentionClass` RENAMED, not a second switch over the literals.
 *  - `attentionClass` (→ {asking, working, linger, finished, idle}) +
 *    `attentionActive` (does the mark move) + `attentionCounted` (does a scope
 *    count it) — WHICH attention list a terminal is in, and the two questions
 *    every surface asks about that. Unlike the folds above it takes padi's EF2
 *    finish verdict as well as the agent state; padi builds the urgency cell's
 *    id-lists with it and every kolu surface reads a terminal's class back off
 *    those lists, so counts, motion and paint cannot disagree.
 *  - `alertClass` (→ {notify, quiet}) — the fire-a-notification membership.
 *    kolu's attention engine now derives notify membership from `agentBucket`
 *    (awaiting ∪ waiting) directly, so this coarser fold currently has no live
 *    consumer; a downstream fleet mirror's notifications remain the next consumer
 *    for the partition (it lives on per the folds'-home rule). It notifies on a finished
 *    agent (`waiting`) too — "notify me something happened" ≠ "rank by what
 *    needs my action".
 *
 * Each consumer keeps only its PRESENTATION over this core: a TUI maps
 * urgency/paint → its own tones and labels ("awaiting you"); a browser mirror
 * folds paint → the shared `StatePip` for each ROW pip and keeps urgency only
 * for the needs-you strip + footer aggregate colours and the "needs you" labels.
 */

import type { AgentInfo, TerminalSnapshot } from "./schema.ts";

/** The em-dash sentinel for "no value / never observed" — the recency cell's
 *  empty state, spelled once here so every renderer (and any direct read) shares
 *  the one glyph. */
export const DASH = "—";

/** Compact relative age (`3s`/`5m`/`2h`/`4d`) of an epoch-millis against `now`;
 *  `0` (no agent activity ever observed) renders as a dash. */
export function relativeTime(ms: number, now: number): string {
  if (ms <= 0) return DASH;
  const secs = Math.max(0, Math.floor((now - ms) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** The agent vendor's short label — `claude-code` reads as `claude`. */
export function agentShortName(kind: string): string {
  return kind === "claude-code" ? "claude" : kind;
}

/** The coarse bucket an agent's fine-grained state falls in. The closed union
 *  lets a tone/label decision switch exhaustively over it. Keyed on the schema's
 *  own `AgentInfo['state']` (not a bare `string`) with a `satisfies never` fence
 *  on the default arm: a new state literal added to `AgentInfoSchema` then
 *  compile-fails HERE — in the single shared definition — rather than silently
 *  routing to idle in a hand-copied switch. (Mirrors `dockModel.ts`'s fence; the
 *  fleet's `waiting` semantics differ from the dock's, so the two buckets stay
 *  separate.) A `default` is still kept so an unrecognized state surfaces as
 *  `other` (shown verbatim) at runtime rather than throwing. */
export function agentBucket(
  state: AgentInfo["state"],
): "working" | "awaiting" | "waiting" | "other" {
  switch (state) {
    case "thinking":
    case "tool_use":
    case "running_background":
      return "working";
    case "awaiting_user":
      return "awaiting";
    case "waiting":
      return "waiting";
    default:
      // Exhaustiveness fence: a new `AgentInfo["state"]` literal stops this
      // compiling, forcing a bucket decision here instead of falling to `other`.
      state satisfies never;
      return "other";
  }
}

/** The coarse agent buckets a wait or a watch accepts as TARGETS — the
 *  {@link agentBucket} fold's vocabulary minus `other` (an `other` bucket never
 *  matches a real agent, so accepting it would only ever time out).
 *
 *  Beside the fold it is defined FROM, so the exhaustiveness fence above is also
 *  the fence on this list, and so a face that prints the vocabulary (`kolu
 *  watch --help`, `kolu wait --help`) can read it out of a leaf rather than
 *  hand-copying it into a sentence that then quietly stops being true. */
export const WAIT_STATES = [
  "working",
  "awaiting",
  "waiting",
] as const satisfies readonly Exclude<
  ReturnType<typeof agentBucket>,
  "other"
>[];

export type WaitState = (typeof WAIT_STATES)[number];

/** Is `token` one of the wait buckets? THE whole vocabulary-side contract for a
 *  `--until` or `--states` token, and deliberately nothing more: how a CLI
 *  splits a comma list and phrases its rejection is argv grammar, which belongs
 *  to the face. */
export function isWaitState(token: string): token is WaitState {
  return (WAIT_STATES as readonly string[]).includes(token);
}

/** What a supervision watch that names NO states means: the two buckets that
 *  need a person. `awaiting` is an agent blocked on you and `waiting` is one
 *  whose turn ended; `working` is the third bucket and is deliberately not in
 *  the default — a feed that announced every terminal the moment it started
 *  thinking is the flood the feature exists to replace.
 *
 *  A DEFAULT, not a fallback: every face reads this one constant — padi's wire
 *  schema, the engine's decode, and the CLI's own `--help` line — so a change
 *  here cannot leave one of them advertising a default nothing applies. */
export const WATCH_DEFAULT_STATES = [
  "awaiting",
  "waiting",
] as const satisfies readonly WaitState[];

/** The dashboard label for an agent's state, derived from its bucket. An
 *  unrecognized (`other`) state falls through verbatim so a new agent state is
 *  visible rather than silently collapsed. */
export function agentStatusLabel(state: AgentInfo["state"]): string {
  const bucket = agentBucket(state);
  return bucket === "other" ? state : bucket;
}

/** The coarse PAINT class an agent's state glows as — the canvas tile aura, the
 *  minimap badge, the expanded-switcher columns, and the title pip all read it.
 *  A *different* partition from urgency: it distinguishes the two quiet-violet
 *  states urgency folds together — `awaiting` is the agent BLOCKED on you
 *  (`awaiting_user`, full-strength needs-you paint), `linger` is the post-turn
 *  lull (`waiting`, the dimmed just-finished cue) — whereas `agentUrgency`
 *  ranks `waiting` as idle. "awaiting" therefore means the SAME thing here as
 *  in `agentBucket`: blocked on you, nothing else (the old conflation of the
 *  two violet states under one paint name was exactly how needs-you ended up
 *  rendered at linger strength — the fucknotif defect). `none` is the absent /
 *  unknown class (no glow). */
export type AgentPaintClass = "awaiting" | "linger" | "working" | "none";

/** Rename an ATTENTION class into the PAINT vocabulary — the ONE table that
 *  translates between the two, so no consumer writes its own copy of it.
 *
 *  It is not a second switch over the state literals: paint and attention
 *  partition the identical `AgentInfo['state']` set into isomorphic classes
 *  (`asking`↔`awaiting`, `idle`↔`none`, `finished` folded back into `linger`),
 *  so spelling them as two independent switches meant a new state literal
 *  forced the same decision twice and the two could agree only by luck. One
 *  switch over the literals lives in `agentBucket`; this is a rename of its
 *  answer.
 *
 *  Exported because the rename had a SECOND spelling downstream — the dock's
 *  `paintDockRow` mapped the same five class literals to the same paint
 *  answers, diverging on one arm — which is exactly the "two switches that
 *  happen to match" this vocabulary exists to prevent. A consumer that needs a
 *  different answer for one class maps THAT arm off this result, locally and
 *  visibly, instead of restating the whole table. */
export function paintClassOf(klass: AttentionClass): AgentPaintClass {
  switch (klass) {
    case "working":
      return "working";
    // Blocked on you — the full-strength needs-you paint.
    case "asking":
      return "awaiting";
    // The post-turn lull keeps a dimmed glow until it parks (contrast
    // `agentUrgency`, where `waiting` is idle — paint and rank deliberately
    // disagree here). EF2's `finished` changes nothing about the paint: a
    // finished agent keeps the lingering cue until its row parks.
    case "linger":
    case "finished":
      return "linger";
    case "idle":
      return "none";
  }
}

/** Map an agent's state to its PAINT class — `attentionClassOfState` renamed.
 *
 *  `finished: false` is what makes this a state-only fold: EF2 is the caller's
 *  verdict, and paint deliberately doesn't consult it. */
export function agentPaintClass(state: AgentInfo["state"]): AgentPaintClass {
  return paintClassOf(attentionClassOfState(state, false));
}

/** The agent-state ALERT class — the partition a fire-a-notification layer keys
 *  on (kolu's attention engine now keys on `agentBucket` directly; this remains
 *  the canonical notify-membership fold for a future mirror). `notify` = the agent
 *  just finished its turn
 *  and yielded (`waiting`) or actively blocks on the user (`awaiting_user`);
 *  `quiet` = everything else. Folding the two notify states into ONE class means
 *  flipping between them within a session doesn't double-alert.
 *
 *  Deliberately a DIFFERENT partition from `agentUrgency` (where `waiting` is
 *  idle — a finished agent isn't asking you to *act*) and from `agentPaintClass`:
 *  "notify me something happened" and "rank by what needs my action" are
 *  different questions, so they classify `waiting` differently, on purpose. The
 *  three folds disagree on `waiting` by design; they live here together only so
 *  the closed state set is folded in ONE schema-fenced file. */
export type AlertClass = "notify" | "quiet";

/** Map an agent's state to its ALERT class. Switches exhaustively over the
 *  closed `AgentInfo['state']` set with a `state satisfies never` fence on the
 *  default arm, so a new state literal added to `AgentInfoSchema` compile-fails
 *  HERE — forcing an alert decision in the single shared definition — rather
 *  than silently staying `quiet` and dropping the notification. */
export function alertClass(state: AgentInfo["state"]): AlertClass {
  switch (state) {
    case "awaiting_user":
    case "waiting":
      return "notify";
    case "thinking":
    case "tool_use":
    case "running_background":
      return "quiet";
    default:
      // Exhaustiveness fence: a new `AgentInfo["state"]` literal stops this
      // compiling, forcing an alert decision here rather than falling to `quiet`.
      state satisfies never;
      return "quiet";
  }
}

/** Which attention list a terminal belongs to, given its agent AND whether its
 *  post-turn quiet window has closed (padi's EF2 "effective finish"). A closed
 *  five-way partition — every terminal is in exactly ONE class — so a count over
 *  the classes needs no de-duplication and a surface can't put the same terminal
 *  in two places.
 *
 *  It is a different question from the three folds above, which read the agent
 *  state ALONE: `waiting` splits here into `linger` (turn over, output still
 *  landing) and `finished` (gone quiet), a distinction no state literal carries.
 *  That split is the whole point — it is the boundary between "still going" and
 *  "done", and therefore between counted and uncounted. */
export type AttentionClass =
  | "asking"
  | "working"
  | "linger"
  | "finished"
  | "idle";

/** The partition enumerated ONCE, beside the type it enumerates — what a
 *  consumer builds a per-class structure from (a wire frame's id lists, a
 *  count's fold) instead of hand-writing the five literals again.
 *
 *  The keys come off a `Record` keyed by the class itself, which is the fence:
 *  a sixth `AttentionClass` stops this object compiling, so it cannot silently
 *  vanish from a list built from this array — a class nothing enumerates is a
 *  class nothing counts, which is precisely the defect the partition exists to
 *  prevent. A plain `as const` array would have passed green. */
const ATTENTION_CLASS_KEYS: Record<AttentionClass, null> = {
  asking: null,
  working: null,
  linger: null,
  finished: null,
  idle: null,
};
export const ATTENTION_CLASSES = Object.keys(
  ATTENTION_CLASS_KEYS,
) as readonly AttentionClass[];

/** Partition a terminal into its attention class. `finished` is the caller's
 *  EF2 verdict for this terminal (padi's finish-quiet tracker); it is consulted
 *  only for a `waiting` agent, where it decides linger-vs-finished.
 *
 *  The ONE partition: padi's `recomputeUrgency` folds its terminals through it
 *  to build the four wire id-lists, and every kolu surface reads a terminal's
 *  class straight off those lists (`frameClassOf`). `agentPaintClass` is this
 *  same partition renamed for the paint vocabulary, so there is ONE switch over
 *  the state literals in the whole stack — the class of defect this vocabulary
 *  exists to prevent is "two switches that happen to match". */
export function attentionClass(
  agent: TerminalSnapshot["agent"] | undefined,
  finished: boolean,
): AttentionClass {
  if (!agent) return "idle";
  return attentionClassOfState(agent.state, finished);
}

/** The partition for a LIVE agent's state — the state-only core `attentionClass`
 *  wraps with the no-agent case and `agentPaintClass` reuses so the paint
 *  vocabulary is a rename of this answer rather than a second switch. */
function attentionClassOfState(
  state: AgentInfo["state"],
  finished: boolean,
): AttentionClass {
  switch (agentBucket(state)) {
    case "awaiting":
      return "asking";
    case "working":
      return "working";
    case "waiting":
      return finished ? "finished" : "linger";
    case "other":
      return "idle";
  }
}

/** Is this terminal ACTIVE — is something happening in it right now? The ONE
 *  predicate behind every "is something happening" question kolu answers: the
 *  pip's motion (does the glyph move), and every count that summarises a host or
 *  a repo section. They are the same question, so they are the same function —
 *  a host tab reading "2" beside three moving pips is then not a bug you can
 *  write, which is exactly how it used to happen.
 *
 *  `live` is raw byte motion (kaval's meaningful-output edge). It is what makes
 *  a plain shell running a build count as active — it has no agent to ask — and
 *  what keeps a terminal that has gone `finished` counted while its last output
 *  is still printing.
 *
 *  That byte edge closes after `TERMINAL_IDLE_AFTER_MS` (~1 s), so a terminal
 *  that prints intermittently — a dev server logging a line every few seconds —
 *  enters and leaves the live set on every gap, and a count containing it ticks
 *  with it. That is deliberate, and it is not flicker between two disagreeing
 *  answers: the mark's own motion runs off the SAME edge, so the number and the
 *  marks it summarises start and stop together. Giving the count its own
 *  hysteresis would buy a calmer tab by making it disagree with the dock
 *  beneath it, which is the whole class of defect this vocabulary exists to
 *  end. If the tab should be calmer, lengthen the one idle window — do not give
 *  counting a second notion of activity. */
export function attentionActive(klass: AttentionClass, live: boolean): boolean {
  switch (klass) {
    // An agent that is thinking, blocked on you, or still settling is active
    // whether or not any byte moved in the last second.
    case "asking":
    case "working":
    case "linger":
      return true;
    // Nothing to ask an agent about — the bytes are the only evidence.
    case "finished":
    case "idle":
      return live;
  }
}

/** Does this terminal belong in a scope's ACTIVITY count? The same membership
 *  as `attentionActive` minus `asking`, which every surface counts in its own
 *  violet leg and must never also swell the rust one.
 *
 *  Motion and counting are two questions about one partition, and only the
 *  first was named: every counting site — a host tab, a repo section header,
 *  the paint/count diagnostic — subtracted `asking` again in its own dialect
 *  (a set difference here, an `else if` there, an explicit conjunction in the
 *  third). One rule in three copies held together by memory is the shape this
 *  vocabulary exists to eliminate; naming the second question here is what
 *  keeps a future class from being taught to one site and not the others. */
export function attentionCounted(
  klass: AttentionClass,
  live: boolean,
): boolean {
  return klass !== "asking" && attentionActive(klass, live);
}

/** The coarse urgency of a terminal — drives the glyph, the colour/tone, and the
 *  needs-you-first sort. `need` = an agent awaiting you; `work` = an agent
 *  working; `idle` = everything else (waiting / unknown / no agent). */
export type Urgency = "need" | "work" | "idle";

/** Map an agent to its urgency. The exhaustive switch over the closed
 *  `agentBucket` union means a new bucket forces a decision here rather than
 *  silently falling to idle. Accepts `undefined` as well as the schema's
 *  `AgentInfo | null` so a caller threading an optional-chained active arm
 *  (`activeArm(meta)?.agent`) needn't normalize `undefined`→`null` first — the
 *  truthiness check below treats both as "no agent". */
export function agentUrgency(
  agent: TerminalSnapshot["agent"] | undefined,
): Urgency {
  if (!agent) return "idle";
  switch (agentBucket(agent.state)) {
    case "awaiting":
      return "need";
    case "working":
      return "work";
    case "waiting":
    case "other":
      return "idle";
  }
}

/** The needs-you-first sort rank per urgency (lower floats up). The renderer's
 *  own urgency descriptor (TUI tone+label, web hex+label) carries the rest of
 *  the presentation; the rank — the volatile sort axis — lives here so both
 *  orderings can't disagree. */
export const URGENCY_RANK: Record<Urgency, number> = {
  need: 0,
  work: 1,
  idle: 2,
};

/** The pointed state label, given a renderer's label words per urgency: a
 *  `need`/`work` agent reads the renderer's label; an idle agent shows its own
 *  state (e.g. "waiting", or a verbatim unknown state); a terminal with no agent
 *  reads the idle label. The ONLY thing a renderer customizes is the label
 *  words — the three-way idle fork lives once, here. */
export function fleetStateLabel(
  agent: TerminalSnapshot["agent"],
  labels: Record<Urgency, string>,
): string {
  const urgency = agentUrgency(agent);
  if (urgency !== "idle") return labels[urgency];
  if (!agent) return labels.idle;
  return agentStatusLabel(agent.state);
}

/** The needs-you urgency-rank delta — the host-safe axis every ordering shares.
 *  Reads only `TerminalSnapshot["agent"]` (the live state), never recency, so it
 *  composes on both a memoryless host's `TerminalSnapshot` and kolu's remembered
 *  value. */
function urgencyRankDelta(
  a: TerminalSnapshot["agent"],
  b: TerminalSnapshot["agent"],
): number {
  return URGENCY_RANK[agentUrgency(a)] - URGENCY_RANK[agentUrgency(b)];
}

/** Order two agents by urgency alone, then a stable id tiebreak — the HOST-SAFE
 *  ordering a memoryless dashboard uses. It reads only the
 *  `TerminalSnapshot` (no recency), so a memoryless host that serves `TerminalSnapshot` —
 *  which has no `lastActivityAt` — can sort its fleet without a fold. The recency
 *  tiebreak is kolu's alone ({@link compareAgents}); a dashboard that reached for
 *  it would fail to compile (no `lastActivityAt` to supply). */
export function compareAgentUrgency(
  a: { agent: TerminalSnapshot["agent"]; id: string },
  b: { agent: TerminalSnapshot["agent"]; id: string },
): number {
  return urgencyRankDelta(a.agent, b.agent) || a.id.localeCompare(b.id);
}

/** `lastActivityAt`'s recency RANK for a most-recent-first sort — `null`
 *  (never-active; see {@link AgentMemorySchema}) sorts LAST, as if it were
 *  older than every real epoch, never as epoch `0` (which would misrank a
 *  never-active terminal ahead of one truly idle since the Unix epoch — an
 *  absurd case in practice, but the honest ordering shouldn't depend on it
 *  being absurd). */
function recencyRank(lastActivityAt: number | null): number {
  return lastActivityAt ?? Number.NEGATIVE_INFINITY;
}

/** Order two agents within a scope: needs-you first, then most-recently-active,
 *  then a stable id tiebreak. The kolu-only ordering — it adds the RECENCY
 *  tiebreak ({@link compareAgentUrgency} is the host-safe urgency-only sibling),
 *  which only kolu can supply because `lastActivityAt` is a remembered fact, not
 *  a snapshot one. The rank, recency, and tiebreak braided once so two scopes
 *  can't fall back to iteration order. */
export function compareAgents(
  a: {
    agent: TerminalSnapshot["agent"];
    lastActivityAt: number | null;
    id: string;
  },
  b: {
    agent: TerminalSnapshot["agent"];
    lastActivityAt: number | null;
    id: string;
  },
): number {
  const ra = recencyRank(a.lastActivityAt);
  const rb = recencyRank(b.lastActivityAt);
  // Explicit equality check before subtracting: `recencyRank` can return
  // `-Infinity` for two never-active agents, and `-Infinity - -Infinity` is
  // `NaN` — which `||` would treat as falsy and silently fall through to the
  // id tiebreak anyway, but spelling the tie out is honest rather than
  // relying on that coincidence.
  const recencyDelta = ra === rb ? 0 : rb - ra;
  return (
    urgencyRankDelta(a.agent, b.agent) ||
    recencyDelta ||
    a.id.localeCompare(b.id)
  );
}

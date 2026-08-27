/** WHICH of the recency cell's three renderings a row gets, WHICH timestamp that
 *  rendering means, and WHAT IT SAYS. All three pure, all three shared by every
 *  row surface, so the wash, the chip and the header count can't be reading
 *  different folds of the same terminal.
 *
 *  The three used to arrive as two independent booleans (`hidden` + `asking`)
 *  assembled per call site from two different folds, with "asking overrides
 *  hidden" living only in the JSX nesting — a state machine spelled as flags,
 *  one of whose four combinations was unreachable and another duplicate. One
 *  `mode`, computed once beside the pip it comes from, and the illegal
 *  combination stops being spellable. */

import { agoPhrase, compactPhrase } from "@kolu/terminal-vocab/duration";
import { DASH } from "@kolu/terminal-vocab/dash";

/** `wait-chip` wins over `hidden` by being a distinct value rather than by an
 *  override rule. */
export type RecencyMode = "wait-chip" | "hidden" | "ago";

/** The row's mode, from the ONE bound attention value the pip is painted from.
 *
 *  Active rows hide the label: an active terminal is "just now" by definition,
 *  so the text is noise. EXCEPT a blocked row: an `awaiting_user` agent is
 *  pip-active (glow) yet its age is the OPPOSITE of noise — it is how long the
 *  agent has been waiting on YOU, and a 20-hour wait must be legible at a
 *  glance. That row flips to the violet WAIT chip. */
export function recencyMode(pip: {
  asking: boolean;
  active: boolean;
}): RecencyMode {
  if (pip.asking) return "wait-chip";
  return pip.active ? "hidden" : "ago";
}

/** The two timestamps a row's recency is read off, NAMED.
 *
 *  Two adjacent `number | null` parameters is the one shape this fold cannot
 *  afford: swapping them is a real bug — a split's fresh activity would shorten
 *  its parent's blocked-on-you duration — and neither the type system nor a
 *  reviewer reading a call site can see the swap. As a record the pairing is
 *  spelled where it is made, so the mistake stops being expressible rather than
 *  merely being warned against in a docstring. */
export type RecencyAt = {
  /** The tile's window recency — newest activity across parent and splits. */
  window: number | null;
  /** THIS row's own agent recency — how long it has awaited you. */
  own: number | null;
};

/** Pick the timestamp whose meaning matches the rendering.
 *
 *  The ordinary timestamp is the whole tile's window key — the newest activity
 *  across parent and splits — so the age shown is the age that decides whether
 *  the window hides it. The WAIT chip is different by definition: it shows how
 *  long THIS row's agent has awaited input. A split's fresh activity keeps its
 *  parent tile visible, but must not shorten the parent's own blocked-on-you
 *  duration. This is the two-channel seam. */
export function displayRecencyAt(
  mode: RecencyMode,
  at: RecencyAt,
): number | null {
  return mode === "wait-chip" ? at.own : at.window;
}

/** The cell's TEXT, for a mode that has one.
 *
 *  The two renderings say different things on purpose. `ago` is an AGE and
 *  carries its suffix — "5m ago", "just now" under a minute, and the empty
 *  string for a terminal padi has never seen activity in, which is a row with
 *  nothing to say rather than an unknown. `wait-chip` is a live DURATION and
 *  carries none — "2m", "20h" — because the capsule sits in the 8ch recency
 *  track and a suffix would wrap it; and where `ago` renders empty, the chip
 *  renders the DASH, because a violet pill with no glyph reads as a rendering
 *  bug rather than as "unknown".
 *
 *  `hidden` is not in the domain, and that is the point rather than an omission.
 *  It has no text — {@link RowRecency}'s `hidden` arm carries none — so a
 *  `recencyText("hidden", …)` could only return the filler `""` that the union
 *  one file over exists to make unspellable. `Exclude` keeps it unspellable
 *  here too, and costs the caller nothing: after the `hidden` early-return every
 *  call site already has, TypeScript has narrowed `mode` for free.
 *
 *  **The clock is the caller's, and `now` is a parameter for the reason this
 *  package owns no clock at all**: a ticking `now` is ambient app state whose
 *  cadence the consuming app owns. Because the two modes are two separate calls
 *  rather than one bundled fold, a caller can hand each the clock it deserves —
 *  kolu passes a 1 s tick to the chip, whose sub-minute seconds must count up,
 *  and a plain `Date.now()` read to `ago`, whose 60 s ceiling on visual lag is
 *  invisible. A fold that took one `now` would have forced one cadence on both,
 *  and subscribed every quiet row to the fast one. */
export function recencyText(
  mode: Exclude<RecencyMode, "hidden">,
  at: number | null,
  now: number,
): string {
  if (mode === "wait-chip") {
    // A never-active row has no honest duration, and the capsule cannot render
    // empty — so the chip's own rule, not the phrase's, supplies the dash.
    return at === null ? DASH : compactPhrase(now - at);
  }
  return agoPhrase(at, now);
}

/** The recency cell's inputs as ONE value — the rendering, and the string
 *  computed FOR that rendering. Separately they are two props a call site can
 *  pair wrongly (a wait duration rendered into the `ago` slot reads as an age
 *  and is not one).
 *
 *  A DISCRIMINATED UNION, because `hidden` has no text and a `{ mode, text }`
 *  product made that combination spellable — the caller then had to invent a
 *  filler (`text: ""`) for a slot that means nothing. That is the shape the top
 *  of this file argues against: the two booleans `recencyMode` replaced were "a
 *  state machine spelled as flags, one of whose four combinations was
 *  unreachable and another duplicate". Re-opening it one level up would have
 *  been the same mistake.
 *
 *  It lives HERE, in the pure half, and not beside the component that renders
 *  it. A consumer folding a row on a server reaches `recencyText` through
 *  `./rowValues` — the JSX-free entry — and then needed this TYPE to put the
 *  answer anywhere, which meant importing from the barrel and compiling the
 *  whole component graph to name a union of three strings. `RecencyCell`
 *  re-exports it, so the rendering side reads unchanged. */
export type RowRecency =
  | { mode: "hidden" }
  | { mode: "ago"; text: string }
  | { mode: "wait-chip"; text: string };

/** The two clocks a row's recency is read off, each named for the OBLIGATION it
 *  carries rather than for the cadence it happens to run at — not `tick`/`stable`,
 *  which name implementations. Both have the same type `() => number`, so
 *  passing the wrong one is silent in both directions: a plain read for the
 *  chip freezes it, and a subscribing read for `ago` repaints every quiet row
 *  every second.
 *
 *  Two, not one, and that is the whole reason this fold takes them instead of a
 *  `now`: the wait chip's sub-minute seconds must COUNT UP, so it wants a
 *  subscribing tick, while "3m ago" has a 60 s ceiling on its visual lag that
 *  nobody can see, so it wants a plain read. Handing one `now` to both would
 *  either freeze the chip or subscribe every quiet row to a per-second repaint.
 *
 *  Which arm gets which is not the consumer's to remember — that is the pairing
 *  {@link rowRecency} exists to hold. What the consumer owns is the clocks
 *  themselves, because a ticking `now` is ambient app state and its cadence is
 *  the app's call. */
export type RowClocks = {
  /** Read INSIDE a reactive scope, so the chip's sub-minute seconds COUNT UP.
   *  A non-subscribing reader here does not fail — it freezes the chip at the
   *  second it first rendered, which is the readout this package exists for.
   *  kolu passes its shared 1 s tick. Called only for a wait chip that has an
   *  honest duration to count. */
  counting: () => number;
  /** A plain read, deliberately NOT subscribing: `ago` has a 60 s ceiling on
   *  its visual lag that nobody can see, and a subscribing reader here repaints
   *  every quiet row every second. kolu passes `Date.now`. Called for the `ago`
   *  arm, and for a wait chip with nothing to count. */
  glancing: () => number;
};

/** A row's whole recency, from the pip and the two timestamps — mode, timestamp,
 *  clock and words in one call.
 *
 *  This is the door. {@link recencyMode}, {@link displayRecencyAt} and
 *  {@link recencyText} are the pieces it is composed FROM, and they stay
 *  exported for a surface assembling a different set — but a consumer that
 *  wants what the Dock row shows should ask for it here, because the four steps
 *  have rules between them that a call site cannot see:
 *
 *    · `hidden` carries no text, and the union makes the filler unspellable —
 *      which only helps if the branch that produces it is not re-written per
 *      consumer;
 *    · the wait chip means THIS row's own recency and `ago` means the tile's
 *      window recency ({@link displayRecencyAt}) — pairing them the other way
 *      lets a split's fresh activity shorten its parent's blocked-on-you
 *      duration, which is why the two arrive as the NAMED {@link RecencyAt}
 *      rather than as two adjacent `number | null` positionals;
 *    · and the chip gets the ticking clock while `ago` gets the plain one,
 *      EXCEPT that a chip with no honest duration reads `glancing` too, so a
 *      never-active blocked row does not repaint every second to redraw the
 *      same dash.
 *
 *  Three rules, all invisible at a call site, all previously re-derived by
 *  whoever assembled the value. */
export function rowRecency(
  pip: { asking: boolean; active: boolean },
  at: RecencyAt,
  clocks: RowClocks,
): RowRecency {
  const mode = recencyMode(pip);
  if (mode === "hidden") return { mode };
  const shown = displayRecencyAt(mode, at);
  const now =
    mode === "wait-chip" && shown !== null
      ? clocks.counting()
      : clocks.glancing();
  return { mode, text: recencyText(mode, shown, now) };
}

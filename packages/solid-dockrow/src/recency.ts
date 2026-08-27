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
import { DASH } from "@kolu/terminal-vocab/agentProjection";

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
  windowRecencyAt: number | null,
  ownRecencyAt: number | null,
): number | null {
  return mode === "wait-chip" ? ownRecencyAt : windowRecencyAt;
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

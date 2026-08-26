/** WHICH of the recency cell's three renderings a row gets, and WHICH timestamp
 *  that rendering means. Both pure, both shared by every row surface, so the
 *  wash, the chip and the header count can't be reading different folds of the
 *  same terminal.
 *
 *  The three used to arrive as two independent booleans (`hidden` + `asking`)
 *  assembled per call site from two different folds, with "asking overrides
 *  hidden" living only in the JSX nesting — a state machine spelled as flags,
 *  one of whose four combinations was unreachable and another duplicate. One
 *  `mode`, computed once beside the pip it comes from, and the illegal
 *  combination stops being spellable. */

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

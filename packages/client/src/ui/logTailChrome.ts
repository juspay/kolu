/** The parts of a log-tail block that are genuinely shared by the places kolu
 *  shows raw host output: the connect overlay's live `connect-tail`, the failure
 *  card's `failure-log`, and the host-diagnostics popover's
 *  `host-diagnostics-log`. Same idea as `disclosureChrome.ts` — the shared parts
 *  get one name, the parts that legitimately differ stay local literals at each
 *  site.
 *
 *  What is NOT here, and why. The three differ in ways that are decisions, not
 *  duplication: the connect tail TRUNCATES each line to one row (a rolling
 *  reassurance while work is in flight, six lines deep), while both failure
 *  surfaces WRAP (a post-mortem you have to be able to read whole); and the
 *  popover is a denser scale (`text-[10px]`, tighter padding) because it renders
 *  inside a popover rather than a canvas. Folding those into a `wrap` /`size`
 *  knob would parameterize independently-changing behaviours for a class-string
 *  saving — so sizing, padding, line-clamping and max-height stay at each call
 *  site, and only what every tail shares is named once. */

/** One line of retained output, structurally. Deliberately NOT the domain `LogEntry`
 *  (`@kolu/surface-remote`'s `{ source, line }`): the card and the popover carry no
 *  domain knowledge, and a caller hands them whatever tail it kept. Named once here,
 *  beside the chrome those tails wear, rather than re-spelled longhand at each of the
 *  places that pass or take a tail — or borrowed from a canvas card by a popover that
 *  renders none. */
export type LogLine = { readonly line: string };

/** The ONE empty tail every log-tail consumer reaches for — a shared reference so a
 *  site with no output to narrate hands its `<For>` the SAME array across every
 *  re-resolve/repaint instead of a fresh `[]` literal (which would churn identity-keyed
 *  DOM on every tick even though nothing changed). Named once here, beside {@link LogLine},
 *  rather than redeclared per call site — four call sites each declaring their own
 *  `NO_LOG`/`NO_LINES` is the exact "identical content that must stay in sync" the
 *  dry-rule-of-three guards against: same shape, same rationale comment, same type. */
export const NO_LOG_LINES: readonly LogLine[] = [];

/** WHY a tail is empty, when the emptiness is not the episode's own fact — a reason a
 *  surface is TOLD, never one it infers from the emptiness.
 *
 *  A tail block that renders nothing is ambiguous at the point of render: "this step
 *  printed nothing" and "this step printed, and we cannot see it" look identical. Only
 *  the site holding the liveness fact can tell them apart, so that site says so here and
 *  the renderer renders what it was told. The absent case (`undefined`) is the ordinary
 *  one: the lines ARE the episode's output, however few.
 *
 *  A union rather than a boolean, because the next honest reason (a tail truncated at
 *  the source, a host that never reported one) is an ARM — and an arm forces every
 *  reader to decide what it means, where a second boolean would just be ignored. */
export type LogAbsence =
  /** kolu's link to this browser went quiet, so the map's liveness floor dropped the
   *  live `connection` word this tail was read off. Output exists; we cannot see it. */
  "link-down";

/** The surface a raw-output block sits on: hairline border, recessed tint,
 *  monospace, muted ink. Every log tail wears exactly this; nothing else does. */
export const LOG_TAIL_SURFACE =
  "rounded border border-bd-1/50 bg-bg-2/40 font-mono text-fg-4";

/** One line of a WRAPPED tail — the failure card's and the popover's. Both are
 *  post-mortems you have to be able to read whole, so a long line folds instead of
 *  being clipped; the two are the SAME behaviour at two scales, which is why the
 *  string is named once. `ConnectCanvas`'s live tail deliberately does the opposite
 *  (`truncate whitespace-pre`, one row per line) and keeps its own literal. */
export const LOG_TAIL_LINE = "whitespace-pre-wrap break-words";

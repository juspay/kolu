/** The one part of a log-tail block's chrome that is genuinely shared by all
 *  three places kolu shows raw host output: the connect overlay's live
 *  `connect-tail`, the failure card's `failure-log`, and the host-diagnostics
 *  popover's `host-diagnostics-log`. Same idea as `disclosureChrome.ts` — the
 *  shared part gets one name, the parts that legitimately differ stay local
 *  literals at each site.
 *
 *  What is NOT here, and why. The three differ in ways that are decisions, not
 *  duplication: the connect tail TRUNCATES each line to one row (a rolling
 *  reassurance while work is in flight, six lines deep), while both failure
 *  surfaces WRAP (a post-mortem you have to be able to read whole); and the
 *  popover is a denser scale (`text-[10px]`, tighter padding) because it renders
 *  inside a popover rather than a canvas. Folding those into a `wrap` /`size`
 *  knob would parameterize independently-changing behaviours for a class-string
 *  saving — so sizing, padding, line-clamping and max-height stay at each call
 *  site, and only the surface treatment is named once. */

/** The surface a raw-output block sits on: hairline border, recessed tint,
 *  monospace, muted ink. Every log tail wears exactly this; nothing else does. */
export const LOG_TAIL_SURFACE =
  "rounded border border-bd-1/50 bg-bg-2/40 font-mono text-fg-4";

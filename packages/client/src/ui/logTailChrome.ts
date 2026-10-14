/** WHY a tail is empty, when the emptiness is not the episode's own fact — a
 *  reason a surface is TOLD, never one it infers from the emptiness.
 *
 *  The tail's chrome and the block itself live in `@kolu/solid-logtail`; this
 *  type stays here because it is not chrome at all — it names KOLU's liveness
 *  fact (the host-map entry dropping the live `connection` word), which the
 *  package has no business knowing.
 *
 *  A tail block that renders nothing is ambiguous at the point of render: "this
 *  step printed nothing" and "this step printed, and we cannot see it" look
 *  identical. Only the site holding the liveness fact can tell them apart, so
 *  that site says so here and the renderer renders what it was told. The absent
 *  case (`undefined`) is the ordinary one: the lines ARE the episode's output,
 *  however few.
 *
 *  A union rather than a boolean, because the next honest reason (a tail
 *  truncated at the source, a host that never reported one) is an ARM — and an
 *  arm forces every reader to decide what it means, where a second boolean would
 *  just be ignored. */
export type LogAbsence =
  /** kolu's link to this browser went quiet, so the map's liveness floor dropped
   *  the live `connection` word this tail was read off. Output exists; we cannot
   *  see it. */
  "link-down";

import type { TerminalMetadata } from "kolu-common/surface";

type ResolvedPr = (TerminalMetadata["pr"] & { kind: "ok" })["value"];

/** Narrow the PR carrier to its resolved value, or null for the
 *  unresolved kinds (`absent`/`pending`/`unavailable`). The single
 *  definition of "PR is resolved" — every dock surface reads through
 *  this so a future kind added to the union forces one edit, not three. */
export function resolvedPr(pr: TerminalMetadata["pr"]): ResolvedPr | null {
  return pr.kind === "ok" ? pr.value : null;
}

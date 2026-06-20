/** Order-equality for a tile/terminal id list — the #1425 reference-stability
 *  keystone's comparator, kept as a pure LEAF (no imports beyond the id type) so
 *  both `useTerminalMetadata`'s `terminalIds` memo and the tile registry's
 *  `tileIds` memo gate on the SAME rule without the registry dragging in the
 *  heavy metadata module. A metadata-only tick that leaves the id set + order
 *  unchanged returns the prior array reference and notifies no one
 *  (`docs/atlas/.../performance.mdx`). Order is significant — it drives sidebar
 *  position labels — so a reorder must invalidate. A bounded-algorithm leaf,
 *  deliberately domain-specific to ids rather than a generic array-equality
 *  receptacle. */

import type { TerminalId } from "kolu-common/surface";

export function sameTerminalIdOrder(
  a: readonly TerminalId[],
  b: readonly TerminalId[],
): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

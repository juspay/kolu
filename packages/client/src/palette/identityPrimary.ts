/** THE ROW'S HEADLINE STRING — the same rule the Dock cards/list use: intent
 *  line-1 when set, else branch (`annotationLine` — the Dock's single
 *  derivation), a host's label, or the item's own name.
 *
 *  Its own module because two sides need it and neither may own it: the list
 *  (`CommandPalette`'s `displayed`) splits this string against the query once
 *  per row, and `PaletteRow` paints it. One derivation, so the highlighted
 *  string and the painted string cannot diverge. */

import type { PaletteCommand, PaletteLabel } from "../CommandPalette";
import { hostLabel } from "../host/hostChipTone";
import { annotationLine } from "../intent/text";

export function identityPrimary(cmd: PaletteCommand | PaletteLabel): string {
  const r = cmd.row;
  if (r?.kind === "terminal") {
    return annotationLine(r.terminalMeta?.intent, r.branchLabel ?? cmd.name);
  }
  if (r?.kind === "host" && r.hostKey) return hostLabel(r.hostKey);
  return cmd.name;
}

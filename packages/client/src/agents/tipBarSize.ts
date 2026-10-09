/** The tile tip's size — the full bar under the title bar, or a small tab
 *  hanging from its bottom-right edge. One preference for every tile
 *  (`tipBarCollapsed`); it says nothing about which tip shows. */

import { preferences, updatePreferences } from "../wire";

/** Is the tip folded to its tab? */
export const tipBarCollapsed = (): boolean => preferences().tipBarCollapsed;

export function setTipBarCollapsed(collapsed: boolean): void {
  updatePreferences({ tipBarCollapsed: collapsed });
}

/** Swap the bar and the tab — the palette's "Toggle tip bar". */
export function toggleTipBar(): void {
  setTipBarCollapsed(!tipBarCollapsed());
}

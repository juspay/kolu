/** WHICH ENTRY IN THE CHROME BAR IS SELECTED — a host tab, or the conductor.
 *
 *  The conductor sits in the same row as the host tabs and is NOT one of
 *  them: it has no host key, no entry in the host map, no padi/kaval status and
 *  nothing in the host switcher's data model. So the selection is spelled as
 *  its own value — `"conductor"` or `"hosts"` — riding the same
 *  `persistedPref` mechanism, in the same storage, as the active host tab
 *  (`activeHost`, `wire.ts`). A fake host key would have put the conversation
 *  into the host map through the back door; a second storage would have let the
 *  two halves of one selection disagree after a reload.
 *
 *  WHICH host tab is selected stays in `activeHost` while the conductor is
 *  on screen, untouched — which is what makes `⌘⇧O` a round trip: leaving the
 *  conductor lands back on exactly the tab you came from, with no memory of
 *  it kept anywhere else. */

import { createSignal } from "solid-js";
import { defaultInvalidWarning, persistedPref } from "../persistedPref";

/** The row's two kinds of destination. `"hosts"` means "whichever host tab
 *  `activeHost` names" — the row has many host tabs and exactly one
 *  conductor, so the host half needs no value of its own here. */
type ChromeTab = "conductor" | "hosts";

const [chromeTab, setChromeTab] = persistedPref<ChromeTab>({
  name: "kolu-active-chrome-tab",
  fallback: "hosts",
  parse: (raw) => {
    if (raw === "conductor" || raw === "hosts") return raw;
    throw new Error(`unknown chrome tab "${raw}"`);
  },
  // Strings store verbatim (`persistedPref`'s default serializer), so the
  // stored value reads as the selection it is.
  storage: sessionStorage,
  onInvalid: defaultInvalidWarning("kolu-active-chrome-tab", "hosts"),
});

/** Is the conductor the selected entry? The one predicate every surface
 *  reads — the chrome-bar entry's own highlight, the view that fills the
 *  window, the mobile sheet. */
export const conductorMode = (): boolean => chromeTab() === "conductor";

/** HAS IT EVER BEEN SELECTED in this page's life? The pane is mounted on the
 *  first visit and then RETAINED (`App.tsx`), so this latch — never false
 *  again once true — is what decides whether it exists at all, while
 *  `conductorMode` decides whether it is shown. A browser that never opens
 *  the conversation therefore pays nothing for it: no transcript stream, no
 *  composer, no header.
 *
 *  Latched where the selection is WRITTEN, not derived from an effect that
 *  watches it: there is exactly one writer of the tab (this module), so the
 *  latch cannot fall behind the fact it is about. The initial read covers a
 *  reload that lands back on the conversation. */
const [everSelected, setEverSelected] = createSignal(
  chromeTab() === "conductor",
);
export const conductorEverSelected = everSelected;

export function enterConductorMode(): void {
  setEverSelected(true);
  setChromeTab("conductor");
}

/** Back to the host tabs — selecting a host tab, `Esc`, and the second press of
 *  `⌘⇧O`. `activeHost` was never touched, so this lands on the tab the user
 *  left. */
export function exitConductorMode(): void {
  setChromeTab("hosts");
}

export function toggleConductorMode(): void {
  setChromeTab((tab) => {
    const next = tab === "conductor" ? "hosts" : "conductor";
    if (next === "conductor") setEverSelected(true);
    return next;
  });
}

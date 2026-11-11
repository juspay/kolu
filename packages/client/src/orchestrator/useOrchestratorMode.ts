/** WHICH ENTRY IN THE CHROME BAR IS SELECTED — a host tab, or the orchestrator.
 *
 *  The orchestrator sits in the same row as the host tabs and is NOT one of
 *  them: it has no host key, no entry in the host map, no padi/kaval status and
 *  nothing in the host switcher's data model. So the selection is spelled as
 *  its own value — `"orchestrator"` or `"hosts"` — riding the same
 *  `persistedPref` mechanism, in the same storage, as the active host tab
 *  (`activeHost`, `wire.ts`). A fake host key would have put the conversation
 *  into the host map through the back door; a second storage would have let the
 *  two halves of one selection disagree after a reload.
 *
 *  WHICH host tab is selected stays in `activeHost` while the orchestrator is
 *  on screen, untouched — which is what makes `⌘⇧O` a round trip: leaving the
 *  orchestrator lands back on exactly the tab you came from, with no memory of
 *  it kept anywhere else. */

import { defaultInvalidWarning, persistedPref } from "../persistedPref";

/** The row's two kinds of destination. `"hosts"` means "whichever host tab
 *  `activeHost` names" — the row has many host tabs and exactly one
 *  orchestrator, so the host half needs no value of its own here. */
type ChromeTab = "orchestrator" | "hosts";

const [chromeTab, setChromeTab] = persistedPref<ChromeTab>({
  name: "kolu-active-chrome-tab",
  fallback: "hosts",
  parse: (raw) => {
    if (raw === "orchestrator" || raw === "hosts") return raw;
    throw new Error(`unknown chrome tab "${raw}"`);
  },
  // Strings store verbatim (`persistedPref`'s default serializer), so the
  // stored value reads as the selection it is.
  storage: sessionStorage,
  onInvalid: defaultInvalidWarning("kolu-active-chrome-tab", "hosts"),
});

/** Is the orchestrator the selected entry? The one predicate every surface
 *  reads — the chrome-bar entry's own highlight, the view that fills the
 *  window, the mobile sheet. */
export const orchestratorMode = (): boolean => chromeTab() === "orchestrator";

export function enterOrchestratorMode(): void {
  setChromeTab("orchestrator");
}

/** Back to the host tabs — selecting a host tab, `Esc`, and the second press of
 *  `⌘⇧O`. `activeHost` was never touched, so this lands on the tab the user
 *  left. */
export function exitOrchestratorMode(): void {
  setChromeTab("hosts");
}

export function toggleOrchestratorMode(): void {
  setChromeTab((tab) => (tab === "orchestrator" ? "hosts" : "orchestrator"));
}

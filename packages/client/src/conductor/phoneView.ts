/** WHAT A PHONE SHOWS OF THE CONDUCTOR — the works or the chat, one at a
 *  time, chosen by the tab bar under them.
 *
 *  Per BROWSER TAB, in `sessionStorage`, like the chrome tab beside it
 *  (`useConductorMode.ts`): a reload stays on the view you were on, and
 *  another tab is not moved by this one. A fresh tab starts on the chat,
 *  where you talk to the Conductor; the Work tab's badge says when a work
 *  needs you.
 *
 *  Three things switch it besides the tab bar: the status line's count opens
 *  the works, a work chip pressed in the chat opens the works at that work
 *  (`showWork`), and **About this work** comes back to the chat it filtered
 *  (`aboutWork`). A desktop shows both at once and never reads this. */

import { defaultInvalidWarning, persistedPref } from "../persistedPref";

export type PhoneView = "work" | "chat";

/** Read a stored view, refusing anything that is not one. */
export function parsePhoneView(raw: string): PhoneView {
  if (raw === "work" || raw === "chat") return raw;
  throw new Error(`unknown phone view "${raw}"`);
}

const [phoneView, setPhoneView] = persistedPref<PhoneView>({
  name: "kolu-conductor-phone-view",
  fallback: "chat",
  parse: parsePhoneView,
  storage: sessionStorage,
  onInvalid: defaultInvalidWarning("kolu-conductor-phone-view", "chat"),
});

export { phoneView, setPhoneView };

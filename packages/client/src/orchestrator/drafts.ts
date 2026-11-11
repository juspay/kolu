/** What a person has typed and not yet sent — the composer's box, and every
 *  open question's half-filled form.
 *
 *  Module-level, deliberately: the panel is mounted only while orchestrator mode
 *  is on, and a draft that died when you glanced at the canvas would be the
 *  single most annoying thing in this feature. The panel's own copy survives a
 *  mode flip, a host switch, and a scroll — it does not survive a reload, which
 *  is the honest boundary for text the server was never told about. */

import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { armedMentionText } from "./mentions";

const [composerText, setComposerText] = createSignal("");

export { composerText, setComposerText };

/** Is a completion menu (`@` terminals, `/` commands) open?
 *
 *  Published here rather than kept inside the composer because TWO components
 *  decide one thing with it: the composer closes its menu on `Escape`, and the
 *  pane leaves the mode on `Escape` — and exactly one of those may happen per
 *  press. The pane's listener runs in the CAPTURE phase (it has to: with focus
 *  in a terminal, xterm claims `Escape` and it never bubbles to the window),
 *  so a bubble-phase `stopPropagation` in the composer cannot reach it. A fact
 *  both can read settles the order without either listening for the other.
 */
const [completionOpen, setCompletionOpen] = createSignal(false);

export { completionOpen, setCompletionOpen };

/** Drop a terminal's `@name` into the box — the tile action's landing. The
 *  words already there are kept: arming is an addition to what you were saying,
 *  never a replacement for it. */
export function armComposerMention(name: string): void {
  setComposerText((text) => armedMentionText(text, name));
}

/** One ask's half-filled form: field key → the values picked or typed so far.
 *  Keyed by ask id because two questions can be open at once, and answering the
 *  second must not disturb the first. */
const [askDrafts, setAskDrafts] = createStore<
  Record<string, Record<string, readonly string[]>>
>({});

export function askDraft(askId: string, field: string): readonly string[] {
  return askDrafts[askId]?.[field] ?? [];
}

export function setAskDraft(
  askId: string,
  field: string,
  values: readonly string[],
): void {
  setAskDrafts(
    produce((drafts) => {
      const form = drafts[askId] ?? {};
      form[field] = values;
      drafts[askId] = form;
    }),
  );
}

/** The question stopped waiting — its draft is no longer anybody's unsent text.
 *  Deleting the key rather than blanking it keeps a long session's store from
 *  growing one empty form per question asked. */
export function forgetAskDraft(askId: string): void {
  setAskDrafts(
    produce((drafts) => {
      delete drafts[askId];
    }),
  );
}

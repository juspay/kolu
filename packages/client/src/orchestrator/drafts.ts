/** What a person has typed and not yet sent — the composer's box, and every
 *  open question's half-filled form.
 *
 *  Module-level, deliberately: the panel is mounted only while orchestrator mode
 *  is on, and a draft that died when you glanced at the canvas would be the
 *  single most annoying thing in this feature. The panel's own copy survives a
 *  mode flip, a host switch, and a scroll — it does not survive a reload, which
 *  is the honest boundary for text the server was never told about. */

import type { OrchestratorAttachment } from "@kolu/padi-client/orchestrator";
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { armedMentionText } from "./mentions";

const [composerText, setComposerText] = createSignal("");

export { composerText, setComposerText };

/** What a person has attached and not yet sent — pasted images, dropped files.
 *
 *  Beside the text and for the same reason: the attachment outlives a glance at
 *  the canvas. It does NOT outlive a reload, which is the honest boundary — the
 *  bytes are in this signal and nowhere else until the prompt carries them. */
const [composerAttachments, setComposerAttachments] = createSignal<
  readonly OrchestratorAttachment[]
>([]);

export { composerAttachments };

/** Append one read attachment. The order is the order they arrived, so a chip
 *  row reads the way the person built it. */
export function addComposerAttachment(
  attachment: OrchestratorAttachment,
): void {
  setComposerAttachments((prev) => [...prev, attachment]);
}

/** Drop one by id — the chip's ×. */
export function dropComposerAttachment(id: string): void {
  setComposerAttachments((prev) => prev.filter((one) => one.id !== id));
}

/** The message went: the attachments went with it. */
export function clearComposerAttachments(): void {
  setComposerAttachments([]);
}

/** What the draft weighs — the number the per-message cap is measured against,
 *  read fresh before each admission so two pastes in a row cannot both be
 *  judged against an empty draft. */
export function composerAttachmentBytes(): number {
  return composerAttachments().reduce((sum, one) => sum + one.bytes, 0);
}

/** Is a completion menu (`@` terminals, `/` commands) open?
 *
 *  Published here rather than kept inside the composer because TWO components
 *  decide one thing with it: the composer closes its menu on `Escape`, and the
 *  pane leaves the mode on `Escape` — and exactly one of those may happen per
 *  press. The pane watches for the key in the CAPTURE phase wherever it would
 *  otherwise be eaten (inside a terminal, xterm claims `Escape` for the program
 *  in the PTY and it never bubbles), so a bubble-phase `stopPropagation` in the
 *  composer cannot reach it. A fact both can read settles the order without
 *  either listening for the other.
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

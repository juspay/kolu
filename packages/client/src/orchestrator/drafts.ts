/** What a person has typed and not yet sent — the composer's box, and every
 *  open question's half-filled form.
 *
 *  Module-level, deliberately: the panel is mounted only while orchestrator mode
 *  is on, and a draft that died when you glanced at the canvas would be the
 *  single most annoying thing in this feature. The panel's own copy survives a
 *  mode flip, a host switch, and a scroll — it does not survive a reload, which
 *  is the honest boundary for text the server was never told about. */

import type { OrchestratorAttachment } from "kolu-common/orchestrator";
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { armedMentionText } from "./mentions";
import { forgetThumbnail } from "./thumbnails";

const [composerText, setComposerText] = createSignal("");

export { composerText, setComposerText };

/** One file in the draft: what the wire will take, the bytes this browser is
 *  still holding, and the one fact only this side knows.
 *
 *  `path` is `null` while the bytes are still GOING UP. One field rather than a
 *  second status flag, because they are the same fact: a chip with no path has
 *  no file behind it yet, and a chip that looks ready with nothing behind it is
 *  the worst lie this composer could tell.
 *
 *  `file` is kept until the message is ACCEPTED, because kolu-server deletes what a
 *  REFUSED prompt named — it leaves no file the transcript does not name. The
 *  chips stay on screen after a refusal, so their bytes have to be puttable
 *  back; the `File` is a handle the browser already holds, not a second copy.
 *  It is also why this type is not the wire's: `sendableAttachments` names the
 *  five fields a prompt carries rather than spreading this one. */
export interface ComposerAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly path: string | null;
  readonly file: File;
}

/** What a person has attached and not yet sent — pasted images, dropped files.
 *
 *  Beside the text and for the same reason: the attachment outlives a glance at
 *  the canvas. It does NOT outlive a reload, which is the honest boundary — the
 *  chip is in this signal and nowhere else, and kolu-server's copy of the bytes is
 *  swept when nothing ever named them. */
const [composerAttachments, setComposerAttachments] = createSignal<
  readonly ComposerAttachment[]
>([]);

export { composerAttachments };

/** Append one attachment, still on its way up. The order is the order they
 *  arrived, so a chip row reads the way the person built it. */
export function addComposerAttachment(attachment: ComposerAttachment): void {
  setComposerAttachments((prev) => [...prev, attachment]);
}

/** The bytes landed: the chip stops saying it is uploading and starts carrying
 *  the path a prompt will name — with PADI's count of what it wrote, never the
 *  browser's claim about what it sent. */
export function settleComposerAttachment(
  id: string,
  written: { readonly path: string; readonly bytes: number },
): void {
  setComposerAttachments((prev) =>
    prev.map((one) =>
      one.id === id
        ? { ...one, path: written.path, bytes: written.bytes }
        : one,
    ),
  );
}

/** Drop one by id — the chip's ×, and the landing of an upload that failed.
 *  The thumbnail goes with it: no row will ever draw a file that never
 *  reached the host. */
export function dropComposerAttachment(id: string): void {
  setComposerAttachments((prev) => prev.filter((one) => one.id !== id));
  forgetThumbnail(id);
}

/** The message went: the attachments went with it. The thumbnails STAY — the
 *  transcript row this browser just minted is what draws them now. */
export function clearComposerAttachments(): void {
  setComposerAttachments([]);
}

/** What the draft weighs — the number the per-message cap is measured against,
 *  read fresh before each admission so two pastes in a row cannot both be
 *  judged against an empty draft. */
export function composerAttachmentBytes(): number {
  return composerAttachments().reduce((sum, one) => sum + one.bytes, 0);
}

/** The draft's attachments as the PROMPT takes them, or `null` while one is
 *  still going up.
 *
 *  Null rather than "the ones that are ready": a message that quietly left out
 *  the screenshot it was about is worse than a message that waits a second.
 *  The composer turns the null into a sentence.
 *
 *  The five fields are named rather than spread: the draft row also carries
 *  the `File` this browser is holding, and a `File` on a prompt frame is not
 *  something the wire contract has anywhere to put. */
export function sendableAttachments():
  | readonly OrchestratorAttachment[]
  | null {
  const rows = composerAttachments();
  const ready = rows.flatMap((one) =>
    one.path === null
      ? []
      : [
          {
            id: one.id,
            name: one.name,
            mimeType: one.mimeType,
            bytes: one.bytes,
            path: one.path,
          },
        ],
  );
  return ready.length === rows.length ? ready : null;
}

/** THE HOST NO LONGER HAS THESE. A refused prompt deletes every file it
 *  named — kolu-server leaves no attachment the transcript does not name — so the
 *  paths the chips were carrying are now paths to nothing. Saying so is what
 *  keeps the chip honest while its bytes go back up; a chip left holding a
 *  deleted path would make the next Send refuse with "no longer on this
 *  host", and that one the person cannot do anything about. */
export function unsettleComposerAttachments(): void {
  setComposerAttachments((prev) =>
    prev.map((one) => (one.path === null ? one : { ...one, path: null })),
  );
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

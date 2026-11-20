import type { ConductorAttachment } from "kolu-common/conductor";
import { createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { armedMentionText } from "./mentions";
import { forgetThumbnail } from "./thumbnails";

const [composerText, setComposerText] = createSignal("");

export { composerText, setComposerText };

export interface ComposerAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: number;
  readonly path: string | null;
  readonly file: File;
}

const [composerAttachments, setComposerAttachments] = createSignal<
  readonly ComposerAttachment[]
>([]);

export { composerAttachments };

export function addComposerAttachment(attachment: ComposerAttachment): void {
  setComposerAttachments((prev) => [...prev, attachment]);
}

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

export function dropComposerAttachment(id: string): void {
  setComposerAttachments((prev) => prev.filter((one) => one.id !== id));
  forgetThumbnail(id);
}

export function clearComposerAttachments(): void {
  setComposerAttachments([]);
}

export function composerAttachmentBytes(): number {
  return composerAttachments().reduce((sum, one) => sum + one.bytes, 0);
}

type SettledAttachment = ComposerAttachment & { readonly path: string };

function allSettledOrNull(
  rows: readonly ComposerAttachment[],
): readonly SettledAttachment[] | null {
  const settled = rows.filter(
    (one): one is SettledAttachment => one.path !== null,
  );
  return settled.length === rows.length ? settled : null;
}

export function sendableAttachments(): readonly ConductorAttachment[] | null {
  const settled = allSettledOrNull(composerAttachments());
  if (settled === null) return null;
  return settled.map((one) => ({
    id: one.id,
    name: one.name,
    mimeType: one.mimeType,
    bytes: one.bytes,
    path: one.path,
  }));
}

export function unsettleComposerAttachments(): void {
  setComposerAttachments((prev) =>
    prev.map((one) => (one.path === null ? one : { ...one, path: null })),
  );
}

const [completionOpen, setCompletionOpen] = createSignal(false);

export { completionOpen, setCompletionOpen };

export function armComposerMention(name: string): void {
  setComposerText((text) => armedMentionText(text, name));
}

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

export function forgetAskDraft(askId: string): void {
  setAskDrafts(
    produce((drafts) => {
      delete drafts[askId];
    }),
  );
}

export function dropAskFields(
  askId: string,
  fields: ReadonlyArray<string>,
): void {
  setAskDrafts(
    produce((drafts) => {
      const form = drafts[askId];
      if (form === undefined) return;
      for (const field of fields) delete form[field];
      if (Object.keys(form).length === 0) delete drafts[askId];
    }),
  );
}

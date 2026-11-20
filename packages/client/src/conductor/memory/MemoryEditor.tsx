/** THE MEMORY EDITOR — a title, what it is about, and the memory itself in
 *  Markdown with its preview. `Add`, an entry's `Edit` and a proposal's
 *  `Edit…` all open it; saving a proposal remembers what you wrote. Mounted
 *  once; {@link editMemory} says what it edits. */

import Dialog from "@corvu/dialog";
import {
  MEMORY_BODY_CAP,
  type MemoryEntry,
  type MemoryText,
} from "kolu-common/conductorMemory";
import { type Component, createEffect, createSignal, on, Show } from "solid-js";
import MarkdownField from "../../ui/MarkdownField";
import ModalDialog from "../../ui/ModalDialog";
import { surface } from "../../ui/Surface";
import { useMemory } from "./useMemory";

export type MemoryEditing =
  | { readonly kind: "add" }
  | { readonly kind: "entry"; readonly entry: MemoryEntry }
  | {
      readonly kind: "proposal";
      readonly proposal: string;
      readonly text: MemoryText;
    };

const [editing, setEditing] = createSignal<MemoryEditing | null>(null);

/** Open the editor on this. */
export const editMemory = (what: MemoryEditing): void => {
  setEditing(what);
};

const HEADINGS: Record<MemoryEditing["kind"], string> = {
  add: "Add a memory",
  entry: "Edit memory",
  proposal: "Edit, then remember",
};

const textOf = (what: MemoryEditing): MemoryText =>
  what.kind === "add"
    ? { title: "", about: null, body: "" }
    : what.kind === "entry"
      ? what.entry
      : what.text;

const fieldClass =
  "w-full rounded-md border border-edge bg-surface-0 px-3 py-1.5 text-[0.8rem] text-fg outline-none focus:border-accent/70 focus:ring-2 focus:ring-accent/25";

const labelClass =
  "mb-1 block font-mono text-[0.6rem] uppercase tracking-[0.1em] text-fg-3";

const MemoryEditor: Component = () => {
  const memory = useMemory();
  const [title, setTitle] = createSignal("");
  const [about, setAbout] = createSignal("");
  const [body, setBody] = createSignal("");
  const [refusal, setRefusal] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [titleRef, setTitleRef] = createSignal<HTMLInputElement>();

  createEffect(
    on(editing, (what) => {
      if (what === null) return;
      const text = textOf(what);
      setTitle(text.title);
      setAbout(text.about ?? "");
      setBody(text.body);
      setRefusal(null);
    }),
  );

  const close = (): void => {
    setEditing(null);
  };

  const save = (): void => {
    const what = editing();
    if (what === null || saving()) return;
    const text: MemoryText = { title: title(), about: about(), body: body() };
    setSaving(true);
    const answered =
      what.kind === "proposal"
        ? memory.approve(what.proposal, text)
        : memory.save(text, what.kind === "entry" ? what.entry.id : null);
    void answered.then((refused) => {
      setSaving(false);
      if (refused === null) close();
      else setRefusal(refused);
    });
  };

  const chrome = surface({ radius: "xl", portalled: true });

  return (
    <ModalDialog
      open={editing() !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      initialFocusEl={titleRef()}
    >
      <Dialog.Content
        data-kolu-modal="true"
        data-testid="memory-editor"
        class={`${chrome.class} p-4 text-sm w-[min(560px,calc(100vw-2rem))]`}
        style={chrome.style}
      >
        <Dialog.Label class="mb-3 block text-sm font-semibold text-fg">
          {HEADINGS[editing()?.kind ?? "add"]}
        </Dialog.Label>
        <label class="mb-3 block">
          <span class={labelClass}>Title</span>
          <input
            ref={setTitleRef}
            data-testid="memory-editor-title"
            class={fieldClass}
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
          />
        </label>
        <label class="mb-3 block">
          <span class={labelClass}>About · optional: a repository, a host</span>
          <input
            data-testid="memory-editor-about"
            class={fieldClass}
            value={about()}
            onInput={(e) => setAbout(e.currentTarget.value)}
          />
        </label>
        <span class={labelClass}>What to remember</span>
        <MarkdownField
          value={body()}
          onInput={setBody}
          onSubmit={save}
          label="What to remember"
          placeholder="One thing worth keeping, in a sentence or two."
          textareaTestId="memory-editor-body"
          previewTestId="memory-editor-preview"
        />
        <Show when={refusal()}>
          {(why) => (
            <p
              data-testid="memory-editor-refusal"
              class="mt-2 rounded-md border border-danger/50 bg-danger/10 px-3 py-1.5 text-xs text-danger"
            >
              {why()}
            </p>
          )}
        </Show>
        <div class="mt-3 flex items-center justify-between gap-2">
          <span
            class="font-mono text-[0.65rem] text-fg-3"
            classList={{ "text-danger": body().length > MEMORY_BODY_CAP }}
          >
            {body().length.toLocaleString("en")} of{" "}
            {MEMORY_BODY_CAP.toLocaleString("en")} characters
          </span>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-xs text-fg-3 hover:text-fg hover:bg-surface-2"
              onClick={close}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="memory-editor-save"
              class="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-surface-1 disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={saving()}
              onClick={save}
            >
              {editing()?.kind === "proposal" ? "Remember" : "Save"}
            </button>
          </div>
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default MemoryEditor;

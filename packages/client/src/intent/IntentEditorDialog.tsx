/** Modal editor for terminal intent — Kolu's single picker for the
 *  free-form annotation attached to each terminal.
 *
 *  Layout: textarea (write) above a markdown preview, with a curated
 *  emoji quick-row that inserts at the textarea cursor. Save commits;
 *  Clear nukes the whole intent; Esc cancels. Mirrors `SettingsPopover`'s
 *  modal-dialog scaffold via `<ModalDialog>` (Corvu under the hood). */

import { runAction, type UiAction } from "../runAction";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import Dialog from "@corvu-next/dialog"
import {
  type Component,
  createEffect,
  createSignal,
  For,
  on,
  Show,
} from "solid-js";
import { toast } from "solid-sonner";
import { writeTextToClipboard } from "@kolu/solid-logtail";
import { CloseIcon, CopyIcon } from "../ui/Icons";
import MarkdownField from "../ui/MarkdownField";
import ModalDialog from "../ui/ModalDialog";
import { surface } from "../ui/Surface";

/** Curated emoji quick-row. Pairs glyph with a short label that
 *  doubles as the title-tooltip and as the search target for fuzzy
 *  intent (`type "rocket" + click` lands the user on 🚀). Keep short;
 *  free-form input handles the long tail. */
const QUICK_ROW: readonly { emoji: string; label: string }[] = [
  { emoji: "🏠", label: "home" },
  { emoji: "🧪", label: "experiment" },
  { emoji: "🐛", label: "bug" },
  { emoji: "⚡", label: "fast" },
  { emoji: "🔥", label: "hot" },
  { emoji: "🚀", label: "rocket" },
  { emoji: "🎯", label: "focus" },
  { emoji: "📦", label: "package" },
  { emoji: "🔧", label: "wrench" },
  { emoji: "✨", label: "sparkle" },
  { emoji: "🧠", label: "brain" },
  { emoji: "🌱", label: "seedling" },
];

const IntentEditorDialog: Component<{
  open: boolean;
  title: string;
  value: string;
  allowClear?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (intent: string) => void;
  onClear?: () => void;
}> = (props) => {
  const [textareaRef, setTextareaRef] = createSignal<HTMLTextAreaElement>();
  const [draft, setDraft] = createSignal("");
  const trimmed = () => draft().trim();
  const canSave = () => trimmed().length > 0;

  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        setDraft(props.value);
      },
    ),
  );

  /** Insert `text` at the textarea's current cursor position; if there's
   *  a selection, replace it. Preserves the rest of the value and moves
   *  the cursor to just after the inserted text. */
  function insertAtCursor(text: string) {
    const el = textareaRef();
    if (!el) {
      setDraft((d) => d + text);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const next = `${before}${text}${after}`;
    setDraft(next);
    // Restore focus + position cursor after the inserted text on next tick.
    queueMicrotask(() => {
      el.focus();
      const cursor = start + text.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  function save() {
    const next = trimmed();
    if (!next) {
      toast.error("Intent is required");
      return;
    }
    props.onSave(next);
    props.onOpenChange(false);
  }

  function clear() {
    props.onClear?.();
    props.onOpenChange(false);
  }

  function copy(): UiAction {
    return Effect.suspend(() => {
      const value = trimmed();
      if (!value) return Effect.void;
      return writeTextToClipboard(value).pipe(
        Effect.tap(() =>
          Effect.sync(() => toast.success("Copied intent to clipboard")),
        ),
        Effect.catch((err) =>
          Effect.sync(() => {
            console.error("Failed to copy intent:", err);
            toast.error(`Failed to copy intent: ${toError(err).message}`);
          }),
        ),
      );
    });
  }

  const chrome = surface({ radius: "xl", portalled: true });

  return (
    <ModalDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      initialFocusEl={textareaRef()}
    >
      <Dialog.Content
        data-kolu-modal="true"
        class={`${chrome.class} p-4 text-sm w-[min(560px,calc(100vw-2rem))]`}
        style={chrome.style}
      >
        <div class="mb-3">
          <Dialog.Label class="block text-sm font-semibold text-fg">
            {props.title}
          </Dialog.Label>
        </div>
        <div
          class="mb-2 flex flex-wrap items-center gap-1"
          data-testid="intent-editor-quickrow"
        >
          <For each={QUICK_ROW}>
            {({ emoji, label }) => (
              <button
                type="button"
                data-testid="intent-editor-quick"
                data-glyph={emoji}
                title={`Insert ${emoji} (${label})`}
                aria-label={`Insert ${label} emoji`}
                class="flex items-center justify-center w-7 h-7 rounded-md text-base leading-none cursor-pointer bg-surface-0 border border-edge hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                onClick={() => insertAtCursor(emoji)}
              >
                {emoji}
              </button>
            )}
          </For>
        </div>
        <MarkdownField
          ref={setTextareaRef}
          value={draft()}
          onInput={setDraft}
          onSubmit={save}
          placeholder={"🏠 main\n\nWhat are you doing in this terminal?"}
          textareaTestId="intent-editor-textarea"
          previewTestId="intent-editor-preview"
        />
        <div class="mt-3 flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <button
              type="button"
              data-testid="intent-editor-copy"
              class="inline-flex items-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 text-xs text-fg-2 hover:text-fg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!trimmed()}
              onClick={() => runAction("copy intent", copy())}
            >
              <CopyIcon class="h-3 w-3" />
              <span>Copy</span>
            </button>
            <Show when={props.allowClear}>
              <button
                type="button"
                data-testid="intent-editor-clear"
                class="inline-flex items-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 text-xs text-fg-3 hover:text-danger hover:bg-surface-2"
                onClick={clear}
              >
                <CloseIcon class="h-3 w-3" />
                <span>Clear</span>
              </button>
            </Show>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="rounded-md px-3 py-1.5 text-xs text-fg-3 hover:text-fg hover:bg-surface-2"
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="intent-editor-save"
              class="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-surface-1 disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!canSave()}
              onClick={save}
            >
              Save
            </button>
          </div>
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default IntentEditorDialog;

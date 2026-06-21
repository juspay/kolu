/** Notes tab — the right-panel home for a terminal's freeform markdown
 *  notes (the field formerly edited through a modal). Two sub-views, an
 *  Edit/Preview switcher mirroring the Code tab's scope switcher:
 *
 *    - **Edit**    — a plain `<textarea>` over a curated emoji quick-row.
 *                    Autosaves as you type (debounced) — no Save button.
 *    - **Preview** — the same markdown rendered through `@kolu/solid-markdown`.
 *
 *  The draft is local component state seeded from `meta.notes` whenever the
 *  *active terminal* changes — never bound live to `meta.notes`, because a
 *  reactive `value={meta.notes}` would clobber the user's keystrokes each time
 *  the autosave round-trips back through the metadata stream. Writes flow OUT
 *  via the debounced `setNotes` RPC; the server's own 500ms autosave then
 *  lands them on disk. Pending edits are flushed on terminal switch, on blur,
 *  and on unmount so a quick "type then navigate away" never drops the tail. */

import { debounce } from "@solid-primitives/scheduled";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { NOTES_TAB_VIEW_ORDER, notesViewLabel } from "kolu-common/surface";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { toast } from "solid-sonner";
import { useRightPanel } from "../right-panel/useRightPanel";
import SegmentedControl from "../ui/SegmentedControl";
import { client } from "../wire";
import { NotesMarkdownBlock } from "./NotesMarkdown";

/** Debounce window between the last keystroke and the `setNotes` RPC. Long
 *  enough that a burst of typing collapses to one write, short enough that
 *  the annotation slot / dock chip refresh feels immediate. */
const SAVE_DEBOUNCE_MS = 400;

/** Curated emoji quick-row. Pairs a glyph with a short label that doubles as
 *  the title-tooltip. Prefixing a note with an emoji is how its dock-rail chip
 *  glyph is chosen (`notesLeadGlyph`), so the row stays a first-class entry aid
 *  even with a plain textarea. */
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

const NOTES_MODE_OPTIONS = NOTES_TAB_VIEW_ORDER.map((value) => ({
  value,
  label: notesViewLabel(value),
}));

const NotesTab: Component<{
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
  /** Whether the right panel hosting this tab is visible. Gates the
   *  focus-on-activate effect so it never steals focus into a collapsed panel. */
  visible: boolean;
}> = (props) => {
  const rightPanel = useRightPanel();
  const mode = () => rightPanel.notesMode();

  const [textareaRef, setTextareaRef] = createSignal<HTMLTextAreaElement>();
  const [draft, setDraft] = createSignal("");
  // The value last sent to the server for the *current* terminal — a signal so
  // the autosave indicator and the dirty check below stay reactive.
  const [savedValue, setSavedValue] = createSignal("");
  const dirty = () => draft() !== savedValue();

  const persist = (id: TerminalId, text: string) => {
    setSavedValue(text);
    void client.terminal
      .setNotes({ id, notes: text })
      .catch((err: Error) =>
        toast.error(`Failed to save notes: ${err.message}`),
      );
  };

  const scheduleSave = debounce(
    (id: TerminalId, text: string) => persist(id, text),
    SAVE_DEBOUNCE_MS,
  );

  /** Cancel any pending debounced write and persist the current draft right
   *  now if it diverged — used on terminal switch, blur, and unmount. */
  const flush = (id: TerminalId | null) => {
    scheduleSave.clear();
    if (id !== null && dirty()) persist(id, draft());
  };

  // Seed the draft when the active terminal changes — and ONLY then. Binding
  // the textarea reactively to `meta.notes` would overwrite live keystrokes
  // each time the autosave echoes back through the metadata stream. The
  // outgoing terminal's pending edit is flushed before we re-seed.
  createEffect(
    on(
      () => props.terminalId,
      (_id, prevId) => {
        if (prevId) flush(prevId);
        const seed = props.meta?.notes ?? "";
        setSavedValue(seed);
        setDraft(seed);
      },
    ),
  );

  onCleanup(() => flush(props.terminalId));

  const onInput = (text: string) => {
    setDraft(text);
    const id = props.terminalId;
    if (id !== null) scheduleSave(id, text);
  };

  /** Insert `text` at the textarea's cursor (replacing any selection), then
   *  restore focus and place the cursor after it. Falls back to an append when
   *  the textarea isn't mounted (Preview mode). */
  const insertAtCursor = (text: string) => {
    const el = textareaRef();
    if (!el) {
      onInput(draft() + text);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = `${el.value.slice(0, start)}${text}${el.value.slice(end)}`;
    onInput(next);
    queueMicrotask(() => {
      el.focus();
      const cursor = start + text.length;
      el.setSelectionRange(cursor, cursor);
    });
  };

  // Focus the textarea whenever the Notes tab becomes the active, visible tab
  // in Edit mode — so navigating in via the chip, the command, the title-bar
  // icon, or the tab button lands the cursor ready to type.
  const editReady = createMemo(
    () =>
      props.visible &&
      rightPanel.activeTab().kind === "notes" &&
      mode() === "edit",
  );
  createEffect(
    on(editReady, (ready) => {
      if (ready) queueMicrotask(() => textareaRef()?.focus());
    }),
  );

  return (
    <div
      class="flex flex-col h-full min-h-0 bg-surface-0"
      data-testid="notes-tab"
    >
      {/* Edit / Preview switcher */}
      <div class="flex items-center gap-2 px-2 h-8 shrink-0 border-b border-edge">
        <SegmentedControl
          options={NOTES_MODE_OPTIONS}
          value={mode()}
          onChange={rightPanel.setNotesMode}
          testIdPrefix="notes-mode"
        />
      </div>

      <Show
        when={mode() === "edit"}
        fallback={
          <div
            class="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-sm"
            data-testid="notes-preview"
          >
            <Show
              when={draft().trim()}
              fallback={
                <p class="text-fg-3/60 text-xs italic">
                  Nothing to preview yet.
                </p>
              }
            >
              <NotesMarkdownBlock markdown={draft()} />
            </Show>
          </div>
        }
      >
        <div class="flex-1 min-h-0 flex flex-col px-2 py-2 gap-2">
          <div
            class="flex flex-wrap items-center gap-1"
            data-testid="notes-editor-quickrow"
          >
            <For each={QUICK_ROW}>
              {({ emoji, label }) => (
                <button
                  type="button"
                  data-testid="notes-editor-quick"
                  data-glyph={emoji}
                  title={`Insert ${emoji} (${label})`}
                  aria-label={`Insert ${label} emoji`}
                  class="flex items-center justify-center w-7 h-7 rounded-md text-base leading-none cursor-pointer bg-surface-1 border border-edge hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  onClick={() => insertAtCursor(emoji)}
                >
                  {emoji}
                </button>
              )}
            </For>
          </div>
          <textarea
            ref={setTextareaRef}
            data-testid="notes-editor-textarea"
            value={draft()}
            onInput={(e) => onInput(e.currentTarget.value)}
            onBlur={() => flush(props.terminalId)}
            class="flex-1 min-h-0 w-full resize-none rounded-md border border-edge bg-surface-1 px-3 py-2 font-mono text-[0.78rem] leading-relaxed text-fg outline-none placeholder:text-fg-3/60 focus:border-accent/70 focus:ring-2 focus:ring-accent/25"
            placeholder={"🏠 main\n\nWhat are you doing in this terminal?"}
            spellcheck={false}
          />
        </div>
      </Show>

      {/* Autosave status footer */}
      <div class="flex items-center gap-1.5 px-3 h-7 shrink-0 border-t border-edge text-[0.66rem] text-fg-3">
        <span
          class="inline-block w-1.5 h-1.5 rounded-full"
          classList={{ "bg-busy": dirty(), "bg-ok": !dirty() }}
        />
        <span data-testid="notes-save-status">
          {dirty() ? "Saving…" : "Autosaved · debounced"}
        </span>
      </div>
    </div>
  );
};

export default NotesTab;

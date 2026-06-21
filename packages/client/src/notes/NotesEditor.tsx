/** Inline editor for a terminal's notes — the editing surface that lives
 *  in the right-panel Notes tab.
 *
 *  A plain `<textarea>` (Edit) beside a rendered-markdown preview (Preview),
 *  with a curated emoji quick-row that inserts at the cursor. Saving is
 *  debounced autosave — there is no Save button; each pause flushes a
 *  `setNotes` RPC, and the server's 500 ms write coalesces to disk.
 *
 *  Reconciliation: the draft is the source of truth while the textarea is
 *  focused. The server echo (`meta.notes` via the metadata subscription)
 *  is folded back into the draft ONLY when the user is not editing and no
 *  save is in flight — a live `value={meta.notes}` would clobber keystrokes
 *  mid-typing, and a stale echo racing the blur-flush would revert the
 *  last edits. See the Terminal Notes Atlas note ("three things that bite"). */

import {
  type Component,
  createEffect,
  createSignal,
  For,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { toast } from "solid-sonner";
import type { TerminalId } from "kolu-common/surface";
import { writeTextToClipboard } from "../ui/clipboard";
import { CloseIcon, CopyIcon } from "../ui/Icons";
import { client } from "../wire";
import { NotesMarkdownBlock } from "./NotesMarkdown";

/** Curated emoji quick-row. Pairs glyph with a short label that doubles
 *  as the title-tooltip and as the search target for fuzzy notes
 *  (`type "rocket" + click` lands the user on 🚀). Keep short; the
 *  free-form textarea handles the long tail. */
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

/** Client-side debounce before flushing a `setNotes` RPC. The server
 *  coalesces its own 500 ms disk write on top of this; the two layers
 *  keep rapid typing off the wire while still persisting promptly. */
const SAVE_DEBOUNCE_MS = 400;

const NotesEditor: Component<{
  terminalId: TerminalId;
  /** The server's current notes value (reactive). Folded into the draft
   *  only when the user is not editing — see the file header. */
  notes: () => string | undefined;
  /** Whether the Notes tab is the currently-shown tab. When it flips
   *  true the textarea is focused so the user can type immediately. */
  active: () => boolean;
}> = (props) => {
  const [draft, setDraft] = createSignal(props.notes() ?? "");
  const [mode, setMode] = createSignal<"edit" | "preview">("edit");
  // `pending` covers BOTH a debounce-armed save (unsaved keystrokes exist)
  // AND any in-flight `setNotes` RPC. It's a counter over RPCs (so a stale
  // echo from an earlier RPC can't slip through while a later one is still
  // in flight — `!pending` must mean *no* save of ours is pending) OR'd
  // with the debounce-armed flag. The reconcile effect gates on it so a
  // server echo never clobbers an unsaved or in-flight draft.
  let inflight = 0;
  let dirty = false;
  const [pending, setPending] = createSignal(false);
  const recomputePending = () => setPending(dirty || inflight > 0);
  // Non-reactive: only the reconcile effect reads it, and making it a
  // signal would re-run that effect on every focus/blur for nothing.
  let editing = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const [getTextarea, setTextarea] = createSignal<HTMLTextAreaElement>();

  // Clear an armed debounce on unmount so the timer can't fire a `setNotes`
  // at an already-closed terminal (and surface a spurious error toast).
  onCleanup(() => {
    if (timer !== undefined) clearTimeout(timer);
  });

  function flush(id: TerminalId, value: string) {
    inflight++;
    recomputePending();
    void client.terminal
      .setNotes({ id, notes: value })
      .catch((err: Error) =>
        toast.error(`Failed to save notes: ${err.message}`),
      )
      .finally(() => {
        inflight--;
        recomputePending();
      });
  }

  function scheduleSave(id: TerminalId, value: string) {
    dirty = true;
    recomputePending();
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      dirty = false;
      flush(id, value);
    }, SAVE_DEBOUNCE_MS);
  }

  /** Cancel any pending debounce and flush immediately to `id`. Used on
   *  blur and on terminal-switch so edits never sit in an unflushed
   *  timer when the user moves focus away. Resets `dirty` — the
   *  debounce's "unsaved keystrokes exist" flag — because the flush
   *  consumes them, or `pending` would stay true forever (and the
   *  reconcile effect would ignore every later echo). */
  function flushNow(id: TerminalId, value: string) {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
      dirty = false;
      flush(id, value);
    }
  }

  // Fold the server echo into the draft only when the user is not editing
  // and no save of ours is in flight (a stale echo racing the blur-flush
  // would otherwise revert the just-typed edits).
  createEffect(
    on(
      () => props.notes(),
      (next) => {
        if (!editing && !pending()) setDraft(next ?? "");
      },
    ),
  );

  // The Notes tab follows the active terminal. On switch, flush any
  // pending edits to the terminal we're leaving, then load the new
  // terminal's notes into the draft.
  createEffect(
    on(
      () => props.terminalId,
      (_id, prevId) => {
        if (prevId !== undefined) flushNow(prevId, draft());
        editing = false;
        setDraft(props.notes() ?? "");
      },
    ),
  );

  // When the Notes tab becomes the shown tab, focus the textarea so an
  // open via the annotation slot / command / icon lands the cursor ready.
  createEffect(
    on(props.active, (active) => {
      if (active) {
        setMode("edit");
        queueMicrotask(() => getTextarea()?.focus());
      }
    }),
  );

  /** Insert `text` at the textarea's current cursor position; if there's
   *  a selection, replace it. Preserves the rest of the value and moves
   *  the cursor to just after the inserted text. */
  function insertAtCursor(text: string) {
    const el = getTextarea();
    if (!el) {
      const next = draft() + text;
      setDraft(next);
      scheduleSave(props.terminalId, next);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const next = `${before}${text}${after}`;
    setDraft(next);
    scheduleSave(props.terminalId, next);
    queueMicrotask(() => {
      el.focus();
      const cursor = start + text.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  async function copy() {
    const value = draft().trim();
    if (!value) return;
    try {
      await writeTextToClipboard(value);
      toast.success("Copied notes to clipboard");
    } catch (err) {
      console.error("Failed to copy notes:", err);
      toast.error(`Failed to copy notes: ${(err as Error).message}`);
    }
  }

  function clear() {
    setDraft("");
    clearTimeout(timer);
    timer = undefined;
    flush(props.terminalId, "");
    getTextarea()?.focus();
  }

  return (
    <div class="flex h-full flex-col min-h-0">
      {/* Toolbar: emoji quick-row + actions. */}
      <div class="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-edge bg-surface-1">
        <For each={QUICK_ROW}>
          {({ emoji, label }) => (
            <button
              type="button"
              data-testid="notes-editor-quick"
              data-glyph={emoji}
              title={`Insert ${emoji} (${label})`}
              aria-label={`Insert ${label} emoji`}
              class="flex items-center justify-center w-6 h-6 rounded-md text-sm leading-none cursor-pointer bg-surface-0 border border-edge hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              onClick={() => insertAtCursor(emoji)}
            >
              {emoji}
            </button>
          )}
        </For>
        <div class="flex-1" />
        <button
          type="button"
          data-testid="notes-editor-copy"
          class="inline-flex items-center justify-center rounded-md border border-edge px-2 py-1 text-fg-2 hover:text-fg hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!draft().trim()}
          onClick={copy}
          title="Copy notes"
        >
          <CopyIcon class="h-3 w-3" />
        </button>
        <button
          type="button"
          data-testid="notes-editor-clear"
          class="inline-flex items-center justify-center rounded-md border border-edge px-2 py-1 text-fg-3 hover:text-danger hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!draft().trim()}
          onClick={clear}
          title="Clear notes"
        >
          <CloseIcon class="h-3 w-3" />
        </button>
      </div>
      {/* Edit / Preview sub-tabs + autosave status. */}
      <div class="flex items-center gap-1 px-2 py-1 border-b border-edge bg-surface-1">
        <button
          type="button"
          data-testid="notes-editor-tab-edit"
          class={`rounded-md px-2.5 py-1 text-[0.7rem] cursor-pointer border ${
            mode() === "edit"
              ? "bg-surface-0 border-edge text-fg"
              : "border-transparent text-fg-3 hover:text-fg-2"
          }`}
          onClick={() => setMode("edit")}
        >
          Edit
        </button>
        <button
          type="button"
          data-testid="notes-editor-tab-preview"
          class={`rounded-md px-2.5 py-1 text-[0.7rem] cursor-pointer border ${
            mode() === "preview"
              ? "bg-surface-0 border-edge text-fg"
              : "border-transparent text-fg-3 hover:text-fg-2"
          }`}
          onClick={() => setMode("preview")}
        >
          Preview
        </button>
        <div class="flex-1" />
        <span
          data-testid="notes-editor-autosave"
          class="text-[0.62rem] text-fg-3"
        >
          {pending() ? "Saving…" : "Saved"}
        </span>
      </div>
      {/* Editor body — textarea (Edit) or rendered markdown (Preview). */}
      <Show
        when={mode() === "edit"}
        fallback={
          <div
            data-testid="notes-editor-preview"
            class="flex-1 min-h-0 overflow-y-auto px-3 py-2 text-[0.78rem] leading-relaxed text-fg-2"
          >
            <Show
              when={draft().trim()}
              fallback={<em class="text-fg-3">Nothing to preview.</em>}
            >
              <NotesMarkdownBlock markdown={draft()} />
            </Show>
          </div>
        }
      >
        <textarea
          ref={setTextarea}
          data-testid="notes-editor-textarea"
          value={draft()}
          onInput={(e) => {
            const v = e.currentTarget.value;
            setDraft(v);
            scheduleSave(props.terminalId, v);
          }}
          onFocus={() => {
            editing = true;
          }}
          onBlur={() => {
            editing = false;
            flushNow(props.terminalId, draft());
          }}
          class="flex-1 min-h-0 w-full resize-none border-0 bg-transparent px-3 py-2 font-mono text-[0.78rem] leading-relaxed text-fg outline-none placeholder:text-fg-3/60 focus:ring-0"
          placeholder={"🏠 main\n\nWhat are you doing in this terminal?"}
          spellcheck={false}
        />
      </Show>
    </div>
  );
};

export default NotesEditor;

/**
 * Single-page demo of all four `@kolu/cells` primitives — wired via the
 * surface client bundle.
 *
 *   - `app.cells.prefs.use(...)`           → editor preferences (font, theme)
 *   - `app.collections.notes.use(...)`     → notes sidebar
 *   - `app.streams.search.use(...)`        → live search in the sidebar
 *   - `app.events.autosave.use(...)`       → "Saved" flash next to the title
 *
 * The bound `.use()` hooks pre-fill `source` / `mutate` / `valueSource` /
 * `keyToInput` — only domain policy (authority, initial value, applyPatch,
 * onError) lives at the call site. Imperative procedures stay accessible
 * via `app.rpc.<ns>.<verb>(...)`.
 */

import { createSubscription, streamCall } from "@kolu/cells/solid";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  For,
  Show,
} from "solid-js";
import { DEFAULT_PREFS, type Note, type NoteId } from "../common/schemas";
import { app } from "./wire";

export default function App() {
  // ── 1. Cell: editor preferences ─────────────────────────────────────
  // applyPatch comes from `surface.cells.prefs.patch` on the spec.
  const prefs = app.cells.prefs.use({
    authority: "local",
    initial: DEFAULT_PREFS,
  });

  // Mirror the theme onto `<html data-theme>` so Tailwind's `dark:`
  // variants pick it up for the whole document.
  createEffect(() => {
    document.documentElement.dataset.theme = prefs.value()?.theme ?? "light";
  });

  // ── 2. Collection: notes keyed by id ────────────────────────────────
  // Keys come from a streaming subscription; the bound `.use()` hands
  // every key to a per-key value subscription.
  const keysSub = createRoot(() =>
    createSubscription<NoteId[]>(() =>
      streamCall(app.rpc.notes.keys, undefined),
    ),
  );
  const keys = createMemo<NoteId[]>(() => keysSub() ?? []);

  const notes = app.collections.notes.use({
    keys,
    onError: (err) => console.error("note subscription failed", err),
  });

  // ── 3. Stream: search ───────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = createSignal("");
  const searchInput = createMemo(() =>
    searchQuery().trim() ? { query: searchQuery() } : null,
  );
  const search = app.streams.search.use(searchInput, {
    onError: (err) => console.error("search stream failed", err),
  });

  // ── 4. Event: autosave toast ────────────────────────────────────────
  const [selectedId, setSelectedId] = createSignal<NoteId | null>(null);
  const [flashVisible, setFlashVisible] = createSignal(false);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  app.events.autosave.use(
    selectedId,
    () => {
      setFlashVisible(true);
      if (flashTimer) clearTimeout(flashTimer);
      flashTimer = setTimeout(() => setFlashVisible(false), 2000);
    },
    { onError: (err) => console.error("autosave subscription failed", err) },
  );

  // ── Mutations (app.rpc) ─────────────────────────────────────────────
  const handleCreate = async () => {
    const note = await app.rpc.notes.create({ title: "Untitled" });
    setSelectedId(note.id);
  };

  const selectedNote = createMemo<Note | undefined>(() => {
    const id = selectedId();
    return id ? notes.byKey(id)?.() : undefined;
  });

  const handleEdit = async (
    field: "title" | "body",
    value: string,
  ): Promise<void> => {
    const current = selectedNote();
    if (!current) return;
    const next: Note = { ...current, [field]: value, updatedAt: Date.now() };
    await app.rpc.notes.update({ key: current.id, value: next });
  };

  const handleDelete = async (id: NoteId): Promise<void> => {
    if (selectedId() === id) setSelectedId(null);
    await app.rpc.notes.delete({ key: id });
  };

  // Filter sidebar by search results. When no query, show all.
  const visibleKeys = createMemo<NoteId[]>(() => {
    const q = searchQuery().trim();
    if (!q) return keys();
    const matches = new Set(search()?.matches ?? []);
    return keys().filter((id) => matches.has(id));
  });

  return (
    <div
      class="grid grid-cols-[280px_1fr] h-screen bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
      style={{ "font-size": `${prefs.value()?.fontSize ?? 16}px` }}
    >
      {/* Sidebar */}
      <aside class="border-r border-zinc-200 dark:border-zinc-800 flex flex-col">
        <header class="p-3 border-b border-zinc-200 dark:border-zinc-800 space-y-2">
          <div class="flex items-center justify-between">
            <h1 class="font-semibold text-sm tracking-tight">
              @kolu/cells example
            </h1>
            <button
              type="button"
              onClick={handleCreate}
              class="px-2 py-1 text-xs rounded bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              + New
            </button>
          </div>
          <input
            type="search"
            placeholder="Search…"
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            class="w-full px-2 py-1 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800 focus:outline-none focus:border-zinc-500"
          />
          <Show when={searchQuery().trim() && search.pending()}>
            <div class="text-[10px] text-zinc-500">Searching…</div>
          </Show>
        </header>

        <ul class="flex-1 overflow-y-auto">
          <For
            each={visibleKeys()}
            fallback={
              <li class="p-3 text-xs text-zinc-500">
                {searchQuery().trim() ? "No matches" : "No notes — create one"}
              </li>
            }
          >
            {(id) => {
              const note = () => notes.byKey(id)?.();
              const isActive = createMemo(() => selectedId() === id);
              return (
                <li>
                  <button
                    type="button"
                    onClick={() => setSelectedId(id)}
                    class="w-full text-left px-3 py-2 text-sm border-b border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                    classList={{
                      "bg-zinc-100 dark:bg-zinc-800": isActive(),
                    }}
                  >
                    <div class="font-medium truncate">
                      {note()?.title ?? "…"}
                    </div>
                    <div class="text-[11px] text-zinc-500 truncate">
                      {note()?.body.split("\n")[0] || "(empty)"}
                    </div>
                  </button>
                </li>
              );
            }}
          </For>
        </ul>

        {/* Preferences panel (Cell demo) */}
        <footer class="border-t border-zinc-200 dark:border-zinc-800 p-3 space-y-2 text-xs">
          <div class="flex items-center justify-between">
            <span class="text-zinc-500">Theme</span>
            <button
              type="button"
              onClick={() =>
                void prefs.patch({
                  theme: prefs.value()?.theme === "dark" ? "light" : "dark",
                })
              }
              class="px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-700"
            >
              {prefs.value()?.theme}
            </button>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-zinc-500">Font</span>
            <input
              type="range"
              min={10}
              max={24}
              value={prefs.value()?.fontSize ?? 16}
              onInput={(e) =>
                void prefs.patch({ fontSize: Number(e.currentTarget.value) })
              }
              class="w-24"
            />
          </div>
        </footer>
      </aside>

      {/* Editor */}
      <main class="flex flex-col">
        <Show
          when={selectedNote()}
          fallback={
            <div class="flex-1 flex items-center justify-center text-zinc-400">
              Select or create a note
            </div>
          }
        >
          {(note) => (
            <>
              <header class="px-6 py-3 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3">
                <input
                  type="text"
                  value={note().title}
                  onInput={(e) =>
                    void handleEdit("title", e.currentTarget.value)
                  }
                  class="flex-1 bg-transparent font-semibold focus:outline-none"
                />
                <Show when={flashVisible()}>
                  <span class="text-xs text-emerald-600 dark:text-emerald-400">
                    ✓ Saved
                  </span>
                </Show>
                <button
                  type="button"
                  onClick={() => void handleDelete(note().id)}
                  class="text-xs text-zinc-500 hover:text-red-600"
                >
                  Delete
                </button>
              </header>
              <textarea
                value={note().body}
                onInput={(e) => void handleEdit("body", e.currentTarget.value)}
                class="flex-1 w-full p-6 bg-transparent resize-none focus:outline-none font-mono"
                placeholder="Start typing…"
              />
            </>
          )}
        </Show>
      </main>
    </div>
  );
}

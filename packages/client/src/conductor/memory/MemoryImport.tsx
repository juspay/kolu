/** IMPORTING MEMORY — a Markdown file, chosen or pasted, shown before
 *  anything is added: each memory it holds, marked new or already
 *  remembered. Confirming adds the new ones; nothing is changed or deleted.
 *  A file with no memory in it, or one memory that could not be one, is
 *  refused whole with the reason. Importing is the human's own act: it needs
 *  no approval and rings nothing. */

import Dialog from "@corvu/dialog";
import {
  MemoryRefused,
  type MemoryText,
  readMemoryFile,
  sameMemory,
} from "kolu-common/conductorMemory";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import ModalDialog from "../../ui/ModalDialog";
import { surface } from "../../ui/Surface";
import { createDisclosure } from "../../ui/createDisclosure";
import { useMemory } from "./useMemory";

export const memoryImport = createDisclosure();

interface Read {
  readonly name: string;
  readonly file: string;
}

const MemoryImport: Component = () => {
  const memory = useMemory();
  const [read, setRead] = createSignal<Read | null>(null);
  const [pasted, setPasted] = createSignal("");
  const [refusal, setRefusal] = createSignal<string | null>(null);
  const [adding, setAdding] = createSignal(false);

  const found = createMemo(() => {
    const held = read();
    return held === null ? null : readMemoryFile(held.file);
  });
  const entries = (): ReadonlyArray<MemoryText> => {
    const now = found();
    return now === null || now instanceof MemoryRefused ? [] : now;
  };
  const known = (text: MemoryText): boolean =>
    memory.view().entries.some((entry) => sameMemory(entry, text));
  const fresh = () => entries().filter((text) => !known(text));

  const reset = (): void => {
    setRead(null);
    setPasted("");
    setRefusal(null);
  };

  const choose = (file: File): void => {
    void file.text().then((text) => {
      setRefusal(null);
      setRead({ name: file.name, file: text });
    });
  };

  const add = (): void => {
    setAdding(true);
    void memory.importEntries(entries()).then((refused) => {
      setAdding(false);
      if (refused === null) {
        reset();
        memoryImport.close();
      } else setRefusal(refused);
    });
  };

  const chrome = surface({ radius: "xl", portalled: true });

  return (
    <ModalDialog
      open={memoryImport.open()}
      onOpenChange={(open) => {
        if (!open) reset();
        memoryImport.onOpenChange(open);
      }}
    >
      <Dialog.Content
        data-kolu-modal="true"
        data-testid="memory-import"
        class={`${chrome.class} p-4 text-sm w-[min(520px,calc(100vw-2rem))]`}
        style={chrome.style}
      >
        <Dialog.Label class="block text-sm font-semibold text-fg">
          Import memory
        </Dialog.Label>
        <Show
          when={read()}
          fallback={
            <div class="mt-3 space-y-2">
              <label class="block cursor-pointer rounded-md border border-dashed border-edge-bright px-3 py-3 text-center text-xs text-fg-2 hover:bg-surface-2">
                Choose a Markdown file
                <input
                  type="file"
                  accept=".md,text/markdown,text/plain"
                  data-testid="memory-import-file"
                  class="sr-only"
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    if (file !== undefined) choose(file);
                  }}
                />
              </label>
              <textarea
                data-testid="memory-import-paste"
                aria-label="Paste the Markdown"
                class="w-full min-h-28 rounded-md border border-edge bg-surface-0 px-3 py-2 font-mono text-[0.75rem] text-fg outline-none focus:border-accent/70"
                placeholder={
                  "…or paste it here\n\n## A memory\nAbout: a repository\n\nWhat to remember."
                }
                value={pasted()}
                onInput={(e) => setPasted(e.currentTarget.value)}
              />
              <div class="flex justify-end">
                <button
                  type="button"
                  data-testid="memory-import-read"
                  disabled={pasted().trim() === ""}
                  class="rounded-md border border-edge-bright px-3 py-1.5 text-xs text-fg-2 hover:text-fg disabled:opacity-40"
                  onClick={() => setRead({ name: "pasted", file: pasted() })}
                >
                  Read it
                </button>
              </div>
            </div>
          }
        >
          {(held) => (
            <>
              <div class="mt-1 flex items-baseline justify-between gap-2">
                <p class="m-0 font-mono text-[0.65rem] text-fg-3">
                  {held().name} · {entries().length}{" "}
                  {entries().length === 1 ? "entry" : "entries"}
                </p>
                <button
                  type="button"
                  class="text-[0.7rem] text-accent hover:underline"
                  onClick={reset}
                >
                  Choose another file
                </button>
              </div>
              <Show when={found() instanceof MemoryRefused}>
                <p
                  data-testid="memory-import-refusal"
                  class="mt-2 rounded-md border border-danger/50 bg-danger/10 px-3 py-1.5 text-xs text-danger"
                >
                  {(found() as MemoryRefused).why}
                </p>
              </Show>
              <ul class="m-0 mt-2 max-h-[50vh] list-none space-y-1.5 overflow-y-auto p-0">
                <For each={entries()}>
                  {(text) => (
                    <li
                      data-testid="memory-import-entry"
                      data-known={known(text) ? "" : undefined}
                      class="rounded-md border border-edge px-3 py-2"
                      classList={{ "opacity-60": known(text) }}
                    >
                      <div class="flex items-baseline justify-between gap-2">
                        <b class="text-[0.8rem] text-fg">{text.title}</b>
                        <span class="font-mono text-[0.6rem] text-fg-3">
                          {known(text) ? "already remembered" : "new"}
                        </span>
                      </div>
                      <p class="m-0 truncate text-[0.72rem] text-fg-3">
                        {text.body}
                      </p>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={refusal()}>
                {(why) => (
                  <p
                    data-testid="memory-import-refusal"
                    class="mt-2 rounded-md border border-danger/50 bg-danger/10 px-3 py-1.5 text-xs text-danger"
                  >
                    {why()}
                  </p>
                )}
              </Show>
              <p class="mt-2 text-[0.72rem] text-fg-3">
                Importing adds entries. It never changes or deletes one you
                have.
              </p>
              <div class="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  class="rounded-md px-3 py-1.5 text-xs text-fg-3 hover:text-fg"
                  onClick={() => memoryImport.close()}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="memory-import-add"
                  disabled={fresh().length === 0 || adding()}
                  class="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-surface-1 disabled:opacity-40"
                  onClick={add}
                >
                  {fresh().length === 1
                    ? "Add 1 entry"
                    : `Add ${fresh().length} entries`}
                </button>
              </div>
            </>
          )}
        </Show>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default MemoryImport;

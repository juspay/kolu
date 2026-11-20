/** THE MEMORY SHEET — what the Conductor remembers, and the proposals
 *  waiting on you, in one place. Proposals on top; then every entry with who
 *  wrote it, `Edit` and `Delete`; `Add`, `Export` and `Import` at the head;
 *  the size at the foot. Like the help sheet it has no close button: Escape
 *  or a click outside closes it, and it closes when the pane goes behind a
 *  host tab. */

import Dialog from "@corvu/dialog";
import { writeTextToClipboard } from "@kolu/solid-logtail";
import { Markdown } from "@kolu/solid-markdown";
import { toError } from "@kolu/surface/run-stream";
import {
  MEMORY_CAP,
  MEMORY_FILE_NAME,
  type MemoryEntry,
  memoryFile,
  proposalTitle,
} from "kolu-common/conductorMemory";
import { Effect } from "effect";
import {
  type Component,
  createEffect,
  createSignal,
  For,
  Show,
} from "solid-js";
import { toast } from "solid-sonner";
import { runAction, type UiAction } from "../../runAction";
import DocLink from "../../ui/DocLink";
import { InlineConfirm } from "../../ui/InlineConfirmButton";
import ModalDialog from "../../ui/ModalDialog";
import { surface } from "../../ui/Surface";
import { useShown } from "../../ui/shown";
import { editMemory } from "./MemoryEditor";
import { memoryImport } from "./MemoryImport";
import MemoryProposalCard from "./MemoryProposalCard";
import { memorySheet, useMemory } from "./useMemory";

const DELETE_COPY =
  "Delete this memory? The Conductor is told with its next message. There is no undo.";

const day = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Who wrote an entry, as the sheet says it. */
const byline = (entry: MemoryEntry): string =>
  entry.by === "you"
    ? "you"
    : entry.edited
      ? "the Conductor, edited by you"
      : "the Conductor, approved by you";

const headButton =
  "rounded-md border border-edge px-2.5 py-1 text-xs text-fg-2 hover:text-fg hover:bg-surface-2 cursor-pointer";

const sectionLabel =
  "m-0 mb-1.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-fg-3";

const EntryCard: Component<{ entry: MemoryEntry }> = (props) => {
  const memory = useMemory();
  const [deleting, setDeleting] = createSignal(false);
  return (
    <li
      data-testid="memory-entry"
      data-entry={props.entry.id}
      class="rounded-lg border border-edge px-3 py-2"
    >
      <div class="flex items-baseline justify-between gap-2">
        <p class="m-0 text-[0.82rem] text-fg">
          {props.entry.title}
          <Show when={props.entry.about}>
            {(about) => (
              <span class="ml-1.5 rounded-sm bg-accent/15 px-1 font-mono text-[0.58rem] uppercase tracking-[0.08em] text-accent">
                {about()}
              </span>
            )}
          </Show>
        </p>
        <Show when={!deleting()}>
          <span class="flex shrink-0 gap-2 text-[0.7rem]">
            <button
              type="button"
              data-testid="memory-entry-edit"
              class="text-accent hover:underline cursor-pointer"
              onClick={() => editMemory({ kind: "entry", entry: props.entry })}
            >
              Edit
            </button>
            <button
              type="button"
              data-testid="memory-entry-delete"
              class="text-fg-3 hover:text-danger cursor-pointer"
              onClick={() => setDeleting(true)}
            >
              Delete
            </button>
          </span>
        </Show>
      </div>
      <div class="mt-0.5 text-[0.75rem] text-fg-2">
        <Markdown markdown={props.entry.body} variant="compact" />
      </div>
      <p class="m-0 mt-1 font-mono text-[0.6rem] text-fg-3">
        {byline(props.entry)} · {day(props.entry.at)}
      </p>
      <Show when={deleting()}>
        <div class="mt-2">
          <InlineConfirm
            label="Delete"
            confirmCopy={DELETE_COPY}
            tone="danger"
            testid="memory-entry-delete"
            onCancel={() => setDeleting(false)}
            onConfirm={() => {
              setDeleting(false);
              void memory.remove(props.entry);
            }}
          />
        </div>
      </Show>
    </li>
  );
};

const ExportMenu: Component = () => {
  const memory = useMemory();
  const [open, setOpen] = createSignal(false);
  const file = (): string => memoryFile(memory.view().entries);
  const copy = (): UiAction =>
    Effect.suspend(() => writeTextToClipboard(file())).pipe(
      Effect.tap(() => Effect.sync(() => toast.success("Memory copied"))),
      Effect.catch((err: unknown) =>
        Effect.sync(() => {
          toast.error(`Could not copy the memory: ${toError(err).message}`);
        }),
      ),
    );
  const download = (): void => {
    const url = URL.createObjectURL(
      new Blob([file()], { type: "text/markdown" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = MEMORY_FILE_NAME;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div class="relative">
      <button
        type="button"
        data-testid="memory-export"
        aria-expanded={open()}
        class={headButton}
        onClick={() => setOpen((was) => !was)}
      >
        Export
      </button>
      <Show when={open()}>
        <div class="absolute right-0 z-10 mt-1 w-56 rounded-lg border border-edge bg-surface-1 p-1 shadow-lg">
          <button
            type="button"
            data-testid="memory-export-copy"
            class="block w-full rounded-md px-2 py-1.5 text-left text-xs text-fg hover:bg-surface-2"
            onClick={() => {
              setOpen(false);
              runAction("copy memory", copy());
            }}
          >
            Copy as Markdown
          </button>
          <button
            type="button"
            data-testid="memory-export-download"
            class="block w-full rounded-md px-2 py-1.5 text-left text-xs text-fg hover:bg-surface-2"
            onClick={() => {
              setOpen(false);
              download();
            }}
          >
            Download <span class="font-mono text-fg-3">{MEMORY_FILE_NAME}</span>
          </button>
        </div>
      </Show>
    </div>
  );
};

const sheetChrome = surface({ portalled: true });

export const MemorySheet: Component = () => {
  const memory = useMemory();
  const shown = useShown();
  createEffect(() => {
    if (!shown()) memorySheet.close();
  });
  const share = () => memory.used() / MEMORY_CAP;
  return (
    <ModalDialog
      open={memorySheet.open()}
      onOpenChange={memorySheet.onOpenChange}
      size="md"
    >
      <Dialog.Content
        data-testid="memory-sheet"
        class={`${sheetChrome.class} overflow-hidden`}
        style={sheetChrome.style}
      >
        <header class="flex items-center justify-between gap-2 border-b border-edge px-4 py-3">
          <Dialog.Label class="text-sm font-semibold text-fg">
            Memory
          </Dialog.Label>
          <div class="flex items-center gap-1.5">
            <button
              type="button"
              data-testid="memory-add"
              class={headButton}
              onClick={() => editMemory({ kind: "add" })}
            >
              Add
            </button>
            <ExportMenu />
            <button
              type="button"
              data-testid="memory-import-open"
              class={headButton}
              onClick={() => memoryImport.openDialog()}
            >
              Import
            </button>
          </div>
        </header>
        <div class="max-h-[65vh] space-y-4 overflow-y-auto px-4 py-3">
          <Show when={memory.view().proposals.length > 0}>
            <section data-testid="memory-sheet-waiting">
              <p class={sectionLabel}>
                <span class="text-alert">✱</span> waiting for you ·{" "}
                {memory.view().proposals.length}
              </p>
              <div class="space-y-1.5">
                <For each={memory.view().proposals}>
                  {(proposal) => (
                    <MemoryProposalCard
                      shown={{
                        proposal: proposal.id,
                        title: proposalTitle(memory.view(), proposal),
                        change: proposal.change,
                        why: proposal.why,
                        ended: null,
                      }}
                    />
                  )}
                </For>
              </div>
            </section>
          </Show>
          <section data-testid="memory-sheet-entries">
            <p class={sectionLabel}>
              remembered · {memory.view().entries.length}
            </p>
            <Show
              when={memory.view().entries.length > 0}
              fallback={
                <p class="m-0 font-mono text-[0.7rem] text-fg-3">
                  Nothing yet.
                </p>
              }
            >
              <ul class="m-0 list-none space-y-1.5 p-0">
                <For each={memory.view().entries}>
                  {(entry) => <EntryCard entry={entry} />}
                </For>
              </ul>
            </Show>
          </section>
        </div>
        <footer class="flex items-center justify-between gap-3 border-t border-edge px-4 py-2.5">
          <div class="flex items-center gap-2">
            <span class="h-1 w-20 overflow-hidden rounded-full bg-surface-3">
              <span
                class="block h-full"
                classList={{
                  "bg-warning": share() > 0.9,
                  "bg-accent": share() <= 0.9,
                }}
                style={{ width: `${Math.min(share(), 1) * 100}%` }}
              />
            </span>
            <span
              data-testid="memory-size"
              data-nearly-full={share() > 0.9 ? "" : undefined}
              class="font-mono text-[0.62rem]"
              classList={{
                "text-warning": share() > 0.9,
                "text-fg-3": share() <= 0.9,
              }}
            >
              {memory.used().toLocaleString("en")} of{" "}
              {MEMORY_CAP.toLocaleString("en")} characters
            </span>
          </div>
          <DocLink
            slug="conductor-memory"
            class="text-[0.72rem] text-accent hover:underline"
          >
            About memory →
          </DocLink>
        </footer>
      </Dialog.Content>
    </ModalDialog>
  );
};

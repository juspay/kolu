/**
 * Debug → "Show Claude transcript" — diagnoses missed Claude state events.
 *
 * Two columns side by side:
 *   - left: state transitions the server believed happened (`stateChanges`)
 *   - right: raw JSONL events from disk since the watcher attached
 *
 * Eyeball both: if the right column has an assistant/tool_use line that
 * has no corresponding entry in the left column, the server missed a
 * transition (a bug).
 */

import { type Component, createResource, Show, For } from "solid-js";
import Dialog from "@corvu/dialog";
import ModalDialog from "./ModalDialog";
import { client } from "./rpc";
import type { TerminalId } from "kolu-common";

const ClaudeTranscriptDialog: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  terminalId: () => TerminalId | null;
}> = (props) => {
  const [snapshot] = createResource(
    () => (props.open ? props.terminalId() : null),
    (id) => client.claude.getTranscript({ id }),
  );

  return (
    <ModalDialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Content
        data-testid="claude-transcript"
        class="w-[min(95vw,1200px)] h-[80vh] bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden"
        style={{ "background-color": "var(--color-surface-1)" }}
      >
        <Dialog.Label class="block px-4 py-3 border-b border-edge text-sm font-semibold text-fg">
          Claude transcript (server's view vs disk)
        </Dialog.Label>
        <Show
          when={snapshot()}
          fallback={
            <div class="flex-1 flex items-center justify-center text-fg-3 text-sm px-6 text-center">
              {snapshot.loading
                ? "Loading…"
                : snapshot.error instanceof Error
                  ? `Failed to load transcript: ${snapshot.error.message}`
                  : "No active Claude session for this terminal."}
            </div>
          }
        >
          {(snap) => (
            <>
              <div class="px-4 py-2 border-b border-edge text-xs text-fg-3 font-mono break-all">
                <div>{snap().transcriptPath}</div>
                <div>
                  monitoring since{" "}
                  {new Date(snap().startedAt).toLocaleTimeString()}
                </div>
              </div>
              <div class="flex-1 grid grid-cols-2 min-h-0">
                <section class="flex flex-col min-h-0 border-r border-edge">
                  <header class="px-4 py-2 text-xs font-semibold text-fg-2 border-b border-edge">
                    Server saw ({snap().stateChanges.length} transitions)
                  </header>
                  <pre class="flex-1 overflow-auto px-4 py-2 text-xs font-mono text-fg whitespace-pre-wrap">
                    <For
                      each={snap().stateChanges}
                      fallback={
                        <span class="text-fg-3">No transitions yet.</span>
                      }
                    >
                      {(change) => (
                        <div>
                          {new Date(change.ts).toLocaleTimeString()}{" "}
                          {change.info
                            ? `${change.info.state}${change.info.model ? ` (${change.info.model})` : ""}`
                            : "session ended"}
                        </div>
                      )}
                    </For>
                  </pre>
                </section>
                <section class="flex flex-col min-h-0">
                  <header class="px-4 py-2 text-xs font-semibold text-fg-2 border-b border-edge">
                    Disk JSONL ({snap().rawEvents.length} events)
                  </header>
                  <pre class="flex-1 overflow-auto px-4 py-2 text-xs font-mono text-fg whitespace-pre-wrap">
                    <For
                      each={snap().rawEvents}
                      fallback={
                        <span class="text-fg-3">No events on disk yet.</span>
                      }
                    >
                      {(ev) => <div>{JSON.stringify(ev)}</div>}
                    </For>
                  </pre>
                </section>
              </div>
            </>
          )}
        </Show>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default ClaudeTranscriptDialog;

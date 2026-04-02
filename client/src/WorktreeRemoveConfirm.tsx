/** Confirmation dialog shown when closing a worktree terminal.
 *  Offers three choices: cancel, close only, or close and remove worktree. */

import { type Component, Show } from "solid-js";
import Dialog from "@corvu/dialog";
import ModalDialog from "./ModalDialog";
import { PrStateIcon, WorktreeIcon } from "./Icons";
import ChecksIndicator from "./ChecksIndicator";
import type { TerminalMetadata } from "kolu-common";

const WorktreeRemoveConfirm: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meta: TerminalMetadata | null;
  onCloseOnly: () => void;
  onCloseAndRemove: () => void;
}> = (props) => {
  let removeRef!: HTMLButtonElement;

  return (
    <ModalDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      initialFocusEl={removeRef}
    >
      <Dialog.Content
        class="bg-surface-1 border border-edge-bright rounded-lg p-5 max-w-sm text-sm space-y-4"
        data-testid="worktree-remove-confirm"
      >
        <Dialog.Label class="font-semibold text-fg">
          Remove worktree too?
        </Dialog.Label>

        <div class="space-y-2 text-fg-2">
          <p>This terminal is in a git worktree.</p>

          <Show when={props.meta?.git}>
            {(git) => (
              <div class="flex items-center gap-1.5 text-fg-3 text-xs bg-surface-2 rounded px-2.5 py-2">
                <WorktreeIcon class="w-3.5 h-3.5 shrink-0" />
                <span class="font-medium text-fg-2 truncate">
                  {git().branch}
                </span>
              </div>
            )}
          </Show>

          <Show when={props.meta?.pr}>
            {(pr) => (
              <a
                href={pr().url}
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-1.5 text-xs bg-surface-2 rounded px-2.5 py-2 hover:bg-surface-3 transition-colors"
                data-testid="worktree-confirm-pr"
              >
                <PrStateIcon state={pr().state} class="w-3.5 h-3.5 shrink-0" />
                <Show when={pr().checks}>
                  {(checks) => <ChecksIndicator status={checks()} />}
                </Show>
                <span class="text-fg-2 font-medium">#{pr().number}</span>
                <span class="text-fg-3 truncate">{pr().title}</span>
              </a>
            )}
          </Show>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <button
            class="px-3 py-1.5 text-xs rounded bg-surface-2 text-fg-2 hover:bg-surface-3 transition-colors cursor-pointer"
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            class="px-3 py-1.5 text-xs rounded bg-surface-2 text-fg-2 hover:bg-surface-3 transition-colors cursor-pointer"
            data-testid="worktree-confirm-close-only"
            onClick={() => {
              props.onCloseOnly();
              props.onOpenChange(false);
            }}
          >
            Close only
          </button>
          <button
            ref={removeRef}
            data-testid="worktree-confirm-remove"
            class="px-3 py-1.5 text-xs rounded bg-danger text-white hover:brightness-110 transition-colors cursor-pointer"
            onClick={() => {
              props.onCloseAndRemove();
              props.onOpenChange(false);
            }}
          >
            Close and remove worktree
          </button>
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default WorktreeRemoveConfirm;

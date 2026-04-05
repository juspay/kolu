/** Confirmation dialog shown when closing a terminal that has a worktree,
 *  sub-terminal splits, or both. Adapts its title, body, and actions based
 *  on which concerns are present. */

import { type Component, Show } from "solid-js";
import Dialog from "@corvu/dialog";
import ModalDialog from "./ModalDialog";
import { PrStateIcon, WorktreeIcon } from "./Icons";
import ChecksIndicator from "./ChecksIndicator";
import type { TerminalMetadata } from "kolu-common";

const WorkspaceConfirm: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meta: TerminalMetadata | null;
  subCount: number;
  /** Close terminal (and cascade-kill subs), but keep worktree on disk. */
  onClose: () => void;
  /** Close terminal + remove worktree from disk. Only shown for worktrees. */
  onCloseAndRemove?: () => void;
}> = (props) => {
  let cancelRef!: HTMLButtonElement;
  const isWorktree = () => !!props.meta?.git?.isWorktree;

  return (
    <ModalDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      initialFocusEl={cancelRef}
    >
      <Dialog.Content
        class="bg-surface-1 border border-edge-bright rounded-lg p-5 max-w-sm text-sm space-y-4"
        data-testid={
          isWorktree() ? "worktree-remove-confirm" : "split-close-confirm"
        }
      >
        <Dialog.Label class="font-semibold text-fg">
          {isWorktree()
            ? "Remove worktree too?"
            : "Close terminal with splits?"}
        </Dialog.Label>

        <div class="space-y-2 text-fg-2">
          <Show when={isWorktree()}>
            <p>This terminal is in a git worktree.</p>
          </Show>

          <Show when={props.meta?.git}>
            {(git) => (
              <div class="flex items-center gap-1.5 text-fg-3 text-xs bg-surface-2 rounded px-2.5 py-2">
                <WorktreeIcon class="w-3.5 h-3.5 shrink-0" />
                <span class="font-medium text-fg-2 truncate">
                  {git().repoName}
                </span>
                <span class="text-fg-3">/</span>
                <span class="truncate">{git().branch}</span>
              </div>
            )}
          </Show>
          <Show when={props.meta?.git?.worktreePath}>
            {(path) => (
              <div class="text-xs text-fg-3 truncate" title={path()}>
                {path()}
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

          <Show when={props.subCount > 0}>
            <p>
              This will also close{" "}
              <span class="font-medium text-fg">
                {props.subCount} sub-terminal
                {props.subCount > 1 ? "s" : ""}
              </span>
              .
            </p>
          </Show>
        </div>

        <div class="flex flex-wrap justify-end gap-2 pt-1">
          <button
            ref={cancelRef}
            class="px-3 py-1.5 text-xs rounded text-fg-3 hover:text-fg-2 transition-colors cursor-pointer"
            onClick={() => props.onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            class="px-3 py-1.5 text-xs rounded bg-surface-2 text-fg-2 hover:bg-surface-3 transition-colors cursor-pointer"
            data-testid={
              isWorktree()
                ? "worktree-confirm-close-only"
                : "split-close-confirm-yes"
            }
            onClick={() => {
              props.onClose();
              props.onOpenChange(false);
            }}
          >
            {isWorktree() ? "Close only" : "Close all"}
          </button>
          <Show when={isWorktree() && props.onCloseAndRemove}>
            {(handler) => (
              <button
                data-testid="worktree-confirm-remove"
                class="px-3 py-1.5 text-xs rounded bg-danger text-white hover:brightness-110 transition-colors cursor-pointer"
                onClick={() => {
                  handler()();
                  props.onOpenChange(false);
                }}
              >
                Remove worktree
              </button>
            )}
          </Show>
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default WorkspaceConfirm;

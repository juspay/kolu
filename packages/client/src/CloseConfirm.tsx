/** Confirmation dialog shown whenever a terminal is closed.
 *  Adapts its content for plain terminals, terminals with splits,
 *  and terminals that live in a git worktree. */

import { type Component, Show } from "solid-js";
import Dialog from "@corvu/dialog";
import ModalDialog from "./ui/ModalDialog";
import { PrStateIcon, WorktreeIcon } from "./ui/Icons";
import ChecksIndicator from "./terminal/ChecksIndicator";
import type { TerminalId, TerminalMetadata } from "kolu-common";
import { prValue } from "kolu-common/pr";

export interface CloseConfirmTarget {
  id: TerminalId;
  meta: TerminalMetadata;
  splitCount: number;
  /** Another top-level terminal is on the same worktree, so removing it
   *  here would pull the rug out from under the other terminal. */
  worktreeSharedWithOthers: boolean;
}

const CloseConfirm: Component<{
  target: CloseConfirmTarget | null;
  onCancel: () => void;
  onClose: () => void;
  onCloseAndRemove: () => void;
}> = (props) => {
  let cancelRef!: HTMLButtonElement;
  const isWorktree = () => props.target?.meta.git?.isWorktree ?? false;
  const sharedWorktree = () =>
    isWorktree() && (props.target?.worktreeSharedWithOthers ?? false);
  const canRemoveWorktree = () => isWorktree() && !sharedWorktree();
  const splitCount = () => props.target?.splitCount ?? 0;
  const closeLabel = () => (splitCount() > 0 ? "Close all" : "Close terminal");

  return (
    <ModalDialog
      open={props.target !== null}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      initialFocusEl={cancelRef}
      size="sm"
    >
      <Dialog.Content
        class="bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 p-5 text-sm space-y-4"
        data-testid="close-confirm"
        style={{ "background-color": "var(--color-surface-1)" }}
      >
        <Dialog.Label class="font-semibold text-fg">
          <Show
            when={canRemoveWorktree()}
            fallback={
              splitCount() > 0
                ? "Close terminal and splits?"
                : "Close terminal?"
            }
          >
            Remove worktree too?
          </Show>
        </Dialog.Label>

        <div class="space-y-2 text-fg-2">
          <Show when={isWorktree()}>
            <p>This terminal is in a git worktree.</p>
          </Show>

          <Show when={sharedWorktree()}>
            <p data-testid="close-confirm-shared-note">
              Another terminal is using this worktree — it will remain on disk.
            </p>
          </Show>

          <Show when={splitCount() > 0}>
            <p>
              {splitCount() === 1
                ? "1 split pane will also be closed."
                : `${splitCount()} split panes will also be closed.`}
            </p>
          </Show>

          <Show when={props.target?.meta.git}>
            {(git) => (
              <div class="flex items-center gap-1.5 text-fg-3 text-xs bg-surface-2 rounded-lg px-2.5 py-2">
                <WorktreeIcon class="w-3.5 h-3.5 shrink-0" />
                <span class="font-medium text-fg-2 truncate">
                  {git().repoName}
                </span>
                <span class="text-fg-3">/</span>
                <span class="truncate">{git().branch}</span>
              </div>
            )}
          </Show>
          <Show when={props.target?.meta.git?.worktreePath}>
            {(path) => (
              <div class="text-xs text-fg-3 truncate" title={path()}>
                {path()}
              </div>
            )}
          </Show>

          <Show when={props.target ? prValue(props.target.meta.pr) : null}>
            {(pr) => (
              <a
                href={pr().url}
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-1.5 text-xs bg-surface-2 rounded-lg px-2.5 py-2 hover:bg-surface-3 transition-colors"
                data-testid="close-confirm-pr"
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

        <div class="flex flex-wrap justify-end gap-2 pt-1">
          <button
            ref={cancelRef}
            class="px-3 py-1.5 text-xs rounded-lg text-fg-3 hover:text-fg-2 transition-colors cursor-pointer"
            data-testid="close-confirm-cancel"
            onClick={() => props.onCancel()}
          >
            Cancel
          </button>
          <Show
            when={canRemoveWorktree()}
            fallback={
              <button
                class="px-3 py-1.5 text-xs rounded-lg bg-danger text-white hover:brightness-110 transition-colors cursor-pointer"
                data-testid="close-confirm-close-all"
                onClick={() => props.onClose()}
              >
                {closeLabel()}
              </button>
            }
          >
            <button
              class="px-3 py-1.5 text-xs rounded-lg bg-surface-2 text-fg-2 hover:bg-surface-3 transition-colors cursor-pointer"
              data-testid="close-confirm-close-only"
              onClick={() => props.onClose()}
            >
              {closeLabel()}
            </button>
            <button
              data-testid="close-confirm-remove"
              class="px-3 py-1.5 text-xs rounded-lg bg-danger text-white hover:brightness-110 transition-colors cursor-pointer"
              onClick={() => props.onCloseAndRemove()}
            >
              {closeLabel()} and remove worktree
            </button>
          </Show>
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default CloseConfirm;

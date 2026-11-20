import Dialog from "@corvu/dialog";
import {
  activePr,
  sleepingArm,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { ChecksIndicator, PrStateIcon } from "@kolu/solid-dockrow";
import { prTooltip } from "@kolu/solid-dockrow/rowValues";
import { WorktreeIcon } from "./ui/Icons";
import ModalDialog from "./ui/ModalDialog";
import { surface } from "./ui/Surface";

export type WorktreeRemovalBlocker = "sharedWithOtherTerminals";

export type WorktreeRemovalEligibility =
  | { eligible: true }
  | { eligible: false; reason: WorktreeRemovalBlocker };

const BLOCKER_MESSAGES: Record<WorktreeRemovalBlocker, string> = {
  sharedWithOtherTerminals:
    "Another terminal is using this worktree — it will remain on disk.",
};

export interface CloseConfirmSnapshot {
  readonly id: TerminalId;
  readonly meta: TerminalMetadata;
  readonly splitCount: number;
  readonly worktreeRemoval?: WorktreeRemovalEligibility;
}

const CloseConfirm: Component<{
  target: CloseConfirmSnapshot | null;
  onCancel: () => void;
  onClose: () => void;
  onCloseAndRemove: () => void;
}> = (props) => {
  let cancelRef!: HTMLButtonElement;
  const repo = () => {
    const git = props.target?.meta.git;
    return git?.kind === "repo" ? git.info : undefined;
  };
  const isWorktree = () => repo()?.isWorktree ?? false;
  const removalEligibility = () => props.target?.worktreeRemoval;
  const canRemoveWorktree = () =>
    isWorktree() && removalEligibility()?.eligible === true;
  const removalBlocker = (): WorktreeRemovalBlocker | undefined => {
    const e = removalEligibility();
    return e && !e.eligible ? e.reason : undefined;
  };
  const splitCount = () => props.target?.splitCount ?? 0;
  const isDiscard = () =>
    props.target ? sleepingArm(props.target.meta) !== undefined : false;
  const closeLabel = () =>
    isDiscard()
      ? splitCount() > 0
        ? "Discard all"
        : "Discard"
      : splitCount() > 0
        ? "Close all"
        : "Close terminal";
  const verb = () => (isDiscard() ? "discarded" : "closed");
  const title = () => {
    if (canRemoveWorktree()) return "Remove worktree too?";
    if (isDiscard())
      return splitCount() === 1
        ? "Discard sleeping terminal and 1 split?"
        : splitCount() > 1
          ? `Discard sleeping terminal and ${splitCount()} splits?`
          : "Discard sleeping terminal?";
    if (splitCount() > 0) return "Close terminal and splits?";
    return "Close terminal?";
  };
  const chrome = surface({ portalled: true });

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
        class={`${chrome.class} p-5 text-sm space-y-4`}
        style={chrome.style}
        data-testid="close-confirm"
      >
        <Dialog.Label class="font-semibold text-fg">{title()}</Dialog.Label>

        <div class="space-y-2 text-fg-2">
          <Show when={isWorktree()}>
            <p>This terminal is in a git worktree.</p>
          </Show>

          <Show when={removalBlocker()}>
            {(reason) => (
              <p
                data-testid="close-confirm-removal-blocker"
                data-blocker={reason()}
              >
                {BLOCKER_MESSAGES[reason()]}
              </p>
            )}
          </Show>

          <Show when={splitCount() > 0}>
            <p>
              {splitCount() === 1
                ? `1 split pane will also be ${verb()}.`
                : `${splitCount()} split panes will also be ${verb()}.`}
            </p>
          </Show>

          <Show when={repo()}>
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
          <Show when={repo()?.worktreePath}>
            {(path) => (
              <div class="text-xs text-fg-3 truncate" title={path()}>
                {path()}
              </div>
            )}
          </Show>

          <Show when={activePr(props.target?.meta)}>
            {(pr) => (
              <a
                href={pr().url}
                target="_blank"
                rel="noopener noreferrer"
                class="flex items-center gap-1.5 text-xs bg-surface-2 rounded-lg px-2.5 py-2 hover:bg-surface-3 transition-colors"
                data-testid="close-confirm-pr"
                title={prTooltip(pr())}
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
            type="button"
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
                type="button"
                class="px-3 py-1.5 text-xs rounded-lg bg-danger text-white hover:brightness-110 transition-colors cursor-pointer"
                data-testid="close-confirm-close-all"
                onClick={() => props.onClose()}
              >
                {closeLabel()}
              </button>
            }
          >
            <button
              type="button"
              class="px-3 py-1.5 text-xs rounded-lg bg-surface-2 text-fg-2 hover:bg-surface-3 transition-colors cursor-pointer"
              data-testid="close-confirm-close-only"
              onClick={() => props.onClose()}
            >
              {closeLabel()}
            </button>
            <button
              type="button"
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

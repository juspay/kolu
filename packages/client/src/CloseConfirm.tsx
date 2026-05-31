/** Confirmation dialog shown whenever a terminal is closed.
 *  Adapts its content for plain terminals, terminals with splits,
 *  and terminals that live in a git worktree. */

import Dialog from "@corvu/dialog";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { prValue } from "kolu-github/schemas";
import { type Component, Show } from "solid-js";
import ChecksIndicator from "./terminal/ChecksIndicator";
import { prTooltip } from "./terminal/prTooltip";
import { PrStateIcon, WorktreeIcon } from "./ui/Icons";
import ModalDialog from "./ui/ModalDialog";
import { surface } from "./ui/Surface";

/** Reasons why the "Remove worktree" action is suppressed, in priority
 *  order — the first that applies is the one shown (the ordering lives in
 *  `closeTerminal` in `App.tsx`):
 *
 *  1. `hasUnpushedCommits` — local commits not on any remote (data-loss risk).
 *  2. `hasOpenPullRequest` — an open PR the user is iterating on.
 *  3. `sharedWithOtherTerminals` — another terminal lives on the worktree. */
export type WorktreeRemovalBlocker =
  | "hasUnpushedCommits"
  | "hasOpenPullRequest"
  | "sharedWithOtherTerminals";

/** Whether the close dialog may offer worktree removal.
 *
 *  The ineligible arm carries `prNumber` so the `hasOpenPullRequest` message
 *  can name the PR. It's resolved once, at decision time, in `closeTerminal`
 *  — the dialog reads it off this frozen value rather than re-reading the
 *  reactive `meta.pr`, which would shift under the user's eyes. */
export type WorktreeRemovalEligibility =
  | { eligible: true }
  | { eligible: false; reason: WorktreeRemovalBlocker; prNumber?: number };

/** Presentation context for a blocker message, built from the frozen
 *  eligibility value above (never from live metadata). */
type BlockerContext = { prNumber?: number };

const BLOCKER_MESSAGES: Record<
  WorktreeRemovalBlocker,
  (ctx: BlockerContext) => string
> = {
  hasUnpushedCommits: () =>
    "This branch has commits that aren't pushed — it will remain on disk so you don't lose work.",
  hasOpenPullRequest: ({ prNumber }) =>
    prNumber != null
      ? `This branch has an open pull request (#${prNumber}) — it will remain on disk.`
      : "This branch has an open pull request — it will remain on disk.",
  sharedWithOtherTerminals: () =>
    "Another terminal is using this worktree — it will remain on disk.",
};

export interface CloseConfirmTarget {
  id: TerminalId;
  meta: TerminalMetadata;
  splitCount: number;
  /** Eligibility for the "remove worktree" action. Only set when the
   *  terminal is on a worktree; `undefined` otherwise.
   *
   *  Snapshot at dialog-open time — intentionally not reactive. The dialog
   *  is an imperative confirmation; its title, body note, and buttons must
   *  not shift under the user's eyes while they decide. */
  worktreeRemoval?: WorktreeRemovalEligibility;
}

const CloseConfirm: Component<{
  target: CloseConfirmTarget | null;
  onCancel: () => void;
  onClose: () => void;
  onCloseAndRemove: () => void;
}> = (props) => {
  let cancelRef!: HTMLButtonElement;
  const isWorktree = () => props.target?.meta.git?.isWorktree ?? false;
  const removalEligibility = () => props.target?.worktreeRemoval;
  const canRemoveWorktree = () =>
    isWorktree() && removalEligibility()?.eligible === true;
  const removalBlocker = () => {
    const e = removalEligibility();
    return e && !e.eligible ? e : undefined;
  };
  const splitCount = () => props.target?.splitCount ?? 0;
  const closeLabel = () => (splitCount() > 0 ? "Close all" : "Close terminal");
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

          <Show when={removalBlocker()}>
            {(blocker) => (
              <p
                data-testid="close-confirm-removal-blocker"
                data-blocker={blocker().reason}
              >
                {BLOCKER_MESSAGES[blocker().reason]({
                  prNumber: blocker().prNumber,
                })}
              </p>
            )}
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

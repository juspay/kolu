/** New worktree dialog — pre-fills a fetched branch name suggestion and
 *  a persisted auto-run command, letting the user rename and/or edit the
 *  command before creating the worktree. On successful create, the edited
 *  auto-run becomes the new persisted default. */

import { type Component, createSignal, createEffect, on, Show } from "solid-js";
import Dialog from "@corvu/dialog";
import ModalDialog from "./ModalDialog";
import { client } from "./rpc";
import type { RecentRepo } from "kolu-common";

export interface NewWorktreeTarget {
  repo: RecentRepo;
}

const NewWorktreeDialog: Component<{
  target: NewWorktreeTarget | null;
  /** Initial value for the auto-run field (persisted global default). */
  initialAutoRun: string;
  onCancel: () => void;
  onCreate: (args: { branchName: string; autoRun: string }) => Promise<void>;
}> = (props) => {
  let branchRef!: HTMLInputElement;
  const [branchName, setBranchName] = createSignal("");
  const [autoRun, setAutoRun] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [submitting, setSubmitting] = createSignal(false);

  // On open: reset state, fetch a fresh suggestion, seed auto-run from pref.
  createEffect(
    on(
      () => props.target,
      (target) => {
        if (!target) return;
        setError(null);
        setSubmitting(false);
        setBranchName("");
        setAutoRun(props.initialAutoRun);
        void client.git
          .worktreeSuggestName({ repoPath: target.repo.repoRoot })
          .then((r) => setBranchName(r.branch))
          .catch((err: Error) =>
            setError(`Failed to suggest branch name: ${err.message}`),
          );
      },
    ),
  );

  async function submit(e?: Event) {
    e?.preventDefault();
    const name = branchName().trim();
    if (name.length === 0) {
      setError("Branch name cannot be empty");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await props.onCreate({ branchName: name, autoRun: autoRun() });
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <ModalDialog
      open={props.target !== null}
      onOpenChange={(open) => {
        if (!open && !submitting()) props.onCancel();
      }}
      initialFocusEl={branchRef}
    >
      <Dialog.Content
        class="bg-surface-1 border border-edge rounded-2xl shadow-2xl shadow-black/50 p-5 w-[28rem] max-w-[90vw] text-sm space-y-4"
        data-testid="new-worktree-dialog"
      >
        <Dialog.Label class="font-semibold text-fg">
          New worktree in{" "}
          <span class="text-accent">{props.target?.repo.repoName}</span>
        </Dialog.Label>

        <form onSubmit={submit} class="space-y-3">
          <div class="space-y-1">
            <label class="block text-xs text-fg-3" for="new-worktree-branch">
              Branch name
            </label>
            <input
              ref={branchRef}
              id="new-worktree-branch"
              type="text"
              value={branchName()}
              onInput={(e) => {
                setBranchName(e.currentTarget.value);
                if (error()) setError(null);
              }}
              class="w-full bg-surface-2 border border-edge rounded-lg px-2.5 py-1.5 text-fg font-mono text-xs focus:outline-none focus:border-accent"
              data-testid="new-worktree-branch"
              autocomplete="off"
              spellcheck={false}
            />
          </div>

          <div class="space-y-1">
            <label class="block text-xs text-fg-3" for="new-worktree-autorun">
              Auto-run command{" "}
              <span class="text-fg-3">(leave empty for plain shell)</span>
            </label>
            <input
              id="new-worktree-autorun"
              type="text"
              value={autoRun()}
              onInput={(e) => setAutoRun(e.currentTarget.value)}
              placeholder="e.g. claude --dangerously-skip-permissions"
              class="w-full bg-surface-2 border border-edge rounded-lg px-2.5 py-1.5 text-fg font-mono text-xs focus:outline-none focus:border-accent"
              data-testid="new-worktree-autorun"
              autocomplete="off"
              spellcheck={false}
            />
          </div>

          <Show when={error()}>
            {(msg) => (
              <div
                class="text-xs text-danger bg-danger/10 rounded-lg px-2.5 py-2"
                data-testid="new-worktree-error"
              >
                {msg()}
              </div>
            )}
          </Show>

          <div class="flex justify-end gap-2 pt-1">
            <button
              type="button"
              class="px-3 py-1.5 text-xs rounded-lg text-fg-3 hover:text-fg-2 transition-colors cursor-pointer"
              data-testid="new-worktree-cancel"
              onClick={() => props.onCancel()}
              disabled={submitting()}
            >
              Cancel
            </button>
            <button
              type="submit"
              class="px-3 py-1.5 text-xs rounded-lg bg-accent text-surface-1 hover:brightness-110 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="new-worktree-create"
              disabled={submitting() || branchName().trim().length === 0}
            >
              {submitting() ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default NewWorktreeDialog;

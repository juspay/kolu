/**
 * Worktree creation dialog — minimal input for branch name.
 * On submit, creates a git worktree and opens a terminal in it.
 */

import { type Component, createSignal } from "solid-js";
import Dialog from "@corvu/dialog";
import { toast } from "solid-sonner";
import ModalDialog from "./ModalDialog";
import { client } from "./rpc";

const WorktreeDialog: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoPath: string | null;
  onCreated: (worktreePath: string) => void;
}> = (props) => {
  const [branch, setBranch] = createSignal("");
  const [loading, setLoading] = createSignal(false);
  let inputRef!: HTMLInputElement;

  function reset() {
    setBranch("");
    setLoading(false);
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const name = branch().trim();
    if (!name || !props.repoPath) return;

    setLoading(true);
    try {
      const result = await client.git.worktreeCreate({
        repoPath: props.repoPath,
        branch: name,
      });
      toast(
        result.isNew
          ? `Created worktree for branch ${result.branch}`
          : `Opened existing worktree for branch ${result.branch}`,
      );
      props.onOpenChange(false);
      // Defer terminal creation to next frame so dialog close settles
      // before solid-dnd recalculates sidebar layout
      requestAnimationFrame(() => props.onCreated(result.path));
    } catch (err) {
      toast.error(`Failed to create worktree: ${err}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <ModalDialog
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open);
        if (!open) reset();
      }}
      initialFocusEl={inputRef}
    >
      <Dialog.Content
        data-testid="worktree-dialog"
        class="bg-surface-1 border border-edge-bright rounded-lg p-4 w-80"
      >
        <form onSubmit={handleSubmit}>
          <label class="block text-sm text-fg-3 mb-2">Branch name</label>
          <input
            ref={inputRef!}
            type="text"
            class="w-full bg-surface-0 text-fg border border-edge rounded px-3 py-2 text-sm focus:outline-none focus:border-accent"
            placeholder="feature/my-branch"
            value={branch()}
            onInput={(e) => setBranch(e.currentTarget.value)}
            disabled={loading()}
          />
          <div class="flex justify-end gap-2 mt-3">
            <button
              type="button"
              class="px-3 py-1.5 text-sm text-fg-3 hover:text-fg"
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              class="px-3 py-1.5 text-sm bg-accent text-surface-0 rounded hover:opacity-90 disabled:opacity-50"
              disabled={!branch().trim() || loading()}
            >
              {loading() ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default WorktreeDialog;

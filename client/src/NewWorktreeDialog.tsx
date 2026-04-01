/** Dialog for creating a new worktree with optional agent configuration. */

import {
  type Component,
  Show,
  For,
  createSignal,
  createEffect,
  on,
} from "solid-js";
import {
  createQuery,
  createMutation,
  useQueryClient,
} from "@tanstack/solid-query";
import Dialog from "@corvu/dialog";
import ModalDialog from "./ModalDialog";
import Toggle from "./Toggle";
import { orpc } from "./orpc";
import { useRecentRepos } from "./useRecentRepos";
import type { WorktreeAgent } from "kolu-common";

const AGENT_OPTIONS: { value: WorktreeAgent; label: string }[] = [
  { value: "shell", label: "Shell" },
  { value: "claude", label: "Claude Code" },
];

const NewWorktreeDialog: Component<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateWorktree: (opts: {
    repoPath: string;
    agent: WorktreeAgent;
    dangerouslySkipPermissions: boolean;
    prompt: string;
  }) => void;
}> = (props) => {
  const { recentRepos, refetch } = useRecentRepos();
  const qc = useQueryClient();

  const configQuery = createQuery(() => ({
    ...orpc.settings.getWorktreeConfig.queryOptions(),
    staleTime: Infinity,
  }));

  const configMut = createMutation(() => ({
    ...orpc.settings.setWorktreeConfig.mutationOptions(),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: orpc.settings.getWorktreeConfig.key(),
      }),
  }));

  const [selectedRepo, setSelectedRepo] = createSignal<string | null>(null);
  const [agent, setAgent] = createSignal<WorktreeAgent>("shell");
  const [skipPerms, setSkipPerms] = createSignal(false);
  const [prompt, setPrompt] = createSignal("");

  // Reset ephemeral state + sync persisted config when dialog opens
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (!open) return;
        refetch();
        setSelectedRepo(null);
        setPrompt("");
        const data = configQuery.data;
        if (data) {
          setAgent(data.agent);
          setSkipPerms(data.dangerouslySkipPermissions);
        }
      },
    ),
  );

  // Auto-select first repo when list loads (or refreshes)
  createEffect(
    on(recentRepos, (repos) => {
      if (props.open && repos.length > 0 && selectedRepo() === null) {
        setSelectedRepo(repos[0]!.repoRoot);
      }
    }),
  );

  function handleAgentChange(value: WorktreeAgent) {
    setAgent(value);
    configMut.mutate({ agent: value, dangerouslySkipPermissions: skipPerms() });
  }

  function handleSkipPermsChange(on: boolean) {
    setSkipPerms(on);
    configMut.mutate({ agent: agent(), dangerouslySkipPermissions: on });
  }

  function handleCreate() {
    const repo = selectedRepo();
    if (!repo) return;
    props.onCreateWorktree({
      repoPath: repo,
      agent: agent(),
      dangerouslySkipPermissions: skipPerms(),
      prompt: prompt().trim(),
    });
    props.onOpenChange(false);
  }

  function handleKeyDown(e: KeyboardEvent) {
    // Don't intercept Enter inside the prompt textarea (let newlines through)
    if (e.key === "Enter" && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      handleCreate();
    }
  }

  return (
    <ModalDialog open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Content
        class="bg-surface-1 border border-edge-bright rounded-lg p-4 w-[400px] max-w-[90vw] space-y-3"
        data-testid="new-worktree-dialog"
        onKeyDown={handleKeyDown}
      >
        <Dialog.Label class="text-sm font-semibold text-fg">
          New worktree
        </Dialog.Label>

        {/* Repo list */}
        <div class="space-y-1">
          <span class="text-xs text-fg-3">Repository</span>
          <div
            data-testid="worktree-repo-list"
            class="max-h-[180px] overflow-y-auto rounded border border-edge bg-surface-0"
          >
            <Show
              when={recentRepos().length > 0}
              fallback={
                <div class="px-3 py-2 text-xs text-fg-3">
                  No recent repos — cd into a git repo first
                </div>
              }
            >
              <For each={recentRepos()}>
                {(repo) => (
                  <button
                    data-testid="worktree-repo-item"
                    data-selected={
                      selectedRepo() === repo.repoRoot ? "" : undefined
                    }
                    class="w-full text-left px-3 py-1.5 text-sm cursor-pointer transition-colors"
                    classList={{
                      "bg-accent/20 text-fg": selectedRepo() === repo.repoRoot,
                      "text-fg-2 hover:bg-surface-2":
                        selectedRepo() !== repo.repoRoot,
                    }}
                    onClick={() => setSelectedRepo(repo.repoRoot)}
                  >
                    <div class="font-medium">{repo.repoName}</div>
                    <div class="text-xs text-fg-3 truncate">
                      {repo.repoRoot}
                    </div>
                  </button>
                )}
              </For>
            </Show>
          </div>
        </div>

        {/* Agent selector */}
        <div class="space-y-1">
          <div
            data-testid="worktree-agent-selector"
            class="flex rounded-md overflow-hidden border border-edge"
          >
            <For each={AGENT_OPTIONS}>
              {(opt) => (
                <button
                  data-testid={`worktree-agent-${opt.value}`}
                  class="flex-1 px-3 py-1.5 text-sm transition-colors cursor-pointer"
                  classList={{
                    "bg-accent text-surface-0": agent() === opt.value,
                    "bg-surface-2 text-fg-2 hover:text-fg":
                      agent() !== opt.value,
                  }}
                  onClick={() => handleAgentChange(opt.value)}
                >
                  {opt.label}
                </button>
              )}
            </For>
          </div>
        </div>

        {/* Claude Code options */}
        <Show when={agent() === "claude"}>
          <div class="space-y-3">
            <label class="flex items-center justify-between gap-3 cursor-pointer text-sm">
              <span class="text-fg-2">--dangerously-skip-permissions</span>
              <Toggle
                testId="worktree-skip-perms"
                enabled={skipPerms()}
                onChange={handleSkipPermsChange}
              />
            </label>
            <div class="space-y-1">
              <span class="text-xs text-fg-3">Prompt</span>
              <textarea
                data-testid="worktree-prompt"
                class="w-full px-3 py-2 text-sm bg-surface-0 border border-edge rounded resize-none focus:outline-none focus:ring-1 focus:ring-accent/50 text-fg placeholder:text-fg-3"
                rows={2}
                placeholder="Fix the failing test in src/parser.ts"
                value={prompt()}
                onInput={(e) => setPrompt(e.currentTarget.value)}
              />
            </div>
          </div>
        </Show>

        {/* Create button */}
        <div class="flex justify-end">
          <button
            data-testid="worktree-create-btn"
            class="px-4 py-1.5 text-sm font-medium bg-accent text-surface-0 rounded hover:brightness-110 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!selectedRepo()}
            onClick={handleCreate}
          >
            Create
          </button>
        </div>
      </Dialog.Content>
    </ModalDialog>
  );
};

export default NewWorktreeDialog;

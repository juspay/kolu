/** Contextual info panel — collapsible panel above terminal showing git worktree actions. */

import {
  type Component,
  Show,
  For,
  createResource,
  createSignal,
  createMemo,
} from "solid-js";
import { makePersisted } from "@solid-primitives/storage";
import Disclosure from "@corvu/disclosure";
import { toast } from "solid-sonner";
import { client } from "./rpc";
import { cwdBasename } from "./path";
import type { CwdInfo } from "kolu-common";

/** Copy text to clipboard and show a toast. */
function copyToClipboard(text: string) {
  void navigator.clipboard.writeText(text).then(() => {
    toast("Copied to clipboard");
  });
}

const CopyButton: Component<{ text: string }> = (props) => (
  <button
    class="shrink-0 px-2 py-0.5 text-[0.65rem] text-fg-3 hover:text-fg bg-surface-2 hover:bg-surface-3 rounded border border-edge transition-colors cursor-pointer"
    onClick={() => copyToClipboard(props.text)}
  >
    Copy
  </button>
);

const CommandRow: Component<{ command: string }> = (props) => (
  <div class="flex items-center gap-2">
    <code class="text-xs text-fg-2 font-mono truncate flex-1">
      {props.command}
    </code>
    <CopyButton text={props.command} />
  </div>
);

const SectionLabel: Component<{ label: string }> = (props) => (
  <div class="text-[0.65rem] text-fg-3 uppercase tracking-wider mt-2 mb-1">
    {props.label}
  </div>
);

const InfoPanel: Component<{ cwd: CwdInfo | null }> = (props) => {
  const [expanded, setExpanded] = makePersisted(createSignal(false), {
    name: "kolu-info-panel-expanded",
    serialize: (v) => String(v),
    deserialize: (s) => s === "true",
  });

  const gitInfo = createMemo(() => props.cwd?.git ?? null);
  const repoRoot = createMemo(() => gitInfo()?.repoRoot ?? null);

  // createResource skips the fetcher when source is falsy
  const [worktrees] = createResource(repoRoot, async (root) => {
    try {
      return await client.git.listWorktrees({ repoRoot: root });
    } catch {
      return [];
    }
  });

  /** Non-bare worktrees (the actual checked-out ones). */
  const checkedOutWorktrees = createMemo(
    () => worktrees()?.filter((w) => !w.isBare) ?? [],
  );

  /** Worktrees other than the current terminal's CWD worktree. */
  const otherWorktrees = createMemo(() => {
    const currentPath = gitInfo()?.worktreePath;
    return checkedOutWorktrees().filter((w) => w.path !== currentPath);
  });

  /** Detect the default branch (prefer main/master, fallback to first worktree's branch). */
  const defaultBranch = createMemo(() => {
    const wts = checkedOutWorktrees();
    const common = wts.find(
      (w) => w.branch === "main" || w.branch === "master",
    );
    return common?.branch ?? wts[0]?.branch ?? "main";
  });

  const hasWorktrees = createMemo(() => checkedOutWorktrees().length > 1);

  const newWorktreeCmd = createMemo(() => {
    const root = repoRoot();
    if (!root) return "";
    const parent = root.replace(/\/[^/]+$/, "");
    return `git worktree add ${parent}/<branch> -b <branch> origin/${defaultBranch()}`;
  });

  return (
    <Show when={gitInfo()}>
      {(git) => (
        <Disclosure
          expanded={expanded()}
          onExpandedChange={setExpanded}
          collapseBehavior="hide"
        >
          {/* Collapsed bar — always visible */}
          <Disclosure.Trigger
            class="w-full flex items-center gap-2 px-3 py-1 bg-surface-1 border-b border-edge text-xs cursor-pointer hover:bg-surface-2 transition-colors select-none"
            data-testid="info-panel-trigger"
          >
            <span class="text-fg-3">📂</span>
            <span class="text-fg-2 font-medium" title={git().repoRoot}>
              {git().repoName}
            </span>
            <span class="text-fg-3">·</span>
            <span class="text-accent">{git().branch}</span>
            <Show when={hasWorktrees()}>
              <span class="text-fg-3">
                · {checkedOutWorktrees().length} worktrees
              </span>
            </Show>
            <span class="ml-auto text-fg-3 text-[0.6rem]">
              {expanded() ? "▴" : "▾"}
            </span>
          </Disclosure.Trigger>

          {/* Expanded content */}
          <Disclosure.Content class="overflow-hidden border-b border-edge bg-surface-0/50 data-[collapsed]:animate-[collapse_200ms_linear] data-[expanded]:animate-[expand_200ms_linear]">
            <div class="px-3 py-2 space-y-1">
              <Show when={hasWorktrees()}>
                <div class="text-xs text-fg-3">
                  Worktrees:{" "}
                  {checkedOutWorktrees()
                    .map((w) => w.branch ?? cwdBasename(w.path))
                    .join(", ")}
                </div>
              </Show>

              <SectionLabel label="New worktree" />
              <CommandRow command={newWorktreeCmd()} />

              <Show when={otherWorktrees().length > 0}>
                <SectionLabel label="Switch to worktree" />
                <For each={otherWorktrees()}>
                  {(wt) => <CommandRow command={`cd ${wt.path}`} />}
                </For>
              </Show>
            </div>
          </Disclosure.Content>
        </Disclosure>
      )}
    </Show>
  );
};

export default InfoPanel;

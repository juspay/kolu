/** GitTab — placeholder shell for the git/changes view (Phase 2).
 *  Shows branch, worktree status, and PR details from existing terminal metadata. */

import { type Component, Show } from "solid-js";
import type { TerminalMetadata } from "kolu-common";
import { PrStateIcon, WorktreeIcon } from "../ui/Icons";
import ChecksIndicator from "../sidebar/ChecksIndicator";
import Section from "./Section";

const GitTab: Component<{ meta: TerminalMetadata | null }> = (props) => {
  return (
    <Show
      when={props.meta}
      fallback={
        <div class="flex items-center justify-center h-full text-fg-3/50 text-[11px]">
          No terminal selected
        </div>
      }
    >
      {(meta) => (
        <div class="overflow-y-auto overflow-x-hidden h-full">
          <Show
            when={meta().git}
            fallback={
              <div class="flex items-center justify-center py-8 text-fg-3/40 text-[11px]">
                Not a git repository
              </div>
            }
          >
            {(git) => (
              <>
                <Section title="Branch">
                  <div class="text-[11px] text-fg font-mono flex items-center gap-1.5">
                    {git().branch}
                    <Show when={git().isWorktree}>
                      <WorktreeIcon class="w-3 h-3 text-fg-3/50" />
                    </Show>
                  </div>
                </Section>
                <Section title="Repository">
                  <div class="text-[11px] text-fg-2 space-y-1">
                    <div>{git().repoName}</div>
                    <Show when={git().isWorktree}>
                      <div class="font-mono text-fg-3 text-[10px] break-all">
                        {git().repoRoot}
                      </div>
                    </Show>
                  </div>
                </Section>
              </>
            )}
          </Show>

          <Show when={meta().pr}>
            {(pr) => (
              <Section title="Pull Request">
                <div class="text-[11px] space-y-1.5">
                  <div class="flex items-center gap-1.5">
                    <PrStateIcon state={pr().state} class="w-3.5 h-3.5" />
                    <a
                      href={pr().url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="text-accent hover:underline font-mono"
                    >
                      #{pr().number}
                    </a>
                    <span class="text-fg">{pr().title}</span>
                  </div>
                  <Show when={pr().checks}>
                    {(checks) => (
                      <div class="flex items-center gap-1.5 text-fg-2">
                        <ChecksIndicator status={checks()} />
                        <span class="capitalize">{checks()}</span>
                      </div>
                    )}
                  </Show>
                </div>
              </Section>
            )}
          </Show>

          <div class="flex items-center justify-center py-8 text-fg-3/40 text-[11px]">
            Diff viewer coming in Phase 2
          </div>
        </div>
      )}
    </Show>
  );
};

export default GitTab;

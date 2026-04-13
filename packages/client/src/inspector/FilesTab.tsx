/** FilesTab — placeholder shell for the file browser (Phase 1).
 *  Shows CWD and repo root from existing terminal metadata. */

import { type Component, Show } from "solid-js";
import type { TerminalMetadata } from "kolu-common";
import Section from "./Section";

const FilesTab: Component<{ meta: TerminalMetadata | null }> = (props) => {
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
          <Section title="Directory">
            <div class="text-[11px] text-fg font-mono break-all leading-relaxed">
              {meta().cwd}
            </div>
          </Section>
          <Show when={meta().git}>
            {(git) => (
              <Section title="Repository">
                <div class="text-[11px] text-fg-2 font-mono break-all">
                  {git().repoRoot}
                </div>
              </Section>
            )}
          </Show>
          <div class="flex items-center justify-center py-8 text-fg-3/40 text-[11px]">
            File browser coming in Phase 1
          </div>
        </div>
      )}
    </Show>
  );
};

export default FilesTab;

/** MetadataInspector — live view of the active terminal's full context.
 *  Pure rendering: receives metadata, renders sections. */

import { type Component, type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { TerminalMetadata } from "kolu-common";
import { PrStateIcon, WorktreeIcon } from "./Icons";
import ChecksIndicator from "./ChecksIndicator";
import { agentIcons, agentNames, stateLabels } from "./agentDisplay";

/** Labeled section with tight spacing. */
const Section: Component<{
  title: string;
  "data-testid"?: string;
  children: JSX.Element;
}> = (props) => (
  <div
    class="py-3 px-3 border-b border-edge"
    data-testid={props["data-testid"]}
  >
    <div class="text-[9px] font-bold uppercase tracking-[0.15em] text-fg-3/60 mb-2">
      {props.title}
    </div>
    {props.children}
  </div>
);

/** Label–value pair with dim label and bright value. */
const Row: Component<{ label: string; children: JSX.Element }> = (props) => (
  <div class="flex items-baseline gap-3 text-[11px] leading-snug py-0.5">
    <span class="text-fg-3/70 shrink-0 w-14 text-right">{props.label}</span>
    <span class="text-fg-2 min-w-0 break-words">{props.children}</span>
  </div>
);

const MetadataInspector: Component<{
  meta: TerminalMetadata | null;
  themeName?: string;
  onThemeClick?: () => void;
}> = (props) => {
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
        <div
          class="overflow-y-auto overflow-x-hidden h-full"
          data-testid="header-cwd"
        >
          {/* Directory */}
          <Section title="Directory">
            <div class="text-[11px] text-fg font-mono break-all leading-relaxed">
              {meta().cwd}
            </div>
          </Section>

          {/* Git */}
          <Show when={meta().git}>
            {(git) => (
              <Section title="Git" data-testid="header-branch">
                <div class="space-y-0.5">
                  <Row label="Branch">
                    <span class="font-mono text-fg">
                      {git().branch}
                      <Show when={git().isWorktree}>
                        <WorktreeIcon class="inline w-3 h-3 ml-1 text-fg-3/50" />
                      </Show>
                    </span>
                  </Row>
                  <Row label="Repo">
                    <span class="text-fg">{git().repoName}</span>
                  </Row>
                  <Row label="Root">
                    <span class="font-mono text-fg-3">
                      {git().mainRepoRoot}
                    </span>
                  </Row>
                  <Show when={git().isWorktree}>
                    <Row label="Worktree">
                      <span class="font-mono text-fg-3">{git().repoRoot}</span>
                    </Row>
                  </Show>
                </div>
              </Section>
            )}
          </Show>

          {/* Pull Request */}
          <Show when={meta().pr}>
            {(pr) => (
              <Section title="Pull Request">
                <div class="space-y-0.5">
                  <Row label="PR">
                    <a
                      href={pr().url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center gap-1.5 text-accent hover:underline"
                    >
                      <PrStateIcon state={pr().state} class="w-3.5 h-3.5" />
                      <span class="font-mono">#{pr().number}</span>
                    </a>
                  </Row>
                  <Row label="Title">
                    <span class="text-fg">{pr().title}</span>
                  </Row>
                  <Show when={pr().checks}>
                    {(checks) => (
                      <Row label="CI">
                        <span class="inline-flex items-center gap-1.5">
                          <ChecksIndicator status={checks()} />
                          <span class="capitalize text-fg">{checks()}</span>
                        </span>
                      </Row>
                    )}
                  </Show>
                </div>
              </Section>
            )}
          </Show>

          {/* Agent */}
          <Show when={meta().agent}>
            {(agent) => (
              <Section title="Agent">
                <div class="space-y-0.5">
                  <Row label="Kind">
                    <span class="inline-flex items-center gap-1.5">
                      <Dynamic
                        component={agentIcons[agent().kind]}
                        class="w-3.5 h-3.5"
                      />
                      <span class="text-fg">
                        {agentNames[agent().kind] ?? agent().kind}
                      </span>
                    </span>
                  </Row>
                  <Row label="State">
                    <span class="text-fg">
                      {stateLabels[agent().state] ?? agent().state}
                    </span>
                  </Row>
                  <Show when={agent().summary}>
                    {(summary) => (
                      <Row label="Task">
                        <span class="text-fg">{summary()}</span>
                      </Row>
                    )}
                  </Show>
                  <Show when={agent().model}>
                    {(model) => (
                      <Row label="Model">
                        <span class="font-mono text-fg">{model()}</span>
                      </Row>
                    )}
                  </Show>
                  <Show when={agent().taskProgress}>
                    {(tp) => (
                      <Row label="Tasks">
                        <span class="text-fg">
                          <span class="font-mono">
                            {tp().completed}/{tp().total}
                          </span>{" "}
                          completed
                        </span>
                      </Row>
                    )}
                  </Show>
                </div>
              </Section>
            )}
          </Show>

          {/* Foreground process */}
          <Show when={meta().foreground}>
            {(fg) => (
              <Section title="Foreground">
                <div class="space-y-0.5">
                  <Row label="Process">
                    <span class="font-mono text-fg">{fg().name}</span>
                  </Row>
                  <Show when={fg().title}>
                    {(title) => (
                      <Row label="Title">
                        <span class="font-mono text-fg-3">{title()}</span>
                      </Row>
                    )}
                  </Show>
                </div>
              </Section>
            )}
          </Show>

          {/* Theme */}
          <Show when={props.themeName}>
            {(name) => (
              <Section title="Theme">
                <button
                  class="text-[11px] text-accent hover:underline cursor-pointer"
                  onClick={props.onThemeClick}
                >
                  {name()}
                </button>
              </Section>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
};

export default MetadataInspector;

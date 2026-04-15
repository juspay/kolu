/** MetadataInspector — live view of the active terminal's full context.
 *  Pure rendering: receives metadata, renders sections. */

import { type Component, type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { TerminalMetadata } from "kolu-common";
import { PrStateIcon, TerminalIcon, WorktreeIcon } from "../ui/Icons";
import ChecksIndicator from "../sidebar/ChecksIndicator";
import { agentIcons, agentNames, stateLabels } from "../ui/agentDisplay";
import Section from "./Section";

/** Label–value pair with dim label and bright value.
 *  `variant` codifies styling rules for special rows:
 *  - "badge": pill background for status indicators (CI, agent state)
 *  - "tag": mono accent background for identity values (branch name) */
const Row: Component<{
  label: string;
  variant?: "default" | "badge" | "tag";
  children: JSX.Element;
}> = (props) => (
  <div class="flex items-baseline gap-3 text-[11px] leading-snug py-0.5">
    <span class="text-fg-3/70 shrink-0 w-14 text-right">{props.label}</span>
    <span
      class={`min-w-0 break-words ${
        props.variant === "badge"
          ? "text-fg-2 inline-flex items-center gap-1.5 bg-surface-2/60 px-1.5 py-px rounded-full text-[10px]"
          : props.variant === "tag"
            ? "text-fg font-mono bg-accent/10 px-1.5 py-px rounded-sm text-[10px]"
            : "text-fg-2"
      }`}
    >
      {props.children}
    </span>
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
        <div class="flex flex-col items-center justify-center h-full text-fg-3/40 gap-2 text-[11px]">
          <TerminalIcon class="w-8 h-8 opacity-40" />
          No terminal selected
        </div>
      }
    >
      {(meta) => (
        <div
          class="overflow-y-auto overflow-x-hidden h-full"
          data-testid="inspector-cwd"
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
              <Section
                title="Git"
                accent="border-accent"
                data-testid="inspector-branch"
              >
                <div class="space-y-0.5">
                  <Row label="Branch" variant="tag">
                    {git().branch}
                    <Show when={git().isWorktree}>
                      <WorktreeIcon class="inline w-3 h-3 ml-1 text-fg-3/50" />
                    </Show>
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
                      <Row label="CI" variant="badge">
                        <ChecksIndicator status={checks()} />
                        <span class="capitalize">{checks()}</span>
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
              <Section title="Agent" accent="border-busy">
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
                  <Row label="State" variant="badge">
                    {stateLabels[agent().state] ?? agent().state}
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

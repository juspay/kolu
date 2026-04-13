/** MetadataInspector — live view of the active terminal's full context.
 *  Pure rendering: receives metadata, renders sections. */

import { type Component, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { AgentInfo, TerminalMetadata } from "kolu-common";
import {
  PrStateIcon,
  WorktreeIcon,
  ClaudeCodeIcon,
  OpenCodeIcon,
} from "./Icons";
import ChecksIndicator from "./ChecksIndicator";

const agentIcons: Record<AgentInfo["kind"], Component<{ class?: string }>> = {
  "claude-code": ClaudeCodeIcon,
  opencode: OpenCodeIcon,
};

const agentNames: Record<AgentInfo["kind"], string> = {
  "claude-code": "Claude Code",
  opencode: "OpenCode",
};

const stateLabels: Record<AgentInfo["state"], string> = {
  thinking: "Thinking",
  tool_use: "Running tools",
  waiting: "Waiting for input",
};

const Section: Component<{ title: string; children: any }> = (props) => (
  <div class="px-3 py-2.5 border-b border-edge last:border-b-0">
    <div class="text-[10px] font-semibold uppercase tracking-wider text-fg-3 mb-1.5">
      {props.title}
    </div>
    {props.children}
  </div>
);

const Row: Component<{ label: string; children: any }> = (props) => (
  <div class="flex items-start gap-2 text-xs leading-relaxed">
    <span class="text-fg-3 shrink-0 w-16">{props.label}</span>
    <span class="text-fg-2 min-w-0 break-all">{props.children}</span>
  </div>
);

const MetadataInspector: Component<{ meta: TerminalMetadata | null }> = (
  props,
) => {
  return (
    <Show
      when={props.meta}
      fallback={
        <div class="flex items-center justify-center h-full text-fg-3 text-xs">
          No terminal selected
        </div>
      }
    >
      {(meta) => (
        <div class="overflow-y-auto h-full">
          {/* CWD */}
          <Section title="Directory">
            <div class="text-xs text-fg font-mono break-all">{meta().cwd}</div>
          </Section>

          {/* Git */}
          <Show when={meta().git}>
            {(git) => (
              <Section title="Git">
                <div class="space-y-1">
                  <Row label="Branch">
                    <span class="font-mono">
                      {git().branch}
                      <Show when={git().isWorktree}>
                        <WorktreeIcon class="inline w-3 h-3 ml-1 text-fg-3" />
                      </Show>
                    </span>
                  </Row>
                  <Row label="Repo">{git().repoName}</Row>
                  <Row label="Root">
                    <span class="font-mono">{git().repoRoot}</span>
                  </Row>
                  <Show when={git().isWorktree}>
                    <Row label="Worktree">
                      <span class="font-mono">{git().worktreePath}</span>
                    </Row>
                  </Show>
                </div>
              </Section>
            )}
          </Show>

          {/* PR */}
          <Show when={meta().pr}>
            {(pr) => (
              <Section title="Pull Request">
                <div class="space-y-1">
                  <Row label="PR">
                    <a
                      href={pr().url}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="inline-flex items-center gap-1 text-accent hover:underline"
                    >
                      <PrStateIcon state={pr().state} class="w-3.5 h-3.5" />#
                      {pr().number}
                    </a>
                  </Row>
                  <Row label="Title">{pr().title}</Row>
                  <Show when={pr().checks}>
                    {(checks) => (
                      <Row label="CI">
                        <span class="inline-flex items-center gap-1.5">
                          <ChecksIndicator status={checks()} />
                          <span class="capitalize">{checks()}</span>
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
                <div class="space-y-1">
                  <Row label="Kind">
                    <span class="inline-flex items-center gap-1">
                      <Dynamic
                        component={agentIcons[agent().kind]}
                        class="w-3.5 h-3.5"
                      />
                      {agentNames[agent().kind] ?? agent().kind}
                    </span>
                  </Row>
                  <Row label="State">
                    {stateLabels[agent().state] ?? agent().state}
                  </Row>
                  <Show when={agent().model}>
                    {(model) => <Row label="Model">{model()}</Row>}
                  </Show>
                  <Show when={agent().taskProgress}>
                    {(tp) => (
                      <Row label="Tasks">
                        <span>
                          {tp().completed}/{tp().total} completed
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
                <div class="space-y-1">
                  <Row label="Process">
                    <span class="font-mono">{fg().name}</span>
                  </Row>
                  <Show when={fg().title}>
                    {(title) => (
                      <Row label="Title">
                        <span class="font-mono">{title()}</span>
                      </Row>
                    )}
                  </Show>
                </div>
              </Section>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
};

export default MetadataInspector;

/** MetadataInspector — live view of the active terminal's full context.
 *  Pure rendering: receives metadata, renders sections. */

import { prValue } from "anyforge/schemas";
import {
  activeArm,
  prUnavailableSource,
  type TerminalId,
  type TerminalMetadata,
} from "kolu-common/surface";
import { type Component, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import ChecksIndicator from "../terminal/ChecksIndicator";
import { ProviderUnavailableContent } from "../terminal/PrUnavailablePopover";
import {
  agentIcons,
  agentNames,
  agentWorkflow,
  stateLabels,
} from "../ui/agentDisplay";
import { PrStateIcon, TerminalIcon, WorktreeIcon } from "../ui/Icons";
import Row from "../ui/Row";
import Section from "../ui/Section";
import KavalAttachCommand from "./KavalAttachCommand";

const MetadataInspector: Component<{
  meta: TerminalMetadata | null;
  terminalId: TerminalId | null;
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

          {/* Pull Request — gated on the active arm; a sleeping terminal has
              no live PR resolution. */}
          <Show when={activeArm(meta())}>
            {(active) => (
              <>
                <Show when={prValue(active().pr)}>
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
                            <PrStateIcon
                              state={pr().state}
                              class="w-3.5 h-3.5"
                            />
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
                        {/* Per-check breakdown rendered inline — same data
                         *  the dock-pip / tile-title tooltip carries, but
                         *  inspector has the real estate to lay it out
                         *  vertically so a fail/pending list is scannable
                         *  without hovering. Skipped when the server
                         *  hasn't sent per-check entries (older payload). */}
                        <Show when={pr().checkRuns.length > 0}>
                          <Row label="Checks">
                            <ul
                              data-testid="inspector-pr-checks"
                              class="flex flex-col gap-0.5 text-[11px]"
                            >
                              <For each={pr().checkRuns}>
                                {(c) => (
                                  <li class="flex items-center gap-1.5 min-w-0">
                                    <ChecksIndicator status={c.outcome} />
                                    <span class="font-mono truncate min-w-0">
                                      {c.name}
                                    </span>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </Row>
                        </Show>
                      </div>
                    </Section>
                  )}
                </Show>
                <Show when={prUnavailableSource(active().pr)}>
                  {(source) => (
                    <Section title="Pull Request">
                      <div
                        data-testid="inspector-pr-unavailable"
                        class="space-y-2 text-xs"
                      >
                        <ProviderUnavailableContent source={source()} />
                      </div>
                    </Section>
                  )}
                </Show>
              </>
            )}
          </Show>

          {/* Agent */}
          <Show when={activeArm(meta())?.agent}>
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
                  <Show when={agentWorkflow(agent())}>
                    {(wf) => (
                      <Row label="Workflow">
                        <span class="text-fg">
                          {wf().name}{" "}
                          <span class="font-mono text-fg-2">
                            ({wf().agents} agents · {wf().status})
                          </span>
                        </span>
                      </Row>
                    )}
                  </Show>
                  <Show when={agent().contextTokens}>
                    {(tokens) => (
                      <Row label="Context">
                        <span class="font-mono text-fg">
                          {tokens().toLocaleString()} tokens
                        </span>
                      </Row>
                    )}
                  </Show>
                </div>
              </Section>
            )}
          </Show>

          {/* Foreground process */}
          <Show when={activeArm(meta())?.foreground}>
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
                  type="button"
                  data-testid="inspector-theme-button"
                  class="text-[11px] text-accent hover:underline cursor-pointer"
                  onClick={props.onThemeClick}
                >
                  {name()}
                </button>
              </Section>
            )}
          </Show>

          {/* Attach — the shell-side handle on this terminal via kaval-tui;
           *  copy the command and grab it from any shell. Gated on the active
           *  arm: a sleeping terminal has no live PTY to attach to. */}
          <Show when={activeArm(meta()) && props.terminalId}>
            {(id) => (
              <Section title="Attach">
                <KavalAttachCommand terminalId={id()} />
              </Section>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
};

export default MetadataInspector;

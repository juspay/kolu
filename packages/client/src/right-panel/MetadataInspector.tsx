/** MetadataInspector — live view of a terminal's full context.
 *  Renders sections from the supplied `meta`; the active terminal's
 *  preview-aware theme name is read from `useThemeManager` only when
 *  the inspector is displaying that terminal. The theme-button click
 *  stays a prop because it triggers a palette open whose owner lives
 *  at the App layer (no global palette-controller singleton yet). */

import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { prUnavailableSource, prValue } from "kolu-github/schemas";
import { type Component, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import ChecksIndicator from "../terminal/ChecksIndicator";
import { ProviderUnavailableContent } from "../terminal/PrUnavailablePopover";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { agentIcons, agentNames, stateLabels } from "../ui/agentDisplay";
import { PrStateIcon, TerminalIcon, WorktreeIcon } from "../ui/Icons";
import Row from "../ui/Row";
import Section from "../ui/Section";
import { useThemeManager } from "../useThemeManager";

const MetadataInspector: Component<{
  /** Anchor terminal id — needed so we only consult the active-tile-
   *  scoped theme manager when this inspector is displaying the active
   *  tile's metadata. Without it, the inspector for a non-active anchor
   *  would render the active terminal's preview theme over its own
   *  metadata. */
  terminalId: TerminalId;
  meta: TerminalMetadata | null;
  onThemeClick?: () => void;
}> = (props) => {
  const { activeThemeName } = useThemeManager();
  const store = useTerminalStore();
  // Active anchor: theme manager has the preview-aware name. Otherwise:
  // fall back to the persisted name on the anchor's metadata.
  const themeName = () =>
    store.activeId() === props.terminalId
      ? activeThemeName()
      : (props.meta?.themeName ?? undefined);
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
          <Show when={prValue(meta().pr)}>
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
          <Show when={prUnavailableSource(meta().pr)}>
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
          <Show when={themeName()}>
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
        </div>
      )}
    </Show>
  );
};

export default MetadataInspector;

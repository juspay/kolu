/** MetadataInspector — live view of the active terminal's full context.
 *
 *  Layout + arm gating for the active terminal's sections. This file decides WHICH
 *  sections show and in what order, not where their data comes from: a section that
 *  needs more than `meta` reads it itself — `ComposeSection` reaches `activePadiRpc`,
 *  `KavalAttachSection` and `PortsSection` the terminal store, `PortsSection` the
 *  active host. (It used to claim "pure rendering: receives metadata, renders
 *  sections", which three of its own children already broke — and a stated rule that
 *  is false is worse than an unstated one, because the next reader either enforces
 *  it wrongly or learns to ignore this file's comments.)
 *
 *  The panel is organized in three tiers of attention (the inspector revamp):
 *  - **State** leads: `AgentStatusCard` answers "does it need me?" in semantic
 *    color before anything is read.
 *  - **Identity** is compact: the Work cluster (see `WorkSection.tsx`, which
 *    owns what it shows and how it folds).
 *  - **Reference** folds: the whole Attach section lives behind a disclosure. */

import { activeArm, type TerminalMetadata } from "@kolu/padi/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Component, Show } from "solid-js";
import { TerminalIcon } from "../ui/Icons";
import Section from "../ui/Section";
import AgentStatusCard from "./AgentStatusCard";
import ComposeSection from "./ComposeSection";
import KavalAttachSection from "./KavalAttachSection";
import PortsSection from "./PortsSection";
import WorkSection from "./WorkSection";

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
          {/* Compose — draft a prompt and send it to the active terminal.
           *  Gated on the ACTIVE arm (a sleeping tile released its PTY, so
           *  `sendInput` would quiet-drop) exactly like the Attach section
           *  below. `keyed` on the terminal id so a tile switch REMOUNTS the
           *  section — its per-terminal persisted draft then rebinds to the new
           *  terminal's localStorage key instead of the previous tile's. */}
          <Show when={activeArm(meta()) && props.terminalId} keyed>
            {(id) => (
              <Section title="Compose">
                <ComposeSection terminalId={id} />
              </Section>
            )}
          </Show>

          {/* Agent — tier 1. The status card leads: state chip + left rail in
           *  semantic color, task, then the quiet meta row. */}
          <Show when={activeArm(meta())?.agent}>
            {(agent) => <AgentStatusCard agent={agent()} />}
          </Show>

          {/* Work — directory + git + PR as one identity cluster. */}
          <WorkSection meta={meta()} />

          {/* Ports — what this TILE is serving, its splits included (a dev server
              usually runs in a split, so a main-pane-only reading shows nothing in
              the common case). Gated on the id alone, which is the only thing the
              child needs: `PortsSection` owns which panes to read AND which of them
              are awake — and the per-PANE arm read is the correct one, since a tile
              can be active while a pane is asleep. It also owns which chips are
              openable (that needs the active HOST, not just this metadata) and
              rendering nothing at all when the tile serves nothing. */}
          <Show when={props.terminalId}>
            {(id) => <PortsSection terminalId={id()} />}
          </Show>

          {/* Attach/snapshot commands per terminal (main + splits) — see
           *  KavalAttachSection for the socket-pinning + short-id rationale.
           *  Reference tier: ships COLLAPSED (attach is an occasional act, not
           *  a status; it used to spend ~40% of the panel). Gated on the ACTIVE
           *  arm: a sleeping tile released its PTY (and its splits were
           *  closed), so it is no longer one of kaval's terminals — a
           *  `kaval-tui attach`/`snapshot` command would have nothing to
           *  reach. Same liveness narrow the PR/Agent sections use.
           *
           *  `keyed` on the terminal id for the same reason Compose above is: the
           *  section holds PICKER state (which pane, which verb), and without a
           *  remount that state survives a tile switch — you would land on
           *  another tile showing `send` + "Split 1" preselected on a picker you
           *  never touched there. */}
          <Show when={activeArm(meta()) && props.terminalId} keyed>
            {(id) => (
              <Section
                title="Attach"
                collapsible
                data-testid="inspector-attach-section"
              >
                <KavalAttachSection terminalId={id} />
              </Section>
            )}
          </Show>

          {/* Footer meta — facts you rarely act on: the foreground process and
           *  the theme, one quiet mono row instead of two sections. */}
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 font-mono text-[10px] text-fg-3">
            <Show when={activeArm(meta())?.foreground}>
              {(fg) => (
                <span
                  data-testid="inspector-foreground"
                  title={fg().title ?? undefined}
                >
                  fg <span class="text-fg-2">{fg().name}</span>
                </span>
              )}
            </Show>
            <Show when={props.themeName}>
              {(name) => (
                <button
                  type="button"
                  data-testid="inspector-theme-button"
                  class="cursor-pointer text-accent hover:underline"
                  onClick={props.onThemeClick}
                >
                  {name()}
                </button>
              )}
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
};

export default MetadataInspector;

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
 *  - **Identity** is compact: Directory + Git + Pull Request merge into one
 *    "Work" cluster of chips + a path, since they tell one story.
 *  - **Reference** folds: the per-check CI list, repo paths, and the whole
 *    Attach section live behind disclosures — and expansion follows
 *    *exceptions* (a failing/pending check list auto-expands, exceptions
 *    sorted first; an all-green list collapses to a rollup chip). */

import { activeArm, type TerminalMetadata } from "@kolu/padi/surface";
import { type PrInfo, prValue } from "anyforge/schemas";
import { prUnavailableSource, type TerminalId } from "kolu-common/surface";
import { type Component, createMemo, For, Show } from "solid-js";
import ChecksIndicator from "../terminal/ChecksIndicator";
import { ProviderUnavailableContent } from "../terminal/PrUnavailablePopover";
import Chip from "../ui/Chip";
import Disclosure from "../ui/Disclosure";
import { PrStateIcon, TerminalIcon, WorktreeIcon } from "../ui/Icons";
import Row from "../ui/Row";
import Section from "../ui/Section";
import AgentStatusCard from "./AgentStatusCard";
import ComposeSection from "./ComposeSection";
import KavalAttachSection from "./KavalAttachSection";
import PortsSection from "./PortsSection";

/** Per-outcome tally of a PR's check runs. */
type CheckCounts = { fail: number; pending: number; pass: number };

const countChecks = (runs: PrInfo["checkRuns"]): CheckCounts => {
  const counts: CheckCounts = { fail: 0, pending: 0, pass: 0 };
  for (const run of runs) counts[run.outcome] += 1;
  return counts;
};

/** Exceptions first: fail, then pending, then pass — the order a reader
 *  triages in, so an auto-expanded list leads with what expanded it. */
const OUTCOME_RANK = { fail: 0, pending: 1, pass: 2 } as const;

/** The CI rollup chip's text + tone, from the per-check tally (falling back to
 *  the combined `checks` status when the server sent no per-check entries). */
const ciRollup = (
  checks: NonNullable<PrInfo["checks"]>,
  counts: CheckCounts,
  total: number,
): { label: string; tone: "ok" | "warning" | "danger" } => {
  if (total === 0) {
    return checks === "pass"
      ? { label: "✓ CI", tone: "ok" }
      : checks === "pending"
        ? { label: "● CI running", tone: "warning" }
        : { label: "✕ CI failed", tone: "danger" };
  }
  if (counts.fail > 0)
    return { label: `✕ ${counts.fail} failed`, tone: "danger" };
  if (counts.pending > 0)
    return { label: `● ${counts.pending} running`, tone: "warning" };
  return { label: `✓ ${total}/${total} checks`, tone: "ok" };
};

/** The check-list disclosure's summary line — the rollup in words. */
const checksSummary = (counts: CheckCounts, total: number): string => {
  if (counts.fail > 0) {
    const rest = [
      counts.pending > 0 ? `${counts.pending} running` : null,
      `${counts.pass} passed`,
    ]
      .filter((s) => s !== null)
      .join(" · ");
    return `${counts.fail} failed · ${rest}`;
  }
  if (counts.pending > 0)
    return `${counts.pending} running · ${counts.pass} passed`;
  return `All ${total} checks passed`;
};

/** The "Work" cluster — what you're working ON, told once: branch/repo/PR/CI
 *  as a chip row, the PR title, the working directory, and the deep detail
 *  (per-check list, repo paths) behind disclosures. Replaces the former
 *  Directory + Git + Pull Request label/value sections. */
const WorkSection: Component<{ meta: TerminalMetadata }> = (props) => {
  const active = () => activeArm(props.meta);
  // PR facts are live only on the ACTIVE arm; a sleeping terminal has no PR
  // resolution (same gate the old Pull Request section used).
  const pr = () => {
    const arm = active();
    return arm ? prValue(arm.pr) : undefined;
  };
  const prUnavailable = () => {
    const arm = active();
    return arm ? prUnavailableSource(arm.pr) : undefined;
  };
  const counts = createMemo(() => countChecks(pr()?.checkRuns ?? []));
  const sortedRuns = createMemo(() =>
    [...(pr()?.checkRuns ?? [])].sort(
      (a, b) => OUTCOME_RANK[a.outcome] - OUTCOME_RANK[b.outcome],
    ),
  );
  const hasException = () => counts().fail > 0 || counts().pending > 0;
  return (
    <Section title="Work" accent="border-accent">
      <div class="space-y-1.5">
        {/* Identity chips: branch (+worktree glyph) · repo · PR · CI rollup.
         *  `inspector-branch` wraps the git chips — the e2e seam that asserts
         *  the branch NAME is on screen (and absent outside a repo). */}
        <div class="flex flex-wrap items-center gap-1.5">
          <Show when={props.meta.git}>
            {(git) => (
              // A real inline-flex box (NOT `display: contents`): Playwright's
              // visibility check needs a bounding box, and the e2e steps wait
              // on this testid being visible.
              <span
                class="inline-flex min-w-0 flex-wrap items-center gap-1.5"
                data-testid="inspector-branch"
              >
                <Chip
                  tone="accent"
                  title={git().isWorktree ? "worktree" : undefined}
                >
                  <Show when={git().isWorktree}>
                    <WorktreeIcon class="h-3 w-3 shrink-0 text-fg-3/60" />
                  </Show>
                  <span class="truncate font-semibold">{git().branch}</span>
                </Chip>
                <Chip>{git().repoName}</Chip>
              </span>
            )}
          </Show>
          <Show when={pr()}>
            {(p) => (
              <>
                <a
                  href={p().url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="hover:underline"
                >
                  <Chip tone="neutral">
                    <PrStateIcon state={p().state} class="h-3 w-3 shrink-0" />
                    <span class="text-accent">#{p().number}</span>
                  </Chip>
                </a>
                <Show when={p().checks}>
                  {(checks) => {
                    const rollup = () =>
                      ciRollup(checks(), counts(), sortedRuns().length);
                    return (
                      <Chip tone={rollup().tone} data-testid="inspector-ci">
                        {rollup().label}
                      </Chip>
                    );
                  }}
                </Show>
              </>
            )}
          </Show>
        </div>

        <Show when={pr()}>
          {(p) => (
            <div class="text-[11.5px] leading-snug text-fg">{p().title}</div>
          )}
        </Show>

        {/* Working directory — the one place the path appears (it used to head
         *  its own Directory section AND repeat as Git's Worktree row). */}
        <div
          class="break-all font-mono text-[10.5px] leading-relaxed text-fg-3"
          data-testid="inspector-directory"
        >
          {props.meta.cwd}
        </div>

        {/* Per-check breakdown — reference tier. Expansion follows exceptions:
         *  all-green folds to the summary line, a fail/pending run auto-expands
         *  with the exceptions sorted first. */}
        <Show when={pr()}>
          {(p) => (
            <Show when={p().checkRuns.length > 0}>
              <Disclosure
                summary={checksSummary(counts(), sortedRuns().length)}
                open={hasException()}
              >
                <ul
                  data-testid="inspector-pr-checks"
                  class="flex flex-col gap-0.5 text-[11px]"
                >
                  <For each={sortedRuns()}>
                    {(c) => (
                      <li class="flex min-w-0 items-center gap-1.5">
                        <ChecksIndicator status={c.outcome} />
                        <span
                          class="min-w-0 truncate font-mono"
                          classList={{
                            "text-danger font-semibold": c.outcome === "fail",
                          }}
                        >
                          {c.name}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </Disclosure>
            </Show>
          )}
        </Show>

        <Show when={props.meta.git}>
          {(git) => (
            <Disclosure summary="Repo paths">
              <Row label="Root">
                <span class="font-mono text-fg-3">{git().mainRepoRoot}</span>
              </Row>
              <Show when={git().isWorktree}>
                <Row label="Worktree">
                  <span class="font-mono text-fg-3">{git().repoRoot}</span>
                </Row>
              </Show>
            </Disclosure>
          )}
        </Show>

        <Show when={prUnavailable()}>
          {(source) => (
            <div
              data-testid="inspector-pr-unavailable"
              class="space-y-2 pt-1 text-xs"
            >
              <ProviderUnavailableContent source={source()} />
            </div>
          )}
        </Show>
      </div>
    </Section>
  );
};

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
           *  reach. Same liveness narrow the PR/Agent sections use. */}
          <Show when={activeArm(meta()) && props.terminalId}>
            {(id) => (
              <Section
                title="Attach"
                collapsible
                data-testid="inspector-attach-section"
              >
                <KavalAttachSection terminalId={id()} />
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

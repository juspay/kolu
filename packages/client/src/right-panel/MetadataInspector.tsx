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
import { type CheckStatus, type PrInfo, prValue } from "anyforge/schemas";
import { prUnavailableSource, type TerminalId } from "kolu-common/surface";
import { type Component, createMemo, For, Show } from "solid-js";
import ChecksIndicator from "../terminal/ChecksIndicator";
import { ProviderUnavailableContent } from "../terminal/PrUnavailablePopover";
import {
  assignColors,
  type TerminalDisplayInfo,
} from "../terminal/terminalDisplay";
import { useTerminalStore } from "../terminal/useTerminalStore";
import Chip from "../ui/Chip";
import Disclosure from "../ui/Disclosure";
import { PrStateIcon, TerminalIcon, WorktreeIcon } from "../ui/Icons";
import RepoMonogram from "../ui/RepoMonogram";
import Row from "../ui/Row";
import Section from "../ui/Section";
import AgentStatusCard from "./AgentStatusCard";
import ComposeSection from "./ComposeSection";
import KavalAttachSection from "./KavalAttachSection";
import PortsSection from "./PortsSection";

/** Triage order — the sequence a reader wants: what's broken, what's still
 *  moving, what's done. ONE ordered list serves both the check list's sort and
 *  the summary line's word order, so "exceptions first" is stated once. */
const TRIAGE: readonly CheckStatus[] = ["fail", "pending", "pass"];

/** How each outcome reads in a count ("1 failed"), and the glyph + Chip tone
 *  the rollup wears. Keyed by the outcome, so a new `CheckStatus` member is one
 *  entry here rather than a new arm in three separate conditionals. */
const OUTCOME: Record<
  CheckStatus,
  { word: string; glyph: string; tone: "ok" | "warning" | "danger" }
> = {
  fail: { word: "failed", glyph: "✕", tone: "danger" },
  pending: { word: "running", glyph: "●", tone: "warning" },
  pass: { word: "passed", glyph: "✓", tone: "ok" },
};

/** Per-outcome tally of a PR's check runs — the counts, and ONLY the counts.
 *  The combined verdict is deliberately NOT derived here: the server already
 *  folds it (`foldCheckOutcomes` → `PrInfo.checks`), and re-folding the list
 *  client-side would install a second judge of "is CI red?" that can disagree
 *  with the one the tile title and dock pip read. */
const countChecks = (
  runs: PrInfo["checkRuns"],
): Record<CheckStatus, number> => {
  const counts: Record<CheckStatus, number> = { fail: 0, pending: 0, pass: 0 };
  for (const run of runs) counts[run.outcome] += 1;
  return counts;
};

/** The rollup chip: the SERVER's verdict picks the glyph, word, and tone; the
 *  local tally only supplies the number. With no per-check entries (an older
 *  payload) there is no number to state, so the chip names the verdict alone. */
const ciRollup = (
  checks: CheckStatus,
  counts: Record<CheckStatus, number>,
): { label: string; tone: "ok" | "warning" | "danger" } => {
  const { word, glyph, tone } = OUTCOME[checks];
  const n = counts[checks];
  return {
    label: n === 0 ? `${glyph} CI ${word}` : `${glyph} ${n} ${word}`,
    tone,
  };
};

/** The disclosure's summary line — "1 failed · 2 running · 6 passed", the
 *  non-empty buckets in triage order. No verdict branching: the order carries
 *  it, and the chip above already states it. */
const checksSummary = (counts: Record<CheckStatus, number>): string =>
  TRIAGE.filter((o) => counts[o] > 0)
    .map((o) => `${counts[o]} ${OUTCOME[o].word}`)
    .join(" · ");

/** Repo identity chip — monogram + name in the shared repo-colour frame.
 *  Colour is the live terminal's `repoColor` (fleet-wide assignColors), so the
 *  chip matches the dock monogram for the same terminal. Not a status chip. */
const RepoIdentityChip: Component<{ name: string; color: string }> = (
  props,
) => (
  <span
    class="fleet-hue-chip fleet-hue-chip--with-mono"
    style={{ "--chip-hue": props.color }}
    title={props.name}
    data-testid="inspector-repo"
  >
    <RepoMonogram group={props.name} color={props.color} size="xs" />
    <span class="truncate">{props.name}</span>
  </span>
);

/** The "Work" cluster — what you're working ON, told once: branch/repo/PR/CI
 *  as a chip row, the PR title, the working directory, and the deep detail
 *  (per-check list, repo paths) behind disclosures. Replaces the former
 *  Directory + Git + Pull Request label/value sections. */
const WorkSection: Component<{
  meta: TerminalMetadata;
  /** Active tile id — used only to read the fleet-wide `repoColor`. */
  terminalId: TerminalId | null;
}> = (props) => {
  const store = useTerminalStore();
  /** Prefer fleet display projection; fall back to stable assignColors on
   *  the live git names so chips never soft-degrade to neutral chrome. */
  const identityColors = (): {
    repoColor: string;
    annotationColor: string;
  } | null => {
    const git = props.meta.git;
    if (!git) return null;
    const id = props.terminalId;
    const display: TerminalDisplayInfo | undefined = id
      ? store.getDisplayInfo(id)
      : undefined;
    if (display) {
      return {
        repoColor: display.repoColor,
        annotationColor: display.annotationColor,
      };
    }
    const colors = assignColors([git.repoName, git.branch]);
    const repoColor = colors.get(git.repoName);
    const annotationColor = colors.get(git.branch);
    if (!repoColor || !annotationColor) {
      throw new Error(
        `assignColors missing inspector keys for ${git.repoName}/${git.branch}`,
      );
    }
    return { repoColor, annotationColor };
  };
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
      (a, b) => TRIAGE.indexOf(a.outcome) - TRIAGE.indexOf(b.outcome),
    ),
  );
  /** Anything but a clean pass is an exception, and an exception opens the list
   *  on its own. Read off the server's fold — the same verdict the chip wears.
   *  `null` is "no checks configured", which is not an exception (and renders no
   *  list at all), so it is folded in with "no PR" rather than read as not-pass. */
  const hasException = () => {
    const verdict = pr()?.checks ?? null;
    return verdict !== null && verdict !== "pass";
  };
  return (
    <Section title="Work" accent="border-accent">
      <div class="space-y-1.5">
        {/* Identity chips: branch (+worktree glyph) · repo · PR · CI rollup.
         *  `inspector-branch` sits on the BRANCH chip alone — not a wrapper
         *  around branch+repo — so the e2e seam that asserts "the branch is on
         *  screen" reads only the branch's own text. On the wrapper, a rendered
         *  repo name alone would satisfy a non-empty assertion and an empty
         *  branch would pass. */}
        <div class="flex flex-wrap items-center gap-1.5">
          <Show when={props.meta.git && identityColors()}>
            {(gitAndColors) => {
              // Show when={A && B} narrows to truthy B (colors); re-read git.
              const colors = gitAndColors();
              const git = props.meta.git!;
              return (
                <>
                  <span
                    class="fleet-hue-chip"
                    style={{ "--chip-hue": colors.annotationColor }}
                    title={git.isWorktree ? "worktree" : undefined}
                    data-testid="inspector-branch"
                  >
                    <Show when={git.isWorktree}>
                      <WorktreeIcon class="h-3 w-3 shrink-0 opacity-60" />
                    </Show>
                    <span class="truncate font-semibold">{git.branch}</span>
                  </span>
                  <RepoIdentityChip
                    name={git.repoName}
                    color={colors.repoColor}
                  />
                </>
              );
            }}
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
                    const rollup = () => ciRollup(checks(), counts());
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
                summary={checksSummary(counts())}
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
          <WorkSection meta={meta()} terminalId={props.terminalId} />

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

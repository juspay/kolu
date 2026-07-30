/** The "Work" cluster — what you're working ON, told once.
 *
 *  Branch / repo / PR / CI as a chip row, the PR title, the working directory,
 *  and the deep detail (per-check list, repo paths) behind disclosures.
 *  Replaces the former Directory + Git + Pull Request label/value sections.
 *
 *  Its own file because it is the one section of the Inspector with real
 *  derivation of its own (identity + paint, the check fold) rather than
 *  layout — and because that makes it renderable in a test without dragging
 *  the Inspector's `../wire`-bound siblings (Compose / Ports / Attach) into
 *  the module graph. */

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
import { PrStateIcon, WorktreeIcon } from "../ui/Icons";
import RepoMonogram from "../ui/RepoMonogram";
import Row from "../ui/Row";
import Section from "../ui/Section";

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
  >
    <RepoMonogram group={props.name} color={props.color} size="xs" />
    {/* testid on the NAME alone — the monogram is decorative (aria-hidden)
     *  and would otherwise prepend its glyph to the element's textContent, so
     *  a reader asking "what repo?" gets "Kkolu" instead of "kolu". Same rule
     *  the restore band's `repo-heading` states, and the same reason
     *  `inspector-branch` sits on the branch chip rather than a wrapper. */}
    <span class="truncate" data-testid="inspector-repo">
      {props.name}
    </span>
  </span>
);

const WorkSection: Component<{
  meta: TerminalMetadata;
  /** Active tile id — used only to read the fleet-wide `repoColor`. */
  terminalId: TerminalId | null;
}> = (props) => {
  const store = useTerminalStore();
  /** The git facts AND their paint, as ONE value.
   *
   *  Bundled deliberately, for the same reason `useTerminalStore.active()`
   *  bundles `(id, meta)`: the chips render git facts and the colours derived
   *  from them together, so handing the body one value from one reactive read
   *  makes a torn pair — this terminal's branch wearing the last one's hue —
   *  unrepresentable.
   *
   *  It also deletes the shape that froze the chips (shipped in #2037). The
   *  old code gated on `Show when={git && identityColors()}` and RE-READ git
   *  inside the body; a non-keyed `<Show>` runs its body EXACTLY ONCE and
   *  keeps it mounted while the condition stays truthy, so that re-read
   *  snapshotted the first terminal's `branch`/`repoName` into a `const` that
   *  never changed again. Every terminal has git context, so the condition
   *  never went falsy and nothing ever rebuilt the body. With a single value
   *  behind a single accessor there is no second thing left to snapshot.
   *
   *  Paint prefers the fleet display projection and falls back to stable
   *  `assignColors` on the live git names, so chips never soft-degrade to
   *  neutral chrome. */
  const identity = createMemo(() => {
    const git = props.meta.git;
    if (!git) return null;
    const id = props.terminalId;
    const display: TerminalDisplayInfo | undefined = id
      ? store.getDisplayInfo(id)
      : undefined;
    if (display) {
      return {
        git,
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
    return { git, repoColor, annotationColor };
  });
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
          {/* Every read below goes through the `id()` accessor. Assigning any
           *  of them to a `const` here re-freezes the chips — this body is
           *  built once and outlives every terminal switch. */}
          <Show when={identity()}>
            {(id) => (
              <>
                <span
                  class="fleet-hue-chip"
                  style={{ "--chip-hue": id().annotationColor }}
                  title={id().git.isWorktree ? "worktree" : undefined}
                  data-testid="inspector-branch"
                >
                  <Show when={id().git.isWorktree}>
                    <WorktreeIcon class="h-3 w-3 shrink-0 opacity-60" />
                  </Show>
                  <span class="truncate font-semibold">{id().git.branch}</span>
                </span>
                <RepoIdentityChip
                  name={id().git.repoName}
                  color={id().repoColor}
                />
              </>
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

export default WorkSection;

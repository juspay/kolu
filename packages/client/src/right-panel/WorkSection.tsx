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
import { prUnavailableSource } from "kolu-common/surface";
import { terminalKey } from "kolu-common/terminalKey";
import { type Component, createMemo, For, Show } from "solid-js";
import ChecksIndicator from "../terminal/ChecksIndicator";
import { ProviderUnavailableContent } from "../terminal/PrUnavailablePopover";
import { assignColors } from "../terminal/terminalDisplay";
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
 *  Colour is the fleet hue for the repo name, the same `assignColors` key the
 *  dock monogram paints from. Not a status chip. */
const RepoIdentityChip: Component<{ name: string; color: string }> = (
  props,
) => (
  <span
    class="fleet-hue-chip fleet-hue-chip--with-mono"
    style={{ "--chip-hue": props.color }}
    title={props.name}
    data-testid="inspector-repo-chip"
  >
    <RepoMonogram group={props.name} color={props.color} size="xs" />
    {/* testid on the NAME alone — the monogram is decorative (aria-hidden)
     *  and would otherwise prepend its glyph to the element's textContent, so
     *  a reader asking "what repo?" gets "Kkolu" instead of "kolu". The FRAME
     *  carries its own `inspector-repo-chip` testid, so paint is readable
     *  without climbing out of the name span. */}
    <span class="truncate" data-testid="inspector-repo">
      {props.name}
    </span>
  </span>
);

/** Branch identity chip — hue frame + optional worktree glyph. A component,
 *  not inline JSX, for the same reason its repo peer is one: props compile to
 *  getters, so there is no expression inside the `<Show>` body that an editor
 *  could snapshot into a `const` and re-freeze the chips with. */
const BranchIdentityChip: Component<{
  branch: string;
  isWorktree: boolean;
  color: string;
}> = (props) => (
  <span
    class="fleet-hue-chip"
    style={{ "--chip-hue": props.color }}
    title={props.isWorktree ? "worktree" : undefined}
    data-testid="inspector-branch"
  >
    <Show when={props.isWorktree}>
      <WorktreeIcon class="h-3 w-3 shrink-0 opacity-60" />
    </Show>
    <span class="truncate font-semibold">{props.branch}</span>
  </span>
);

const WorkSection: Component<{
  meta: TerminalMetadata;
}> = (props) => {
  /** The git facts AND their paint, as ONE value. Paint is a pure function of
   *  the SAME `git` the chips render — `assignColors` hues by key string alone,
   *  which is exactly what the fleet-wide projection feeds the dock — so a torn
   *  pair (this terminal's branch wearing the last one's hue) is unspellable
   *  rather than merely avoided.
   *
   *  The hue keys come from `terminalKey`, NOT from a local
   *  `[git.repoName, git.branch]` spelling. That function is the canonical
   *  identity projection, and `buildTerminalDisplayInfos` — the dock's paint —
   *  keys off it too. The two spellings are equal today, so restating it here
   *  would be a second source of truth for the very dock/Inspector hue equality
   *  this file promises: a later change to `terminalKey` would silently drift
   *  the Inspector while every current test stayed green.
   *
   *  `WorkSection.test.tsx` is the executable form of that claim and carries
   *  the #2037 regression narrative. */
  const identity = createMemo(() => {
    const git = props.meta.git;
    if (!git) return null;
    // Past the git guard, so `terminalKey` takes its git arm: group = repo
    // name, label = branch. The cwd arm is unreachable here by construction.
    const { group, label } = terminalKey(props.meta);
    const colors = assignColors([group, label]);
    const repoColor = colors.get(group);
    const annotationColor = colors.get(label);
    if (!repoColor || !annotationColor) {
      throw new Error(
        `assignColors missing inspector keys for ${group}/${label}`,
      );
    }
    return { git, repoColor, annotationColor };
  });
  /** The PR facts AND everything folded off them, as ONE value — same reason
   *  `identity()` bundles git with its paint. The rollup's verdict and its
   *  tally now come out of a single read, so they cannot describe two
   *  different PRs, and each `<Show>` body below has one accessor to reach
   *  through instead of five that must agree.
   *
   *  PR facts are live only on the ACTIVE arm; a sleeping terminal has no PR
   *  resolution (same gate the old Pull Request section used). */
  const work = createMemo(() => {
    const arm = activeArm(props.meta);
    if (!arm) return null;
    const pr = prValue(arm.pr);
    const counts = pr ? countChecks(pr.checkRuns) : null;
    return {
      unavailable: prUnavailableSource(arm.pr),
      pr:
        pr && counts
          ? {
              ...pr,
              counts,
              summary: checksSummary(counts),
              runs: [...pr.checkRuns].sort(
                (a, b) => TRIAGE.indexOf(a.outcome) - TRIAGE.indexOf(b.outcome),
              ),
              /** Anything but a clean pass is an exception, and an exception
               *  opens the list on its own. Read off the server's fold — the
               *  same verdict the chip wears. `null` is "no checks
               *  configured", which is not an exception (and renders no list
               *  at all), so it is not read as not-pass. */
              hasException: pr.checks !== null && pr.checks !== "pass",
            }
          : null,
    };
  });
  return (
    <Section title="Work" accent="border-accent">
      <div class="space-y-1.5">
        {/* Identity chips: branch (+worktree glyph) · repo · PR · CI rollup. */}
        <div class="flex flex-wrap items-center gap-1.5">
          <Show when={identity()}>
            {(id) => (
              <>
                <BranchIdentityChip
                  branch={id().git.branch}
                  isWorktree={id().git.isWorktree}
                  color={id().annotationColor}
                />
                <RepoIdentityChip
                  name={id().git.repoName}
                  color={id().repoColor}
                />
              </>
            )}
          </Show>
          <Show when={work()?.pr}>
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
                    const rollup = () => ciRollup(checks(), p().counts);
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

        <Show when={work()?.pr}>
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
        <Show when={work()?.pr}>
          {(p) => (
            <Show when={p().checkRuns.length > 0}>
              <Disclosure summary={p().summary} open={p().hasException}>
                <ul
                  data-testid="inspector-pr-checks"
                  class="flex flex-col gap-0.5 text-[11px]"
                >
                  <For each={p().runs}>
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

        {/* Repo paths — gated on the SAME `identity()` accessor the chips read,
         *  so the file has exactly one "git is present" gate. */}
        <Show when={identity()}>
          {(id) => (
            <Disclosure summary="Repo paths">
              <Row label="Root">
                <span class="font-mono text-fg-3">{id().git.mainRepoRoot}</span>
              </Row>
              <Show when={id().git.isWorktree}>
                <Row label="Worktree">
                  <span class="font-mono text-fg-3">{id().git.repoRoot}</span>
                </Row>
              </Show>
            </Disclosure>
          )}
        </Show>

        <Show when={work()?.unavailable}>
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

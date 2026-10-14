/** The "Work" cluster — what you're working ON, told once.
 *
 *  Branch / repo / PR / CI as a chip row, the PR title, the working directory,
 *  and the deep detail (per-check list, repo paths) behind disclosures.
 *  Replaces the former Directory + Git + Pull Request label/value sections.
 *
 *  Its own file because it is the one section of the Inspector with real
 *  derivation of its own (identity + paint, the check fold) rather than
 *  layout — and because that makes it renderable in a test without dragging
 *  the Inspector's wire-bound siblings into the module graph (Compose and
 *  Ports import `../wire` directly; Attach reaches it transitively through
 *  `useTerminalStore`). */

import { activeArm, type TerminalMetadata } from "@kolu/padi-client/surface";
import type { CiStatusFrame } from "@kolu/padi-client/surface";
import { terminalKey } from "@kolu/terminal-vocab/terminalKey";
import { agoPhrase, compactPhrase } from "@kolu/terminal-vocab/duration";
import { shortSha } from "@odu/run-client/nodeId";
import {
  runStatus,
  scopeSuffix,
  type StatusHue,
} from "@odu/service-client/board";
import {
  STATUS_META,
  type RunNode,
  type RunRow,
} from "@odu/service-client/surface";
import { type CheckStatus, type PrInfo, prValue } from "anyforge/schemas";
import { prUnavailableSource } from "kolu-common/surface";
import { type Component, createMemo, For, Show } from "solid-js";
import { ChecksIndicator, PrStateIcon } from "@kolu/solid-dockrow";
import { ProviderUnavailableContent } from "../terminal/PrUnavailablePopover";
import { assignColors } from "../terminal/terminalDisplay";
import { getClockNow } from "../time/clock";
import Chip from "../ui/Chip";
import Disclosure from "../ui/Disclosure";
import { WorktreeIcon } from "../ui/Icons";
import RepoMonogram from "../ui/RepoMonogram";
import Row from "../ui/Row";
import Section from "../ui/Section";
import type { OduLaneAct, OduLaneOutlet } from "./useOduLaneLink";

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

/** odu's hue column, mapped onto kolu's chip vocabulary — the ONLY place the
 *  two palettes meet. odu assigns meaning to a hue (`BOARD_STATE` / `OUTCOME`,
 *  read through its own `runStatus`); kolu assigns a tone and a glyph to its own
 *  tokens, and nothing here re-reads a run's state.
 *
 *  `violet` is odu's "the owner is gone": a failure to a reader, and kolu's
 *  `Chip` has no violet. */
const ODU_TONE: Record<StatusHue, "neutral" | "ok" | "warning" | "danger"> = {
  grey: "neutral",
  amber: "warning",
  green: "ok",
  red: "danger",
  violet: "danger",
};

/** The glyph a run's hue wears, in the same vocabulary as the CI chip above
 *  (`✕`/`●`/`✓`), plus odu's own `⚠` for the violet "owner lost". */
const ODU_GLYPH: Record<StatusHue, string> = {
  grey: "○",
  amber: "●",
  green: "✓",
  red: "✕",
  violet: "⚠",
};

/** `<sha7>#<seq>` — the ref every odu face prints — plus odu's `+dirty` marker
 *  when the run tested a working tree that merely claimed that commit. `shortSha`
 *  is odu's own; the 7 is its rule, not this file's. */
const oduRef = (run: RunRow): string => {
  const short = shortSha(run.sha);
  const ref = run.seq === null ? short : `${short}#${run.seq}`;
  return run.dirty ? `${ref}+dirty` : ref;
};

/** A lane's glyph colour, keyed by odu's OWN hue column — `STATUS_META` is the
 *  wire's table and odu's faces keep no second one, so this is kolu's mapping
 *  from odu's meanings onto kolu's tokens, not a second assignment of meaning.
 *  Violet is odu's "infrastructure died" (`errored`), which is kolu's `alert`. */
const LANE_HUE: Record<StatusHue, string> = {
  grey: "text-fg-3",
  amber: "text-warning",
  green: "text-ok",
  red: "text-danger",
  violet: "text-alert",
};

/** The tiny label a disclosure's parts wear — the `Section` header's own type,
 *  one tier down, because these labels are inside a disclosure and not heads of
 *  a section. */
const SUBHEAD =
  "pt-1.5 pb-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-fg-3/60";

/** The lane row's layout — shared by the arms that can be clicked and the one
 *  that cannot, so a row is one row whichever element it turns out to be.
 *  `group/lane` is the hover the ID underlines through, which is an affordance
 *  only the clickable arms get. */
const ROW = "group/lane flex min-w-0 items-center gap-1.5";
const INERT = "flex min-w-0 items-center gap-1.5";
const LANE_TITLE = "open in odu";

/** One lane, and the way out to its log page in odu web.
 *
 *  Long output is READ in odu's own page (searchable, coloured, followed live),
 *  so a lane's row is the link to it — the whole row, because every fact on it is
 *  about one attempt. The wrapper is a REAL anchor whenever an address exists
 *  (⌘-click, copy and "open in new tab" are then the browser's own) and a button
 *  when that address needs a door opened first: there is nothing to copy yet, and
 *  the address does not exist until the relay is listening.
 *
 *  WHICH wrapper is a LIVE fact, not a first-paint one: a door opening turns this
 *  row from a button into an anchor with no other event, and cancelling the door
 *  turns it back. So each arm is read through its own memo OUTSIDE the `Show`'s
 *  condition — `Show` hands its child the value it matched, and a branch that read
 *  `act()` again inside that child would take one snapshot of it (`PortRow`'s
 *  ready-href does the same).
 *
 *  With no outlet (a test rendering this section without the wire) the row is
 *  inert text: a lane is worth showing even when nothing offers a way out. */
const LaneRow: Component<{
  lane: RunNode;
  /** Where this lane points, or `undefined` when nothing does. */
  act: () => OduLaneAct | undefined;
  onOpen: () => void;
}> = (props) => {
  const status = () => STATUS_META[props.lane.status];
  const hue = () => LANE_HUE[status().hue];
  /** The address, when there is one — the arm as a REACTIVE VALUE, so the row
   *  becomes an anchor the moment a door is listening. */
  const href = createMemo(() => {
    const act = props.act();
    return act !== undefined && act.kind === "address" ? act.href : undefined;
  });
  /** …and the other arm: a door has to be opened first. */
  const opensDoor = createMemo(() => props.act()?.kind === "door");
  /** The row's own facts, one spelling whichever element wraps them — and a
   *  FUNCTION, not a value, so the reads inside stay reactive per paint (a JSX
   *  value built once at setup would freeze on the lane's first status). */
  const body = () => (
    <>
      <span
        class={`w-3 shrink-0 text-center ${hue()}`}
        title={props.lane.status}
      >
        {status().glyph}
      </span>
      <span
        class={`min-w-0 truncate font-mono group-hover/lane:underline ${hue()}`}
        classList={{ "font-semibold": status().isRed }}
      >
        {props.lane.id}
      </span>
      {/* Attempts beyond the first, then the two facts a lane cannot say in its
       *  id: how long it took, and which machine it landed on. */}
      <Show when={props.lane.attempt > 1}>
        <span class="shrink-0 text-fg-3">#{props.lane.attempt}</span>
      </Show>
      <span class="ml-auto shrink-0 tabular-nums text-fg-3">
        {props.lane.durationMs === null
          ? ""
          : compactPhrase(props.lane.durationMs)}
      </span>
      <span class="shrink-0 font-mono text-fg-3">{props.lane.host ?? ""}</span>
    </>
  );
  return (
    <Show
      when={href()}
      fallback={
        <Show when={opensDoor()} fallback={<div class={INERT}>{body()}</div>}>
          <button
            type="button"
            class={`${ROW} cursor-pointer text-left`}
            title={LANE_TITLE}
            data-testid="inspector-odu-lane-link"
            onClick={() => props.onOpen()}
          >
            {body()}
          </button>
        </Show>
      }
    >
      {(url) => (
        <a
          href={url()}
          target="_blank"
          rel="noopener noreferrer"
          class={ROW}
          title={LANE_TITLE}
          data-testid="inspector-odu-lane-link"
        >
          {body()}
        </a>
      )}
    </Show>
  );
};

/** Repo identity chip — monogram + name in the shared repo-colour frame. The
 *  caller supplies the paint; where that hue comes from is `identity()`'s
 *  account to give, not a second one here. Not a status chip. */
const RepoIdentityChip: Component<{ name: string; color: string }> = (
  props,
) => (
  <span
    class="fleet-hue-chip fleet-hue-chip--with-mono"
    style={{ "--chip-hue": props.color }}
    title={props.name}
    data-testid="inspector-repo-chip"
  >
    <RepoMonogram
      group={props.name}
      color={props.color}
      size="xs"
      data-testid="inspector-repo-monogram"
    />
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
 *  getters, so each value reaches its element through an accessor rather than
 *  an expression sitting in the `<Show>` body waiting to be assigned to a
 *  `const`. That narrows the #2037 hazard, it does not make it unspellable —
 *  `const g = id().git` in that body still re-freezes both chips, which is what
 *  `WorkSection.test.tsx` is there to catch. */
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
  /** The checkout's odu CI readout, already subscribed by the Inspector (see
   *  `useOduCiStatus`): `null` when odu has nothing to say about this checkout —
   *  no daemon on this host, or no runs — in which case nothing here renders.
   *  Optional so the section still renders in a test without a wire. */
  oduCi?: CiStatusFrame | null;
  /** Why the readout FAILED, when it did — a daemon that answered and could not
   *  be read is not "no odu here", so it gets a row of its own instead of the
   *  blank that means absence. */
  oduCiError?: string | null;
  /** How a lane row reaches odu web's log page — the Inspector's own composition
   *  of the forwards vocabulary (`useOduLaneLink`), passed in because this
   *  section is deliberately wire-free (see the header). Absent in a test that
   *  renders without one, in which case a lane row is not a link. */
  oduLane?: OduLaneOutlet;
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
    // No identity chips outside a repo, nor before git has resolved.
    if (props.meta.git.kind !== "repo") return null;
    const git = props.meta.git.info;
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
    const unavailable = prUnavailableSource(arm.pr);
    const pr = prValue(arm.pr);
    if (!pr) return { unavailable, pr: null };
    const counts = countChecks(pr.checkRuns);
    return {
      unavailable,
      pr: {
        ...pr,
        // Overrides the spread: ONE name for this list, already sorted. Keeping
        // both `checkRuns` and a sorted `runs` twin let the JSX gate on one and
        // render the other, and nothing stopped a later edit from rendering the
        // unsorted one — which type-checks and silently drops the triage order.
        checkRuns: [...pr.checkRuns].sort(
          (a, b) => TRIAGE.indexOf(a.outcome) - TRIAGE.indexOf(b.outcome),
        ),
        summary: checksSummary(counts),
        // The rollup is FOLDED HERE rather than published as a `counts` field
        // for the view to re-derive: it is the whole reason the memo bundles,
        // so finishing it here makes "verdict and tally describe one PR"
        // structural instead of a convention the JSX has to keep.
        rollup: pr.checks ? ciRollup(pr.checks, counts) : null,
        /** Anything but a clean pass is an exception, and an exception
         *  opens the list on its own. Read off the server's fold — the
         *  same verdict the chip wears. `null` is "no checks
         *  configured", which is not an exception (and renders no list
         *  at all), so it is not read as not-pass. */
        hasException: pr.checks !== null && pr.checks !== "pass",
      },
    };
  });
  /** odu's readout for this checkout, folded for painting: the chip's rollup,
   *  the lanes in the order padi sent them (already triaged there, so the wire
   *  order IS the painted order), and the recent runs. `null` when odu has
   *  nothing to say, which is the whole of "a non-odu user's Inspector is
   *  unchanged". */
  const odu = createMemo(() => {
    const frame = props.oduCi;
    if (frame === null || frame === undefined || frame.kind !== "status") {
      return null;
    }
    const { run, lanes } = frame.latest;
    // odu's own reading of a row: the verdict once there is one, and where the
    // run has got to until then. A run torn down early settles `incomplete` and
    // must not be painted `failed` — that sends a reader looking for a test
    // that broke.
    const status = runStatus(run);
    const word = status.label;
    // odu's own qualifier for what the run COVERED (`@odu/service-client/board`
    // owns the reading), and `null` when that is the whole pipeline — where a
    // qualifier would say nothing at all.
    const scope = scopeSuffix(run.scope);
    let failed = 0;
    for (const lane of lanes) if (STATUS_META[lane.status].isRed) failed += 1;
    return {
      run,
      lanes,
      recent: frame.recent,
      tone: ODU_TONE[status.hue],
      /** The rollup reads like the CI chip beside it: a count only where there
       *  IS one to state (the failed arm — the sibling counts the verdict's own
       *  bucket, not a neighbouring one), the verdict's own word otherwise, and
       *  always the ref the run is known by, so a chip is never about an
       *  unnamed commit.
       *
       *  A failed run with NO lane failures is not a zero: its lanes have not
       *  arrived, or the nodes stream failed. The chip states the verdict alone
       *  rather than counting a bucket it cannot see into. */
      label: `${ODU_GLYPH[status.hue]} ${
        word === "failed" && failed > 0 ? `${failed} ${word}` : `odu ${word}`
      } ${oduRef(run)}`,
      /** What this list IS: how many lanes, the exceptions among them, and the
       *  run's SCOPE — odu's own qualifier, absent when the run covered the whole
       *  pipeline. A selection is not a pipeline, so "3 lanes" over a
       *  `selectors: ["ci::unit"]` run that said only `ci::unit` would read as
       *  three lanes of an unstarted DAG. */
      summary: `${lanes.length} ${lanes.length === 1 ? "lane" : "lanes"}${
        failed > 0 ? ` · ${failed} failed` : ""
      }${scope === null ? "" : ` · ${scope}`}`,
      /** A run is the thing the user is watching, so its lanes are OPEN by
       *  default — there is no quiet state here worth hiding behind a click. The
       *  disclosure stays a disclosure so it can be collapsed. */
      open: true,
    };
  });
  /** A ticking clock for the recent-runs ages — one interval for the section,
   *  shared with every other age the client prints (`../time/clock`). */
  const now = getClockNow();
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
                  data-testid="inspector-pr-link"
                >
                  <Chip tone="neutral">
                    <PrStateIcon state={p().state} class="h-3 w-3 shrink-0" />
                    <span class="text-accent">#{p().number}</span>
                  </Chip>
                </a>
                <Show when={p().rollup}>
                  {(rollup) => (
                    <Chip tone={rollup().tone} data-testid="inspector-ci">
                      {rollup().label}
                    </Chip>
                  )}
                </Show>
              </>
            )}
          </Show>
          {/* odu's own CI board for this checkout, beside the forge's checks —
           *  and OUTSIDE the PR gate above, because a checkout can have odu
           *  runs with no PR at all. Renders nothing when odu has nothing to
           *  say (no daemon on this host, or no runs for this checkout). */}
          <Show when={odu()}>
            {(ci) => (
              <Chip tone={ci().tone} data-testid="inspector-odu-chip">
                {ci().label}
              </Chip>
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
                  <For each={p().checkRuns}>
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

        {/* odu answered and could not be read: say so. Absence draws nothing
         *  (below); a broken install must not look like one. */}
        <Show when={props.oduCiError}>
          {(reason) => (
            <div
              data-testid="inspector-odu-error"
              class="flex items-start gap-1.5 pt-1 text-[11px] leading-snug text-warning"
            >
              <span aria-hidden="true">⚠</span>
              <span class="min-w-0 break-words">
                odu CI unavailable — {reason()}
              </span>
            </div>
          )}
        </Show>

        {/* odu's breakdown — reference tier, the same shape as the check list
         *  above: a rollup chip in the row, the detail behind one disclosure.
         *  Lanes of the LATEST run (already in triage order from padi), then
         *  this checkout's recent runs, newest first. */}
        <Show when={odu()}>
          {(ci) => (
            <Disclosure
              summary={ci().summary}
              open={ci().open}
              data-testid="inspector-odu"
            >
              <Show when={ci().lanes.length > 0}>
                <div class={SUBHEAD}>Lanes</div>
                <ul
                  data-testid="inspector-odu-lanes"
                  class="flex flex-col gap-0.5 text-[11px]"
                >
                  <For each={ci().lanes}>
                    {(lane) => (
                      <li>
                        <LaneRow
                          lane={lane}
                          act={() => props.oduLane?.act(ci().run, lane)}
                          onOpen={() => props.oduLane?.open(ci().run, lane)}
                        />
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <div class={SUBHEAD}>Recent runs</div>
              <ul
                data-testid="inspector-odu-recent"
                class="flex flex-col gap-0.5 text-[11px]"
              >
                <For each={ci().recent}>
                  {(run, index) => (
                    <li class="flex min-w-0 items-baseline gap-1.5">
                      <span class="min-w-0 truncate font-mono">
                        {oduRef(run)}
                      </span>
                      <span class={`shrink-0 ${LANE_HUE[runStatus(run).hue]}`}>
                        {runStatus(run).label}
                      </span>
                      {/* The same compact qualifier the summary carries, and
                       *  only when the run was scoped: a row whose run covered
                       *  the whole pipeline has nothing extra to say, and one
                       *  line is what keeps the list scannable. */}
                      <Show when={scopeSuffix(run.scope)}>
                        {(scope) => (
                          <span
                            class="min-w-0 truncate text-fg-3"
                            title={scope()}
                          >
                            {scope()}
                          </span>
                        )}
                      </Show>
                      {/* The head of this list IS the run the chip above is
                       *  about — said, rather than left to be inferred from an
                       *  ordering. */}
                      <Show when={index() === 0}>
                        <span class="shrink-0 text-fg-3">current</span>
                      </Show>
                      <span class="ml-auto shrink-0 text-fg-3">
                        {agoPhrase(run.createdAt, now())}
                      </span>
                    </li>
                  )}
                </For>
              </ul>
            </Disclosure>
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

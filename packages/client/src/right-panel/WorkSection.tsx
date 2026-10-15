/** The "Work" cluster — what you're working ON, told once.
 *
 *  Branch / repo / PR / CI as a chip row, the PR title, the working directory,
 *  and the deep detail (per-check list, repo paths) behind disclosures.
 *  Replaces the former Directory + Git + Pull Request label/value sections.
 *
 *  Its own file because it is the one section of the Inspector with real
 *  derivation of its own (identity + paint, the check fold) rather than layout.
 *
 *  It also owns ONE subscription — odu's `checkout` stream, through padi's odu
 *  sibling — because the input that keys it is the git fact this section already
 *  reads: a reader that lived a level up would re-derive "which checkout is
 *  focused" beside the one here and the two would answer differently the moment
 *  a `cd` landed between them. The subscription is SHOWN-GATED, so a hidden
 *  Inspector tab (`RightPanel` keeps both mounted) dials nothing. Everything
 *  ELSE the section needs from the wire — how a row reaches odu web — arrives as
 *  a prop, so the link decision stays assertable without a forwards wire. */

import { activeArm, type TerminalMetadata } from "@kolu/padi-client/surface";
import { terminalKey } from "@kolu/terminal-vocab/terminalKey";
import { agoPhrase, compactPhrase } from "@kolu/terminal-vocab/duration";
import { shortSha } from "@odu/run-client/nodeId";
import { logHash, runHash } from "@odu/service-client/routes";
import {
  type LaneSpan,
  laneSpan,
  runElapsedMs,
  runStatus,
  scopeSuffix,
  type StatusHue,
  timelineTicks,
} from "@odu/service-client/board";
import {
  STATUS_META,
  type RunNode,
  type RunRow,
} from "@odu/service-client/surface";
import { type CheckStatus, type PrInfo, prValue } from "anyforge/schemas";
import { prUnavailableSource } from "kolu-common/surface";
import { type Component, createMemo, For, type JSX, Show } from "solid-js";
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
import { activeHost, interpretClientError, padiMap } from "../wire";
import { usePanelShown } from "./panelShown";
import type { OduLinkAct, OduLinkOutlet } from "./useOduLink";

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

/** A lane's triage class — what's broken, what's still moving, what's done.
 *  odu's own columns decide it (`isRed`, `progress`), so this file states an
 *  ORDER over lanes, not a second assignment of meaning to a status; the lanes
 *  arrive in the run's own schedule and are sorted here because the order a
 *  reader wants is this face's. */
const laneRank = (lane: RunNode): number => {
  const meta = STATUS_META[lane.status];
  return meta.isRed ? 0 : meta.progress === "running" ? 1 : 2;
};

/** The disclosure's summary line — "1 failed · 2 running · 6 passed", the
 *  non-empty buckets in triage order. No verdict branching: the order carries
 *  it, and the chip above already states it. */
const checksSummary = (counts: Record<CheckStatus, number>): string =>
  TRIAGE.filter((o) => counts[o] > 0)
    .map((o) => `${counts[o]} ${OUTCOME[o].word}`)
    .join(" · ");

/** Where a LANE lives in odu web: its own attempt's log, or — for a lane that
 *  never started — the run page.
 *
 *  odu names "no attempt yet" as an EMPTY log key (`RunNode.logKey`: a node on
 *  the roster with no attempt carries `""` rather than a fabricated attempt 1,
 *  "which would name evidence that does not exist"), so that is the fact read
 *  here. A lane with no log has no log page to open; the run page is where it is
 *  read, which is also what odu's own router does with an address naming no
 *  attempt. */
const laneHash = (
  run: Pick<RunRow, "runId">,
  lane: Pick<RunNode, "logKey">,
): string => (lane.logKey === "" ? runHash(run.runId) : logHash(lane.logKey));

/** odu's own site — the heading that introduces the readout names the tool and
 *  points at it, because a reader who has never heard of odu cannot tell what a
 *  lane list is made of. */
const ODU_URL = "https://juspay.github.io/odu/";

/** How kolu paints a hue odu assigned — the ONE place the two palettes meet,
 *  one row per hue rather than one table per attribute. odu assigns MEANING to
 *  a hue (`BOARD_STATE` / `OUTCOME`, read through its own `runStatus`); kolu
 *  assigns the chip tone, the glyph and the text colour, and nothing here
 *  re-reads a run's state. Row-per-hue is also what keeps a sixth hue from
 *  landing in one of three lists and not the others — the shape `OUTCOME` above
 *  already keeps for check outcomes.
 *
 *  `violet` is odu's "the owner is gone": a failure to a reader, and kolu's
 *  `Chip` has no violet, so it wears `danger` there and `alert` in text.
 *
 *  `text` paints the TIMELINE BAR too, through `bg-current`: a second entry for
 *  the bar's own colour would be a second place for a hue to disagree with its
 *  glyph, which is the whole thing this table exists to prevent. */
const ODU_HUE: Record<
  StatusHue,
  { tone: "neutral" | "ok" | "warning" | "danger"; glyph: string; text: string }
> = {
  grey: { tone: "neutral", glyph: "○", text: "text-fg-3" },
  amber: { tone: "warning", glyph: "●", text: "text-warning" },
  green: { tone: "ok", glyph: "✓", text: "text-ok" },
  red: { tone: "danger", glyph: "✕", text: "text-danger" },
  violet: { tone: "danger", glyph: "⚠", text: "text-alert" },
};

/** `<sha7>#<seq>` — the ref every odu face prints — plus odu's `+dirty` marker
 *  when the run tested a working tree that merely claimed that commit. `shortSha`
 *  is odu's own; the 7 is its rule, not this file's. */
const oduRef = (run: RunRow): string => {
  const short = shortSha(run.sha);
  const ref = run.seq === null ? short : `${short}#${run.seq}`;
  return run.dirty ? `${ref}+dirty` : ref;
};

/** The tiny label a disclosure's parts wear — the `Section` header's own type,
 *  one tier down, because these labels are inside a disclosure and not heads of
 *  a section. */
const SUBHEAD =
  "pt-1.5 pb-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-fg-3/60";

/** THE ODU LISTS ARE TABLES, and these three strings are where that lives.
 *
 *  Each `<ul>` is the grid and each row spans it with `grid-cols-subgrid`, so
 *  every cell measures against the WHOLE list rather than its own row: the
 *  durations line up under each other, the hosts start at one x, and a long
 *  lane id shortens its own cell instead of shoving the numbers sideways. The
 *  rows used to be independent flex lines, where `ml-auto` had nothing to push
 *  against (the clickable element is not full-width) and no column agreed with
 *  the one above it.
 *
 *  TWO levels carry `ROW`: the `<li>`, which is the grid's own item, and the
 *  clickable element inside it — otherwise the cells are laid out against the
 *  anchor rather than against the list. `group/lane` is the hover the id
 *  underlines through, an affordance only the clickable arms get.
 *
 *  A cell is ALWAYS present, even when it has nothing to say: a row that
 *  omitted its empty attempt or scope would shift every later column left and
 *  take the alignment with it. */
const LANE_GRID =
  "grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(3rem,1.2fr)_auto_auto] gap-x-1.5 gap-y-0.5 text-[11px]";
const RECENT_GRID =
  "grid grid-cols-[minmax(0,auto)_auto_auto_minmax(0,1fr)_auto_auto] gap-x-1.5 gap-y-0.5 text-[11px]";
const ROW = "col-span-full grid grid-cols-subgrid items-center";
/** …and a chip's own chrome, which is a control rather than a row. */
const CHIP_ROW = "inline-flex";
const ODU_TITLE = "open in odu";

/** One lane: its own facts, where it sat in the run, and the way out to that
 *  attempt's log in odu web.
 *
 *  Long output is READ in odu's own page (searchable, coloured, followed live),
 *  so a lane's row is the link to it — the whole row, because every fact on it is
 *  about one attempt. */
const LaneRow: Component<{
  lane: RunNode;
  /** WHERE this lane sat in the run, from odu's own geometry — `null` for a
   *  lane that has not started, which draws no bar: an empty track is the
   *  signal that it is still waiting on a machine. */
  span: LaneSpan | null;
  /** The run's own start — the origin the bar's `started +…` is measured from.
   *  The run row's `createdAt` rather than a second reading of it. */
  runStartedAt: number;
}> = (props) => {
  const status = () => STATUS_META[props.lane.status];
  const hue = () => ODU_HUE[status().hue].text;
  /** What the bar says when you point at it — the two facts its geometry draws,
   *  in the words the row's own cells use. */
  const barTitle = (): string =>
    `started +${compactPhrase(Math.max(0, (props.lane.startedAt ?? 0) - props.runStartedAt))} · ${
      props.lane.durationMs === null
        ? "still running"
        : `took ${compactPhrase(props.lane.durationMs)}`
    }`;
  return (
    <>
      <span class={`w-3 text-center ${hue()}`} title={props.lane.status}>
        {status().glyph}
      </span>
      <span
        class={`min-w-0 truncate font-mono group-hover/lane:underline ${hue()}`}
        classList={{ "font-semibold": status().isRed }}
      >
        {props.lane.id}
      </span>
      {/* Attempts beyond the first, then the two facts a lane cannot say in its
       *  id: how long it took, and which machine it landed on. Each keeps its
       *  cell when it has nothing to say — an omitted cell would slide the rest
       *  of the row out from under the column above it. */}
      <span class="text-fg-3">
        {props.lane.attempt > 1 ? `#${props.lane.attempt}` : ""}
      </span>
      {/* THE TIMELINE — a Gantt, so the bar's POSITION says when this lane ran
       *  and the column says what overlapped what. The bar wears the hue's TEXT
       *  class and paints with `bg-current`, so it cannot disagree with the
       *  glyph; a running lane's tail is hatched in that same colour and grows
       *  with the clock, because a solid end would claim it had finished. */}
      <span class="relative h-2.5 self-center rounded-sm bg-fg-3/10">
        <Show when={props.span}>
          {(span) => (
            <span
              data-testid="inspector-odu-lane-bar"
              class={`absolute inset-y-0 min-w-0.5 rounded-sm opacity-60 ${hue()}`}
              classList={{
                "bg-current": props.lane.durationMs !== null,
                "bg-[repeating-linear-gradient(135deg,currentColor_0_3px,transparent_3px_6px)]":
                  props.lane.durationMs === null,
              }}
              style={{
                left: `${span().left * 100}%`,
                width: `${span().width * 100}%`,
              }}
              title={barTitle()}
            />
          )}
        </Show>
      </span>
      <span class="text-right tabular-nums text-fg-3">
        {props.lane.durationMs === null
          ? ""
          : compactPhrase(props.lane.durationMs)}
      </span>
      <span class="font-mono text-fg-3">{props.lane.host ?? ""}</span>
    </>
  );
};

/** THE way an odu surface in this section reaches odu web — one wrapper for the
 *  lane rows, the recent-runs rows and the chip, so the reach decision, the
 *  "open in odu" affordance and the door-opening click exist once.
 *
 *  A REAL anchor whenever an address exists (⌘-click, copy and "open in new tab"
 *  are then the browser's own) and a button when that address needs a door
 *  opened first: there is nothing to copy yet, and the address does not exist
 *  until the relay is listening.
 *
 *  WHICH wrapper is a LIVE fact, not a first-paint one: a door opening turns the
 *  element from a button into an anchor with no other event, and cancelling the
 *  door turns it back. So the arms are read through memos OUTSIDE the `Show`'s
 *  condition — `Show` hands its child the value it matched, and a branch that
 *  read `act()` again inside that child would take one snapshot of it
 *  (`PortRow`'s ready-href does the same).
 *
 *  With no outlet (a test rendering this section without the wire) the content
 *  is inert: a row is worth showing even when nothing offers a way out. */
const OduLink: Component<{
  /** Where this subject lives, or `undefined` when nothing points at it. */
  act: () => OduLinkAct | undefined;
  onOpen: () => void;
  /** The link's own testid — omitted where the content marks itself. */
  testid?: string;
  /** What the element's own row looks like (`ROW`, `INERT`, …). */
  class: string;
  children: JSX.Element;
}> = (props) => {
  /** The address, when there is one — the arm as a REACTIVE VALUE, so the row
   *  becomes an anchor the moment a door is listening. */
  const href = createMemo(() => {
    const act = props.act();
    return act !== undefined && act.kind === "address" ? act.href : undefined;
  });
  /** …and the other arm: a door has to be opened first. */
  const opensDoor = createMemo(() => props.act()?.kind === "door");
  return (
    <Show
      when={href()}
      fallback={
        <Show
          when={opensDoor()}
          fallback={<div class={props.class}>{props.children}</div>}
        >
          <button
            type="button"
            class={`${props.class} group/lane cursor-pointer text-left`}
            title={ODU_TITLE}
            data-testid={props.testid}
            onClick={() => props.onOpen()}
          >
            {props.children}
          </button>
        </Show>
      }
    >
      {(url) => (
        <a
          href={url()}
          target="_blank"
          rel="noopener noreferrer"
          class={`${props.class} group/lane`}
          title={ODU_TITLE}
          data-testid={props.testid}
        >
          {props.children}
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
  /** How an odu surface here reaches odu web — the Inspector's own composition
   *  of the forwards vocabulary (`useOduLink`), passed in rather than opened
   *  here so a test can assert WHICH address a row offers (and whether it is an
   *  address at all) without a forwards wire. Absent in a test that renders
   *  without one, in which case the rows are inert text. */
  odu?: OduLinkOutlet;
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
  const shown = usePanelShown();
  /** This checkout's CI, read from ODU ITSELF: padi carries odu's own surface as
   *  a sibling (`entry(h).odu`), so this is odu's `checkout` stream and not a
   *  fold of it assembled a hop away.
   *
   *  The input is the FOCUSED TERMINAL's own repo root — a stable KEY rather
   *  than a live fact, so a `cd` into another checkout simply re-keys the
   *  subscription and a re-subscribe after a dropped transport replays an input
   *  that is still true. `null` is "do not subscribe": a terminal outside a repo
   *  has no checkout to ask about, a sleeping one has no live arm to read, and a
   *  hidden panel is not a reader.
   *
   *  SHOWN-GATED because the gate is what makes "nothing dials while nobody is
   *  looking" true END TO END: padi's re-serve dials odu on the FIRST subscriber
   *  and lets the link go a grace after the last one leaves, and `RightPanel`
   *  keeps this tab MOUNTED while it is hidden — so without the gate a closed
   *  Inspector would hold an odu link open on every host it ever visited.
   *
   *  `useEntry(activeHost)` rather than a point lens: the Inspector describes the
   *  focused pane, which lives on the active host, so a host switch must re-key
   *  the readout with it. */
  const checkout = padiMap.useEntry(activeHost).odu.streams.checkout.use(
    () => {
      const git = activeArm(props.meta)?.git;
      return !shown() || git === undefined || git.kind !== "repo"
        ? null
        : { repoRoot: git.info.repoRoot };
    },
    {
      // A `StreamSpec` declares no error policy on the spec, so the use site
      // supplies one — through the ONE interpreter, like every other stream
      // (`scopedSub`: the shown host toasts, a background host logs).
      onError: (err) =>
        interpretClientError(
          { kind: "scopedSub", label: "odu CI status" },
          err,
          {
            key: activeHost(),
          },
        ),
    },
  );
  /** odu's readout for this checkout, folded for painting: the chip's rollup,
   *  the lanes in the run's own schedule sorted into this face's triage, and the
   *  recent runs. `null` when odu has nothing to say, which is the whole of "a
   *  non-odu user's Inspector is unchanged". */
  const odu = createMemo(() => {
    const frame = checkout();
    // `latest === null` IS "nothing to show": a checkout nobody has run CI in,
    // and — because padi's relay answers `CHECKOUT_NONE` for an absent daemon —
    // a machine with no odu on it. The two are deliberately the same frame and
    // deliberately render the same nothing; a missing install is not a fact this
    // section has any business announcing.
    if (frame === undefined || frame.latest === null) return null;
    const { run, nodes } = frame.latest;
    // odu sends the run's own schedule (the order a dashboard paints); the
    // order a READER wants first is this face's triage, beside the check list's.
    const lanes = [...nodes].sort((a, b) => laneRank(a) - laneRank(b));
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
      tone: ODU_HUE[status.hue].tone,
      /** The rollup reads like the CI chip beside it: a count only where there
       *  IS one to state (the failed arm — the sibling counts the verdict's own
       *  bucket, not a neighbouring one), the verdict's own word otherwise, and
       *  always the ref the run is known by, so a chip is never about an
       *  unnamed commit.
       *
       *  A failed run with NO lane failures is not a zero: its lanes have not
       *  arrived, or the nodes stream failed. The chip states the verdict alone
       *  rather than counting a bucket it cannot see into. */
      label: `${ODU_HUE[status.hue].glyph} ${
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
    };
  });
  /** A ticking clock for the recent-runs ages and for the one run still going —
   *  a settled run's duration is a fact about the run and does not read it. One
   *  interval for the section, shared with every other age the client prints
   *  (`../time/clock`). */
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
              <OduLink
                act={() => props.odu?.act(runHash(ci().run.runId))}
                onOpen={() => props.odu?.open(runHash(ci().run.runId))}
                class={CHIP_ROW}
              >
                {/* The chip marks ITSELF, so a reader finds the same surface
                 *  whether or not an address exists yet; the element around it
                 *  is what turns into the link. */}
                <Chip tone={ci().tone} data-testid="inspector-odu-chip">
                  {ci().label}
                </Chip>
              </OduLink>
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

        {/* The READOUT itself failed — a frame this client could not decode, or
         *  a member the relay could not open. Absence is not this row: an absent
         *  odu answers a frame (`CHECKOUT_NONE`) and draws nothing, so anything
         *  that reaches here is a subscription that is broken rather than quiet. */}
        <Show when={checkout.error()?.message}>
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
         *  Lanes of the LATEST run, triaged here, then this checkout's recent
         *  runs, newest first. */}
        <Show when={odu()}>
          {(ci) => (
            <Disclosure
              summary={
                <>
                  {/* The heading names odu for a reader who has not heard of it,
                   *  and links to its site: the count and the scope beside it
                   *  are meaningless without the thing they belong to. */}
                  <a
                    href={ODU_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="odu: the CI runner for this checkout"
                    class="hover:underline"
                    data-testid="inspector-odu-link"
                  >
                    CI by odu ↗
                  </a>
                  {` · ${ci().summary}`}
                </>
              }
              // Open by default: a run is the thing being watched, so there is
              // no quiet state here worth hiding behind a click. It stays a
              // disclosure so it can still be collapsed.
              open
              data-testid="inspector-odu"
            >
              <Show when={ci().lanes.length > 0}>
                <div class={SUBHEAD}>Lanes</div>
                <ul data-testid="inspector-odu-lanes" class={LANE_GRID}>
                  {/* THE SCALE the bars are read against, over the track column
                   *  alone — placed by column rather than as a full row of
                   *  empty cells, so the axis cannot drift from the track it
                   *  labels. Ticks are odu's own, like the geometry: a
                   *  hand-rolled scale here would be a second answer to where
                   *  the middle of a run is. */}
                  <li
                    data-testid="inspector-odu-lane-axis"
                    aria-hidden="true"
                    class="relative col-start-4 h-3 text-[10px] text-fg-3"
                  >
                    <For each={timelineTicks(runElapsedMs(ci().run, now()))}>
                      {(tick, index) => (
                        <span
                          class="absolute top-0 border-l border-edge pl-0.5"
                          classList={{
                            "-translate-x-full border-l-0 border-r pr-0.5 pl-0":
                              index() === 3,
                          }}
                          style={{ left: `${tick.at * 100}%` }}
                        >
                          {tick.label}
                        </span>
                      )}
                    </For>
                  </li>
                  <For each={ci().lanes}>
                    {(lane) => (
                      <li class={ROW}>
                        <OduLink
                          act={() => props.odu?.act(laneHash(ci().run, lane))}
                          onOpen={() =>
                            props.odu?.open(laneHash(ci().run, lane))
                          }
                          testid="inspector-odu-lane-link"
                          class={ROW}
                        >
                          <LaneRow
                            lane={lane}
                            span={laneSpan(lane, ci().run, now())}
                            runStartedAt={ci().run.createdAt}
                          />
                        </OduLink>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <div class={SUBHEAD}>Recent runs</div>
              <ul data-testid="inspector-odu-recent" class={RECENT_GRID}>
                <For each={ci().recent}>
                  {(run, index) => (
                    <li class={ROW}>
                      <OduLink
                        act={() => props.odu?.act(runHash(run.runId))}
                        onOpen={() => props.odu?.open(runHash(run.runId))}
                        testid="inspector-odu-run-link"
                        class={ROW}
                      >
                        <span class="min-w-0 truncate font-mono group-hover/lane:underline">
                          {oduRef(run)}
                        </span>
                        <span class={ODU_HUE[runStatus(run).hue].text}>
                          {runStatus(run).label}
                        </span>
                        {/* How long the run TOOK — odu's own rule, which stops
                         *  at the run's verdict, so a settled row holds still
                         *  and only a run still going ticks with the clock. */}
                        <span
                          data-testid="inspector-odu-run-took"
                          class="text-right tabular-nums text-fg-3"
                        >
                          {compactPhrase(runElapsedMs(run, now()))}
                        </span>
                        {/* The same compact qualifier the summary carries, and
                         *  only when the run was scoped: a row whose run covered
                         *  the whole pipeline has nothing extra to say — the
                         *  cell stays either way, because the columns after it
                         *  are measured down the whole list. */}
                        <span
                          class="min-w-0 truncate text-fg-3"
                          title={scopeSuffix(run.scope) ?? undefined}
                        >
                          {scopeSuffix(run.scope) ?? ""}
                        </span>
                        {/* The head of this list IS the run the chip above is
                         *  about — said, rather than left to be inferred from an
                         *  ordering. */}
                        <span class="text-fg-3">
                          {index() === 0 ? "current" : ""}
                        </span>
                        <span class="text-right text-fg-3">
                          {agoPhrase(run.createdAt, now())}
                        </span>
                      </OduLink>
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

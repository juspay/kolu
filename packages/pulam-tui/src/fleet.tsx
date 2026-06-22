/**
 * The OpenTUI/Solid view for `pulam-tui fleet` — pulam P3 PR2b.
 *
 * A LIVE, colourful multi-host board: per-host groups of terminals, every
 * `awaiting_user` agent floated to the top across the whole fleet, a breathing
 * amber alert strip when something needs you, working spinners, and honest
 * unreachable / skew / connecting / empty host states. Where PR2a's single-host
 * table was a frozen snapshot whose only live cell was the clock, the fleet rows
 * themselves update live: `fleet.ts` mirrors each host's `awareness` collection
 * and pushes deltas into a Solid store; this paints it.
 *
 * The DECISIONS about the data (grouping, the needs-you sort, summary, tones)
 * live in the pure `render.ts` (`projectFleet`), unit-tested under Node; this
 * module maps a tone to a colour, lays out cells, and animates. Liveness is
 * SolidJS-canonical and no other way — `createSignal` updated by intervals in
 * `onMount`, cleared in `onCleanup`, read in JSX so the reconciler repaints only
 * the changed cells. No requestRender, no fps cap, no imperative redraw.
 *
 * `.tsx`, loaded only under Bun, imported dynamically by `bin.ts` ONLY for the
 * interactive `fleet` board (the `--json` path never touches the renderer).
 */

import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  type FleetConnector,
  type FleetHandle,
  type FleetSink,
  startFleet,
} from "./fleet.ts";
import type { FleetHost } from "./hosts.ts";
import { HEADER, HOST, LIVE, SUBTLE, TITLE, TONE_COLOR } from "./palette.ts";
import type { FleetHostState, FleetHostStatus } from "./fleetTypes.ts";
import {
  cell,
  type FieldTone,
  flattenRows,
  type FleetGroup,
  type FleetMode,
  type FleetRow,
  type FleetView,
  gitCell,
  gitDetail,
  type GitDetailView,
  projectFleet,
  relativeTime,
  step,
} from "./render.ts";
import { runTui } from "./runtime.tsx";

// A working agent's glyph cycles these so the row visibly turns — the fleet's
// per-row liveness proof, beside the header clock. `need` pulses a steady dot
// (the alert strip carries the breathing); `idle` is a calm ring.
const SPINNER = ["◜", "◝", "◞", "◟"] as const;
const NEED_GLYPH = "●";
const IDLE_GLYPH = "○";

// Fixed column widths (chars). `repo·branch` is NOT fixed — it absorbs the
// terminal's remaining width (see `whereWidth`), so a wide terminal shows long
// branches in full instead of clipping them into an 80-col straitjacket. The
// host-less modes (`needs`/`agent`) prepend a `W_HOST` column (no per-host group
// header to name the machine), which `whereWidth` subtracts from the slack.
const W_CURSOR = 2; // the leading ▸ selection cursor (drives the drill-in)
const W_LIVE = 2; // the leading green activity dot (output moving right now)
const W_GLYPH = 2;
const W_HOST = 12;
const W_AGENT = 8;
const W_GIT = 8; // the live working-tree cell, "✎12 ↑3" — longer counts ellipsize
const W_PR = 15; // "#12345 merged ✓" — wide enough that the check glyph never clips
const W_STATE = 13;
const W_RECENCY = 5; // the trailing "24s"/"3h"/"364d" column, reserved off the slack
const MIN_WHERE = 12; // floor so a narrow terminal truncates rather than vanishes

/** The `repo·branch` column's width: the terminal's usable width (minus the
 *  box's padding={1} either side) less every fixed column, so it fills the slack
 *  a wide terminal offers and only truncates when the terminal is genuinely
 *  narrow. Shared by every row (a pure function of width + mode) so the columns
 *  stay aligned. */
function whereWidth(termWidth: number, showHost: boolean): number {
  const fixed =
    W_CURSOR +
    W_LIVE +
    W_GLYPH +
    (showHost ? W_HOST : 0) +
    W_AGENT +
    W_GIT +
    W_PR +
    W_STATE +
    W_RECENCY;
  return Math.max(MIN_WHERE, termWidth - 2 - fixed);
}

/** The leading glyph for a row, animated for a working agent. */
function rowGlyph(row: FleetRow, frame: number): string {
  if (row.urgency === "need") return NEED_GLYPH;
  if (row.urgency === "work")
    return SPINNER[frame % SPINNER.length] ?? IDLE_GLYPH;
  return IDLE_GLYPH;
}

/** The host group header's badge — the honest degraded states. `connected`
 *  shows nothing extra (the count says it all); the rest read distinctly. */
function hostBadge(status: FleetHostStatus | undefined): {
  text: string;
  tone: FieldTone;
} {
  if (!status) return { text: "", tone: "muted" };
  switch (status.kind) {
    case "connecting":
      return { text: "connecting…", tone: "pending" };
    case "connected":
      return { text: "", tone: "muted" };
    case "skew":
      return {
        text: `skew ${status.hostVersion}≠${status.localVersion}`,
        tone: "fail",
      };
    case "unreachable":
      return { text: `unreachable — ${status.reason}`, tone: "fail" };
  }
}

/** One terminal row: animated glyph, [host,] agent, repo·branch, PR, state,
 *  recency. `showHost` is set in the host-less `needs`/`agent` modes, where there
 *  is no per-host group header — so the row itself names the machine the agent is
 *  on (the core fleet promise: who is blocked, and WHERE). In host mode the host
 *  is the group header, so the column is dropped as redundant and `where` keeps
 *  its full width. */
function Row(props: {
  row: FleetRow;
  frame: () => number;
  now: () => number;
  termWidth: () => number;
  selectedKey: () => string | null;
  showHost?: boolean;
}) {
  const whereW = () => whereWidth(props.termWidth(), props.showHost ?? false);
  const selected = () => props.selectedKey() === props.row.key;
  // The compact working-tree cell is a projection of the row's raw `gitStatus`,
  // derived here at its read site — the row carries only the raw status (one git
  // value), mirroring how the drill-in pane derives `gitDetail(row)` on demand.
  const git = createMemo(() => gitCell(props.row.gitStatus));
  return (
    <box flexDirection="row">
      {/* Selection cursor — ▸ on the highlighted row, blank otherwise. ↑/↓ move
          it; Enter opens that row's repo in the drill-in git-status detail pane. */}
      <text fg={HOST}>{cell(selected() ? "▸" : "", W_CURSOR)}</text>
      {/* Live-output dot — green when this terminal is moving bytes right now (the
          `activity` stream), blank otherwise. Orthogonal to the urgency glyph: one
          says "output flowing", the other says "agent blocked/working/idle". */}
      <text fg={LIVE}>{cell(props.row.live ? "●" : "", W_LIVE)}</text>
      <text fg={TONE_COLOR[props.row.state.tone]}>
        {cell(rowGlyph(props.row, props.frame()), W_GLYPH)}
      </text>
      <text fg={HOST}>
        {props.showHost ? cell(props.row.host, W_HOST) : ""}
      </text>
      <text fg={TONE_COLOR[props.row.agent.tone]}>
        {cell(props.row.agent.text, W_AGENT)}
      </text>
      <text fg={TONE_COLOR[props.row.where.tone]}>
        {cell(props.row.where.text, whereW())}
      </text>
      {/* Live working-tree cell — the changed-file count + branch ahead/behind,
          repainted on each `subscribeRepoChange` pulse (R4.7). Derived from the
          row's raw `gitStatus` here, not stored pre-projected on the row. */}
      <text fg={TONE_COLOR[git().tone]}>{cell(git().text, W_GIT)}</text>
      <text fg={TONE_COLOR[props.row.pr.tone]}>
        {cell(props.row.pr.text, W_PR)}
      </text>
      <text fg={TONE_COLOR[props.row.state.tone]}>
        {cell(props.row.state.text, W_STATE)}
      </text>
      {/* Recency is read from the raw `activeAt` against the live `now()` here,
          not pre-formatted in the projection — so the 1s clock repaints only
          this cell, never the whole board. */}
      <text fg={TONE_COLOR.muted}>
        {relativeTime(props.row.activeAt, props.now())}
      </text>
    </box>
  );
}

/** One group — a host (with its status badge) or an urgency section. The badge
 *  is always a `<text>` (empty content when connected) and the rows are a `<For>`
 *  with an element fallback: OpenTUI rejects a bare/empty string under a `<box>`,
 *  so every child stays a concrete `<text>`/`<box>` element. `showHost` is set in
 *  `agent` mode (sections cut across hosts, so each row must name its machine)
 *  and clear in `host` mode (the group header already IS the host). */
function Group(props: {
  group: FleetGroup;
  frame: () => number;
  now: () => number;
  termWidth: () => number;
  selectedKey: () => string | null;
  showHost?: boolean;
}) {
  const badge = hostBadge(props.group.status);
  const count = props.group.rows.length;
  return (
    <box flexDirection="column" marginTop={1}>
      <box flexDirection="row">
        <text fg={HOST}>{"▌ "}</text>
        <text fg={HEADER}>{props.group.label}</text>
        <text
          fg={SUBTLE}
        >{`  ·  ${count} terminal${count === 1 ? "" : "s"}`}</text>
        <text fg={TONE_COLOR[badge.tone]}>
          {badge.text ? `   ${badge.text}` : ""}
        </text>
      </box>
      <For
        each={props.group.rows}
        fallback={<text fg={TONE_COLOR.muted}>{"  no terminals"}</text>}
      >
        {(row) => (
          <Row
            row={row}
            frame={props.frame}
            now={props.now}
            termWidth={props.termWidth}
            selectedKey={props.selectedKey}
            showHost={props.showHost}
          />
        )}
      </For>
    </box>
  );
}

/** The drill-in detail pane — the selected row's repo opened to its live
 *  `git status`: the repo·branch title with ahead/behind, the
 *  staged·modified·untracked summary, and the changed-file list (the same
 *  `subscribeRepoChange`→`getStatus` data the row's cell summarizes, R4.7). Enter
 *  opens it, Esc closes it. Every child is a concrete element (OpenTUI rejects a
 *  bare string under a box). */
function DetailPane(props: { detail: () => GitDetailView }) {
  return (
    <box flexDirection="column" marginTop={1}>
      <text fg={SUBTLE}>{"─".repeat(48)}</text>
      <box flexDirection="row">
        <text fg={HEADER}>{props.detail().title}</text>
        <text fg={SUBTLE}>
          {props.detail().tracking ? `   ${props.detail().tracking}` : ""}
        </text>
      </box>
      <text fg={TONE_COLOR.muted}>{props.detail().summary}</text>
      <For
        each={props.detail().files}
        fallback={<text fg={TONE_COLOR.muted}>{""}</text>}
      >
        {(f) => (
          <box flexDirection="row">
            <text fg={TONE_COLOR[f.tone]}>{cell(f.code, 3)}</text>
            <text fg={TONE_COLOR.plain}>{f.path}</text>
          </box>
        )}
      </For>
      <text fg={SUBTLE}>
        {props.detail().more > 0 ? `  … +${props.detail().more} more` : ""}
      </text>
    </box>
  );
}

/** The breathing alert strip — amber when an agent across the fleet awaits you,
 *  calm (empty) otherwise. Always a `<text>` (never a conditional that could
 *  yield a bare string); the amber alternates brightness on the animation frame
 *  so a glance from across the room catches it before you've read a word. */
function AlertStrip(props: { view: () => FleetView; frame: () => number }) {
  const alerting = () => props.view().alertHosts.length > 0;
  const text = () => {
    const v = props.view();
    if (v.alertHosts.length === 0) return "";
    const n = v.summary.needYou;
    return `${NEED_GLYPH} ${n} agent${n === 1 ? "" : "s"} need you — ${v.alertHosts.join(", ")}`;
  };
  const color = () =>
    !alerting() ? SUBTLE : props.frame() % 8 < 4 ? "#f0b860" : "#b9863a";
  return <text fg={color()}>{text()}</text>;
}

/** The footer tally — needs / working / idle, and whether any host is down. */
function Summary(props: { view: () => FleetView }) {
  const s = () => props.view().summary;
  return (
    <box flexDirection="row" marginTop={1}>
      <text fg={TONE_COLOR.awaiting}>{`● ${s().needYou} need you`}</text>
      <text fg={SUBTLE}>{"    "}</text>
      <text fg={TONE_COLOR.working}>{`◜ ${s().working} working`}</text>
      <text fg={SUBTLE}>{"    "}</text>
      <text fg={TONE_COLOR.idle}>{`○ ${s().idle} idle`}</text>
      <text fg={SUBTLE}>{"    "}</text>
      <text fg={SUBTLE}>
        {s().hostsDown > 0
          ? `${s().hostsDown} host${s().hostsDown === 1 ? "" : "s"} down`
          : "all clear ✓"}
      </text>
    </box>
  );
}

/** The whole board. Pure paint over the projected `view`, the two animation
 *  accessors, and the selection state (`selectedKey`/`open`, defaulted off so the
 *  headless render test can drive the board with or without a cursor) — exported
 *  so the Bun render test drives it directly. */
export function FleetBoard(props: {
  view: () => FleetView;
  frame: () => number;
  now: () => number;
  clock: () => string;
  /** The selected row's stable key (`FleetRow.key`), or `null`/absent for no
   *  selection. The cursor tracks identity, not a list index, so it survives both
   *  a shrink and a reorder of the live row set without a separate clamp; the
   *  board resolves it to a concrete row only for the drill-in pane. */
  selectedKey?: () => string | null;
  /** Whether the drill-in detail pane is open for the selected row; off by
   *  default (the snapshot-style render tests don't drive selection). */
  open?: () => boolean;
}) {
  // Reactive terminal width — re-renders the rows (their `repo·branch` column
  // absorbs the slack) when the terminal is resized. `testRender({ width })`
  // drives this directly, so the responsive layout is unit-testable.
  const dims = useTerminalDimensions();
  const termWidth = () => dims().width;
  const hostsTotal = () => props.view().summary.hostsTotal;
  // The view is a sum on `mode`: read only the field that exists for the arm.
  // These accessors narrow the discriminant so the empty arm contributes
  // nothing — no dead `[]` to know-to-ignore.
  const flat = () => {
    const v = props.view();
    return v.mode === "needs" ? v.flat : [];
  };
  const groups = () => {
    const v = props.view();
    return v.mode === "needs" ? [] : v.groups;
  };
  // The host-less modes (`needs` flat, `agent` sections) cut across machines, so
  // a row must carry its own host cell; in `host` mode the group header is the
  // host and the column would just be redundant.
  const showHost = () => props.view().mode !== "host";
  // The selected key drives the cursor directly; each Row compares its own
  // `key` against it. The drill-in pane is the only thing that needs the whole
  // row, so resolve the key to a concrete row here, off the same flattened list
  // the keyboard handler steps through — a stale/absent key simply matches no
  // row (the pane shows nothing), never a wrong one.
  const selectedKey = () => props.selectedKey?.() ?? null;
  const selected = () => {
    const key = selectedKey();
    return key === null
      ? undefined
      : flattenRows(props.view()).find((r) => r.key === key);
  };
  return (
    <box flexDirection="column" padding={1}>
      <text fg={TITLE}>
        {`pulam-tui fleet  ·  ${hostsTotal()} host${
          hostsTotal() === 1 ? "" : "s"
        }  ·  ${props.clock()}  ·  ⟳ live  ·  Ctrl-C to quit`}
      </text>
      <AlertStrip view={props.view} frame={props.frame} />
      {props.view().mode === "needs" ? (
        <box flexDirection="column" marginTop={1}>
          <For
            each={flat()}
            fallback={
              <text fg={TONE_COLOR.muted}>no terminals across the fleet</text>
            }
          >
            {(row) => (
              <Row
                row={row}
                frame={props.frame}
                now={props.now}
                termWidth={termWidth}
                selectedKey={selectedKey}
                showHost={true}
              />
            )}
          </For>
        </box>
      ) : (
        <For
          each={groups()}
          fallback={<text fg={TONE_COLOR.muted}>no hosts</text>}
        >
          {(group) => (
            <Group
              group={group}
              frame={props.frame}
              now={props.now}
              termWidth={termWidth}
              selectedKey={selectedKey}
              showHost={showHost()}
            />
          )}
        </For>
      )}
      <Summary view={props.view} />
      {/* The drill-in pane for the selected row, when opened with Enter. `Show`
          narrows the (possibly undefined) selected row to a concrete one before
          projecting its detail — never an empty pane for an empty fleet. The
          closed fallback is an empty `<text>` (never a bare string), since
          OpenTUI rejects a raw string directly under a `<box>`. */}
      <Show
        when={(props.open?.() ?? false) ? selected() : undefined}
        fallback={<text fg={SUBTLE}>{""}</text>}
      >
        {(row) => <DetailPane detail={() => gitDetail(row())} />}
      </Show>
    </box>
  );
}

/** Run the fleet board in the alt-screen until Ctrl-C. Seeds the store with
 *  every host (so Solid's key-set reactivity never trips), wires the orchestrator's
 *  sink to it, and projects the live aggregate through `render.ts`. */
export async function runFleetTui(args: {
  hosts: FleetHost[];
  connect: FleetConnector;
  mode: FleetMode;
}): Promise<void> {
  // Seed every host up front, in dial order, all `connecting`. The sink then
  // only mutates existing host entries; terminal ids within a host are dynamic
  // (Solid stores track key add/remove there).
  const seed: Record<string, FleetHostState> = {};
  for (const host of args.hosts) {
    seed[host.label] = {
      label: host.label,
      status: { kind: "connecting" },
      terminals: {},
      live: [],
      gitStatuses: {},
    };
  }
  const [store, setStore] = createStore<Record<string, FleetHostState>>(seed);

  const sink: FleetSink = {
    setStatus: (label, status) => setStore(label, "status", status),
    upsert: (label, id, value) => setStore(label, "terminals", id, value),
    remove: (label, id) =>
      setStore(
        label,
        "terminals",
        produce((terminals) => {
          delete terminals[id];
        }),
      ),
    // The `activity` stream replaces the whole live set each frame — assign it
    // straight onto the host (the projection reads membership per row).
    setLive: (label, live) => setStore(label, "live", live),
    // A repo's live working-tree status, keyed by repo root — the getStatus
    // re-query a subscribeRepoChange pulse drove. Repaints the row's git cell
    // (and the drill-in pane, if this repo is the selected one).
    setGitStatus: (label, repoPath, status) =>
      setStore(label, "gitStatuses", repoPath, status),
    clearGitStatus: (label, repoPath) =>
      setStore(
        label,
        "gitStatuses",
        produce((gitStatuses) => {
          delete gitStatuses[repoPath];
        }),
      ),
    // The link dropped — drop the host's now-stale rows, live set, and git
    // statuses, keeping the seeded entry (so the unreachable header still renders
    // and Solid's key set never trips). The projection then counts/animates/
    // alerts on nothing for it.
    clearHost: (label) =>
      setStore(
        label,
        produce((host) => {
          host.terminals = {};
          host.live = [];
          host.gitStatuses = {};
        }),
      ),
  };

  let fleet: FleetHandle | undefined;

  function App() {
    const [now, setNow] = createSignal(Date.now());
    const [frame, setFrame] = createSignal(0);
    // Selection state — the selected row's STABLE key (not a list index), and
    // whether its repo's drill-in detail pane is open. Tracking the key means the
    // cursor survives both a shrink and a reorder of the live row set with no
    // clamp/wrap arithmetic of its own (`step` owns it). Pure view state: it reads
    // the live store but never writes back, so it lives here, never in the
    // orchestrator. `null` until the first ↑/↓ selects a row.
    const [selectedKey, setSelectedKey] = createSignal<string | null>(null);
    const [open, setOpen] = createSignal(false);
    // The projection depends on the STORE only, never `now()` — so the 1s clock
    // tick repaints just the recency cells (which read `now()` in the row) and
    // the header clock, not this whole derivation. Defined before the keyboard
    // handler so it can read the live rows for the step neighbour.
    const view = createMemo(() =>
      projectFleet(Object.values(store), args.mode),
    );
    // The single flattened row list — the keyboard handler steps over it and the
    // board (via `selectedKey`) paints from it; one memo, one row order, so a ↑/↓
    // can't disagree with what's on screen.
    const rows = createMemo(() => flattenRows(view()));

    // ↑/↓ move the selection cursor (wrapping) to the neighbour row's key, Enter
    // opens the drill-in detail pane for the selected row, Esc closes it.
    // `useKeyboard` self-manages its mount/cleanup; Ctrl-C is left untouched so
    // `exitOnCtrlC` (the one quit, set in runtime.tsx) still fires.
    useKeyboard((key) => {
      switch (key.name) {
        case "up":
          setSelectedKey((k) => step(k, -1, rows()));
          break;
        case "down":
          setSelectedKey((k) => step(k, 1, rows()));
          break;
        case "return":
          setOpen(true);
          break;
        case "escape":
          setOpen(false);
          break;
      }
    });

    onMount(() => {
      // Two canonical timers: a 1s clock/recency tick and a faster animation
      // frame (spinner + alert breathe). Both started here, cleared on cleanup.
      const slow = setInterval(() => setNow(Date.now()), 1000);
      const fast = setInterval(() => setFrame((f) => f + 1), 150);
      // Dial only after mount, so the first paint is the seeded "connecting"
      // board (instant) and every delta repaints it live.
      fleet = startFleet({
        hosts: args.hosts,
        connect: args.connect,
        sink,
        // Per-key mirror blips are non-fatal and keep the last good value (no
        // collapse); they can't be written to the alt-screen without corrupting
        // it. Hard failures (a dead dial, a closed link) surface as the host's
        // `unreachable` header instead, and `--json` surfaces them in output.
        log: () => {},
      });
      onCleanup(() => {
        clearInterval(slow);
        clearInterval(fast);
        fleet?.dispose();
      });
    });
    const clock = () => new Date(now()).toLocaleTimeString();
    return (
      <FleetBoard
        view={view}
        frame={frame}
        now={now}
        clock={clock}
        selectedKey={selectedKey}
        open={open}
      />
    );
  }

  await runTui(() => <App />);
}

/**
 * The OpenTUI/Solid view for `arivu-tui fleet` — arivu P3 PR2b.
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

import { createMemo, createSignal, For, onCleanup, onMount } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  type FleetConnector,
  type FleetHandle,
  type FleetSink,
  startFleet,
} from "./fleet.ts";
import type { FleetHost } from "./hosts.ts";
import { HEADER, HOST, SUBTLE, TITLE, TONE_COLOR } from "./palette.ts";
import type { FleetHostState, FleetHostStatus } from "./fleetTypes.ts";
import {
  cell,
  type FieldTone,
  type FleetGroup,
  type FleetMode,
  type FleetRow,
  type FleetView,
  projectFleet,
  relativeTime,
} from "./render.ts";
import { runTui } from "./runtime.tsx";

// A working agent's glyph cycles these so the row visibly turns — the fleet's
// per-row liveness proof, beside the header clock. `need` pulses a steady dot
// (the alert strip carries the breathing); `idle` is a calm ring.
const SPINNER = ["◜", "◝", "◞", "◟"] as const;
const NEED_GLYPH = "●";
const IDLE_GLYPH = "○";

// Column widths (chars), sized to fit an 80-column terminal alongside the 2-char
// glyph + group indent: 2 + 8 + 22 + 11 + 13 + age(≤4). In the host-less modes
// (`needs`/`agent`) a leading host column (`W_HOST`) replaces the per-host group
// header so each row still names the machine it is on; the `where` column shrinks
// to keep the row inside 80 cols.
const W_HOST = 12;
const W_AGENT = 8;
const W_WHERE = 22;
const W_WHERE_WITH_HOST = 14;
const W_PR = 11;
const W_STATE = 13;

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
  showHost?: boolean;
}) {
  return (
    <box flexDirection="row">
      <text fg={TONE_COLOR[props.row.state.tone]}>
        {cell(rowGlyph(props.row, props.frame()), 2)}
      </text>
      <text fg={HOST}>
        {props.showHost ? cell(props.row.host, W_HOST) : ""}
      </text>
      <text fg={TONE_COLOR[props.row.agent.tone]}>
        {cell(props.row.agent.text, W_AGENT)}
      </text>
      <text fg={TONE_COLOR[props.row.where.tone]}>
        {cell(
          props.row.where.text,
          props.showHost ? W_WHERE_WITH_HOST : W_WHERE,
        )}
      </text>
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
            showHost={props.showHost}
          />
        )}
      </For>
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

/** The whole board. Pure paint over the projected `view` plus the two animation
 *  accessors — exported so the headless Bun render test drives it directly. */
export function FleetBoard(props: {
  view: () => FleetView;
  frame: () => number;
  now: () => number;
  clock: () => string;
}) {
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
  return (
    <box flexDirection="column" padding={1}>
      <text fg={TITLE}>
        {`arivu-tui fleet  ·  ${hostsTotal()} host${
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
              showHost={showHost()}
            />
          )}
        </For>
      )}
      <Summary view={props.view} />
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
  };

  let fleet: FleetHandle | undefined;

  function App() {
    const [now, setNow] = createSignal(Date.now());
    const [frame, setFrame] = createSignal(0);
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
    // The projection depends on the STORE only, never `now()` — so the 1s clock
    // tick repaints just the recency cells (which read `now()` in the row) and
    // the header clock, not this whole derivation.
    const view = createMemo(() =>
      projectFleet(Object.values(store), args.mode),
    );
    const clock = () => new Date(now()).toLocaleTimeString();
    return <FleetBoard view={view} frame={frame} now={now} clock={clock} />;
  }

  await runTui(() => <App />);
}

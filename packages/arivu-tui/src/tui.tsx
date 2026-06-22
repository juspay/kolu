/**
 * The OpenTUI/Solid view for arivu-tui — arivu P3 PR2a.
 *
 * `arivu-tui` (no args) opens a compact, truecolour table: one row per terminal,
 * what each one *is in* — repo·branch · PR + checks · agent state · foreground ·
 * recency. The agent state and PR carry a semantic tone (awaiting → amber,
 * working → cyan, pass/fail → green/red); the rest stay calm.
 *
 * PR2a scope: the table is a ONE-SHOT SNAPSHOT — read once by bin.ts before the
 * render, frozen for the session. The single live element is a CLOCK in the
 * header, ticking once a second: the liveness proof that OpenTUI is repainting
 * through Solid's fine-grained reactivity, not frozen. Wiring the mirror so the
 * rows themselves update live is PR2b's job. The clock is written the
 * SolidJS-canonical way and no other — `createSignal` updated by an interval
 * started in `onMount` and cleared in `onCleanup`, READ in JSX so the reconciler
 * repaints only that one cell. No requestRender, no fps cap, no imperative redraw.
 *
 * The DECISIONS about the data (columns, values, tone) live in the pure
 * `render.ts` (`dashRows`), unit-tested under Node; this module maps a tone to a
 * colour and lays out cells, nothing more. It is `.tsx`, loaded only under Bun
 * (the daemon + the rest of kolu stay Node), imported dynamically by bin.ts ONLY
 * when stdout is a TTY.
 */

import type {
  AwarenessValue,
  TerminalId,
} from "@kolu/terminal-workspace/surface";
import { createSignal, For, onCleanup, onMount } from "solid-js";
import { HEADER, TITLE, TONE_COLOR } from "./palette.ts";
import { cell, type DashRow, dashRows } from "./render.ts";
import { runTui } from "./runtime.tsx";

// Column widths (chars). Sized so the whole table fits an 80-column terminal:
// 9 + 24 + 12 + 18 + 8 + "ACTIVE"(6) = 77 columns, + the box's padding={1}
// (1 left + 1 right) = 79 ≤ 80. Long values ellipsize. A render test at width 80
// pins this (tui.bun-test.tsx).
const W_ID = 9;
const W_WHERE = 24;
const W_PR = 12;
const W_AGENT = 18;
const W_FG = 8;

/** The table: a title carrying the live clock, a header row, and one row per
 *  terminal — the agent state + PR coloured by tone, the rest calm. The `clock`
 *  accessor is read in the title so only that cell repaints each tick; `rows` is
 *  the frozen snapshot. Exported for the headless Bun render test. */
export function AwarenessTable(props: {
  rows: DashRow[];
  clock: () => string;
}) {
  const count = props.rows.length;
  return (
    <box flexDirection="column" padding={1}>
      <text fg={TITLE}>
        {`arivu  ·  ${count} terminal${count === 1 ? "" : "s"}  ·  ${props.clock()}  ·  Ctrl-C to quit`}
      </text>
      <box flexDirection="row" marginTop={1}>
        <text fg={HEADER}>{cell("ID", W_ID)}</text>
        <text fg={HEADER}>{cell("REPO·BRANCH", W_WHERE)}</text>
        <text fg={HEADER}>{cell("PR", W_PR)}</text>
        <text fg={HEADER}>{cell("AGENT", W_AGENT)}</text>
        <text fg={HEADER}>{cell("FG", W_FG)}</text>
        <text fg={HEADER}>ACTIVE</text>
      </box>
      {count === 0 ? (
        <text fg={TONE_COLOR.muted}>
          no terminals — is kaval running, with arivu watching it?
        </text>
      ) : (
        <For each={props.rows}>
          {(r) => (
            <box flexDirection="row">
              <text fg={TONE_COLOR[r.id.tone]}>{cell(r.id.text, W_ID)}</text>
              <text fg={TONE_COLOR[r.repoBranch.tone]}>
                {cell(r.repoBranch.text, W_WHERE)}
              </text>
              <text fg={TONE_COLOR[r.pr.tone]}>{cell(r.pr.text, W_PR)}</text>
              <text fg={TONE_COLOR[r.agent.tone]}>
                {cell(r.agent.text, W_AGENT)}
              </text>
              <text fg={TONE_COLOR[r.foreground.tone]}>
                {cell(r.foreground.text, W_FG)}
              </text>
              <text fg={TONE_COLOR[r.active.tone]}>{r.active.text}</text>
            </box>
          )}
        </For>
      )}
    </box>
  );
}

/** Run the dashboard in the alt-screen until the user quits with Ctrl-C (or a
 *  kill signal). The rows are the snapshot bin.ts already read; the clock is the
 *  only live value. Resolves once the renderer has torn down; a render-time
 *  error is surfaced, never swallowed into a frozen screen (see `runTui`). */
export async function runDashboardTui(args: {
  entries: Array<[TerminalId, AwarenessValue]>;
}): Promise<void> {
  // Snapshot → static rows, projected once against a fixed `now` (PR2a: the list
  // does not auto-update; the fleet board mirrors the collection for live rows).
  const rows = dashRows(args.entries, Date.now());

  function App() {
    const [clock, setClock] = createSignal(new Date());
    onMount(() => {
      const id = setInterval(() => setClock(new Date()), 1000);
      onCleanup(() => clearInterval(id));
    });
    return (
      <AwarenessTable rows={rows} clock={() => clock().toLocaleTimeString()} />
    );
  }

  await runTui(() => <App />);
}

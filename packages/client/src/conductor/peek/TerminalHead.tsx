/** A LIVE TERMINAL'S HEAD — what any view of one terminal's screen draws
 *  above it: the controls (**Fit width**, **Open tile ↗**) and the status line
 *  (the host, the Dock's status mark with the state in words and for how long,
 *  who is driving and the way to change it, the grid, and whether the screen
 *  is live), with a line of the agent's facts under it — its name, its model,
 *  how long it has run, the context it has used — in the Inspector's own
 *  formatters. The peek's window draws them; so does a live pane of a picked
 *  work.
 *
 *  Its test ids are prefixed by `kind` — `peek-take-over` in the peek,
 *  `live-take-over` in a pane — so a step can say which of two views of one
 *  terminal it pressed when both are on screen. */

import { decodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import type { Driver } from "kolu-work";
import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import type { JSX } from "@solidjs/web";
import { type Component, createMemo, Show } from "solid-js";
import { hostLabel } from "../../host/hostChipTone";
import { fleetTerminalStanding } from "../../palette/fleetTerminals";
import { useDuration } from "../../terminal/staleness";
import { agentName, formatContextTokens } from "../../ui/agentDisplay";
import { useShownClock } from "../../ui/shown";
import DriveButton from "../DriveButton";
import MemberPip from "../MemberPip";
import StateFor from "../StateFor";
import { liveArm, terminalStatus } from "../terminalStatus";
import { useSeen } from "../useWorks";
import type { Lock } from "../workReadings";

export type HeadKind = "peek" | "live";

/** How a view's screen stands: still reading, live, or reconnecting. */
export type ScreenPhase = "reading" | "live" | "reconnecting";

/** **Fit width** — drawn only when the terminal, at its own size, is wider
 *  than the view — and **Open tile ↗**. A terminal that already fits has
 *  nothing for the button to do, so it is not offered. */
export const TerminalControls: Component<{
  kind: HeadKind;
  host: string;
  id: TerminalId;
  /** The terminal is wider than the view, so it pans sideways. */
  pans: boolean;
  fit: boolean;
  onFit: () => void;
  onOpenTile: () => void;
}> = (props) => {
  const here = () =>
    fleetTerminalStanding(props.host, props.id).kind === "here";
  return (
    <>
      <Show when={props.pans}>
        <button
          type="button"
          data-testid={`${props.kind}-fit`}
          aria-pressed={props.fit ? "true" : "false"}
          class={
            props.fit
              ? "shrink-0 cursor-pointer rounded-md border border-accent/50 bg-accent/15 px-2 py-0.5 text-[0.7rem] text-accent"
              : "shrink-0 cursor-pointer rounded-md border border-edge-bright bg-surface-0 px-2 py-0.5 text-[0.7rem] text-fg-2 hover:text-fg"
          }
          onClick={() => props.onFit()}
        >
          Fit width
        </button>
      </Show>
      <button
        type="button"
        data-testid={`${props.kind}-open-tile`}
        disabled={!here()}
        class="shrink-0 cursor-pointer rounded-md border border-edge-bright bg-surface-0 px-2 py-0.5 text-[0.7rem] font-semibold text-accent hover:text-fg disabled:cursor-default disabled:opacity-40"
        onClick={() => props.onOpenTile()}
      >
        Open tile ↗
      </button>
    </>
  );
};

/** The status line: host, state, who drives it and the way to change that,
 *  the grid, and whether the screen is live.
 *
 *  IN A LIVE PANE THE HEAD KEEPS ONE HEIGHT. The pane's body is what its
 *  section has left after the head, and a desktop pane sizes its terminal
 *  from that body (`paneSize.ts`): a head that grew a row when an agent
 *  started would resize the terminal as the agent starts, and again when it
 *  quits. So in a live pane the status line has a fixed height on a desktop,
 *  and the agent's facts row keeps its one line whether or not there is an
 *  agent. Look's window is not sized from its body and keeps the old shape. */
export const TerminalStatusLine: Component<{
  kind: HeadKind;
  /** IS THERE A SCREEN UNDER THIS HEAD — the ONE gate, computed by the view
   *  that owns the screen (`peek/lookable.ts`) and handed down, so a head and
   *  its pane can never disagree about whether there is a screen to read out. */
  lookable: boolean;
  host: string;
  id: TerminalId;
  /** The terminal's member ref, which the lock is kept under. */
  terminal: string;
  driver: Driver;
  grid: TerminalGrid | null;
  phase: ScreenPhase;
  held: boolean;
  onPointerDown?: () => void;
  /** A live pane's one press to take the size: whether it is offered — the
   *  pane's call (`conductor/resizeOffer.ts`), from the terminal's record and
   *  the size the pane would ask for — and the press. The readout becomes the
   *  button while it is offered. Not given in Look. */
  resize?: { offered: boolean; onPress: () => void };
}> = (props) => {
  /** Who drives it, when someone does: what the lock part draws for. */
  const lock = (): Lock | undefined =>
    props.driver === "nobody" ? undefined : props.driver;
  const seen = useSeen();
  const now = useShownClock();
  const runningFor = useDuration();
  const standing = createMemo(() =>
    fleetTerminalStanding(props.host, props.id),
  );
  const status = createMemo(() => terminalStatus(standing()));
  /** How long it has been in its state, by kolu's watch of it. */
  const reading = () => seen().get(props.terminal);
  /** The agent in it, for the facts line — none for a shell. */
  const agent = () => liveArm(standing())?.agent ?? undefined;
  /** The context it has used, boxed so a legitimate `0` still renders. */
  const context = () => {
    const tokens = agent()?.contextTokens;
    return tokens == null ? null : { value: tokens };
  };
  const offersResize = () =>
    props.kind === "live" && props.resize?.offered === true;
  const readout = (g: TerminalGrid): JSX.Element => (
    <span
      data-testid={`${props.kind}-grid`}
      class="shrink-0 font-mono text-[0.6rem] tabular-nums text-fg-3"
    >
      {g.cols}×{g.rows}
    </span>
  );
  return (
    <>
      <div
        data-testid={`${props.kind}-statusline`}
        class={
          props.kind === "live"
            ? "flex min-w-0 shrink-0 items-center gap-2 bg-surface-0 px-3 py-1.5 text-[0.7rem] max-sm:flex-wrap sm:h-8"
            : "flex min-w-0 shrink-0 items-center gap-2 bg-surface-0 px-3 py-1.5 text-[0.7rem] max-sm:flex-wrap"
        }
        onPointerDown={() => props.onPointerDown?.()}
      >
        <span class="shrink-0 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-accent">
          {hostLabel(decodeHostKey(props.host))}
        </span>
        <MemberPip
          at={{ host: props.host, id: props.id }}
          standing={standing()}
        />
        <span
          data-testid={`${props.kind}-status`}
          class="min-w-0 flex-1 truncate text-fg-2"
        >
          <StateFor
            word={status().state}
            standing={standing()}
            reading={reading()}
            now={now()}
            testId={`${props.kind}-since`}
          />
          <Show when={status().progress}>
            {(tasks) => (
              <>
                {" · "}
                <span class="tabular-nums" title={tasks().title}>
                  {tasks().text}
                </span>
              </>
            )}
          </Show>
          <Show when={status().doing}>{(doing) => <> · {doing()}</>}</Show>
        </span>
        <Show when={props.lookable ? lock() : undefined}>
          {(who) => (
            <span
              data-testid={`${props.kind}-lock`}
              data-driver={who()}
              class="flex shrink-0 items-center gap-1.5"
            >
              <Show
                when={who() === "conductor"}
                fallback={
                  <span class="rounded-sm bg-alert/15 px-1.5 font-mono text-[0.56rem] font-semibold uppercase tracking-[0.06em] text-alert">
                    You’re driving
                  </span>
                }
              >
                <span class="rounded-sm bg-conductor/15 px-1.5 font-mono text-[0.56rem] font-semibold uppercase tracking-[0.06em] text-conductor">
                  Conductor is driving · read-only
                </span>
              </Show>
              <DriveButton
                terminal={props.terminal}
                driver={who()}
                testId={props.kind}
              />
            </span>
          )}
        </Show>
        <Show when={props.lookable && props.grid}>
          {(g) => (
            <Show when={offersResize()} fallback={readout(g())}>
              {/* Text-sized, with no padding or border, so offering it
                  moves nothing in the head. */}
              <button
                type="button"
                data-testid={`${props.kind}-resize`}
                class="shrink-0 cursor-pointer whitespace-nowrap font-mono text-[0.6rem] text-accent hover:underline"
                onClick={() => props.resize?.onPress()}
              >
                {readout(g())} · Resize to fit
              </button>
            </Show>
          )}
        </Show>
        <Show when={props.lookable}>
          <span
            data-testid={`${props.kind}-live`}
            data-phase={props.held ? "held" : props.phase}
            class="shrink-0 font-mono text-[0.6rem] text-fg-3"
          >
            {props.held
              ? "new output below"
              : props.phase === "live"
                ? "live"
                : props.phase === "reading"
                  ? "reading the screen…"
                  : "reconnecting…"}
          </span>
        </Show>
      </div>
      {/* THE AGENT'S FACTS, under the status line: what it is, the model its
        session reports, how long it has run, the context it has used —
        nothing about the worktree, which is the work's. In a live pane the
        row keeps its place and its one line with no agent too. */}
      <Show when={props.kind === "live" || agent()}>
        <div
          data-testid={`${props.kind}-facts`}
          class={
            props.kind === "live"
              ? "flex h-5.5 min-w-0 shrink-0 gap-x-2.5 overflow-hidden whitespace-nowrap bg-surface-0 px-3 pb-1.5 font-mono text-[0.6rem] leading-4 tabular-nums text-fg-3"
              : "flex min-w-0 shrink-0 flex-wrap gap-x-2.5 gap-y-0.5 bg-surface-0 px-3 pb-1.5 font-mono text-[0.6rem] tabular-nums text-fg-3"
          }
        >
          <Show when={agent()}>
            {(one) => (
              <>
                <span class="text-fg-2">{agentName(one().kind)}</span>
                <Show when={one().model}>
                  {(model) => <span>{model()}</span>}
                </Show>
                <Show when={one().startedAt}>
                  {(startedAt) => (
                    <span
                      title={`Started ${new Date(startedAt()).toLocaleString()}`}
                    >
                      {runningFor(startedAt())}
                    </span>
                  )}
                </Show>
                <Show when={context()}>
                  {(box) => (
                    <span
                      title={`Context: ${box().value.toLocaleString()} tokens`}
                    >
                      {formatContextTokens(box().value)} ctx
                    </span>
                  )}
                </Show>
              </>
            )}
          </Show>
        </div>
      </Show>
    </>
  );
};

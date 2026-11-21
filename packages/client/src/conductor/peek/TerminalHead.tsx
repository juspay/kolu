/** A LIVE TERMINAL'S HEAD — what any view of one terminal's screen draws
 *  above it: the controls (**Fit width**, **Open tile ↗**) and the status line
 *  (the host, a dot with the state in words, who is driving and the way to
 *  change it, the grid, and whether the screen is live). The peek's window
 *  draws them; so does a live pane of a picked work.
 *
 *  Its test ids are prefixed by `kind` — `peek-take-over` in the peek,
 *  `live-take-over` in a pane — so a step can say which of two views of one
 *  terminal it pressed when both are on screen. */

import { decodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import type { Driver } from "kolu-work";
import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import { type Component, createMemo, Show } from "solid-js";
import { hostLabel } from "../../host/hostChipTone";
import { fleetTerminalStanding } from "../../palette/fleetTerminals";
import { liveArm, STATUS_DOT, terminalStatus } from "../terminalStatus";
import { useConductor } from "../useConductor";

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
          aria-pressed={props.fit}
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
 *  the grid, and whether the screen is live. */
export const TerminalStatusLine: Component<{
  kind: HeadKind;
  host: string;
  id: TerminalId;
  /** The terminal's member ref, which the lock is kept under. */
  terminal: string;
  driver: Driver;
  grid: TerminalGrid | null;
  phase: ScreenPhase;
  held: boolean;
  onPointerDown?: () => void;
}> = (props) => {
  const conductor = useConductor();
  const standing = createMemo(() =>
    fleetTerminalStanding(props.host, props.id),
  );
  const status = createMemo(() => terminalStatus(standing()));
  const lookable = () => liveArm(standing()) !== undefined;
  return (
    <div
      data-testid={`${props.kind}-statusline`}
      class="flex min-w-0 shrink-0 items-center gap-2 bg-surface-0 px-3 py-1.5 text-[0.7rem] max-sm:flex-wrap"
      onPointerDown={() => props.onPointerDown?.()}
    >
      <span class="shrink-0 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-accent">
        {hostLabel(decodeHostKey(props.host))}
      </span>
      <span
        class={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status().tone]}`}
      />
      <span
        data-testid={`${props.kind}-status`}
        class="min-w-0 flex-1 truncate text-fg-2"
      >
        <span class="font-semibold text-fg">{status().state}</span>
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
      <Show when={lookable() && props.driver !== "nobody"}>
        <span
          data-testid={`${props.kind}-lock`}
          data-driver={props.driver}
          class="flex shrink-0 items-center gap-1.5"
        >
          <Show
            when={props.driver === "conductor"}
            fallback={
              <>
                <span class="rounded-sm bg-alert/15 px-1.5 font-mono text-[0.56rem] font-semibold uppercase tracking-[0.06em] text-alert">
                  You’re driving
                </span>
                <button
                  type="button"
                  data-testid={`${props.kind}-hand-back`}
                  class="shrink-0 cursor-pointer rounded-sm bg-alert/20 px-2 py-[0.2rem] font-mono text-[0.62rem] font-semibold uppercase tracking-[0.06em] text-alert transition-colors hover:bg-alert/30"
                  onClick={() => conductor.handBack(props.terminal)}
                >
                  Hand back
                </button>
              </>
            }
          >
            <span class="rounded-sm bg-conductor/15 px-1.5 font-mono text-[0.56rem] font-semibold uppercase tracking-[0.06em] text-conductor">
              Conductor is driving · read-only
            </span>
            <button
              type="button"
              data-testid={`${props.kind}-take-over`}
              class="shrink-0 cursor-pointer rounded-sm bg-conductor/20 px-2 py-[0.2rem] font-mono text-[0.62rem] font-semibold uppercase tracking-[0.06em] text-conductor transition-colors hover:bg-conductor/30"
              onClick={() => conductor.takeOver(props.terminal)}
            >
              Take over
            </button>
          </Show>
        </span>
      </Show>
      <Show when={lookable() && props.grid}>
        {(g) => (
          <span
            data-testid={`${props.kind}-grid`}
            class="shrink-0 font-mono text-[0.6rem] tabular-nums text-fg-3"
          >
            {g().cols}×{g().rows}
          </span>
        )}
      </Show>
      <Show when={lookable()}>
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
  );
};

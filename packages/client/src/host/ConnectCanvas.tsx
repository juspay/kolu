/** The connect overlay (W6 — "the honest connect"): the canvas surface shown while
 *  the ACTIVE host's binding is coming up. It reads that host's `connection` cell and
 *  switches on `phase` — so a cold remote provision narrates its owned
 *  evaluation/transfer/build lifetime, with a live log tail + an elapsed timer, instead of the
 *  mute "Connecting…" the whole canvas used to show, indistinguishable from a hang.
 *
 *  Two callers funnel through the one `warming` CanvasMode arm:
 *   - a CONNECTED host whose kaval daemon is restarting (`daemonState` DEFINED) — keep
 *     the neutral kaval label, exactly as before (no connection narration; the daemon,
 *     not the host binding, is what's in motion);
 *   - a host BINDING still coming up (`daemonState` UNDEFINED) — narrate off the
 *     connection cell's `phase`.
 *
 *  The overlay renders the live `log` tail + the elapsed timer off the frame's own DATA — a
 *  non-empty `log`, a `sinceMs` ≥ 1s — NOT a per-phase flag. So the `probing` window (the arch
 *  probe + the "is it already here?" check) narrates its real log ("<host>: checking for a
 *  cached agent…" → "…already provisioned — skipped copy") the instant it arrives, instead of
 *  a SILENT wait. The warm path still reads calm: a warm host short-circuits FAST, so `sinceMs`
 *  stays under the 1s elapsed threshold (no "0s" flash) and its tail is reassuring real output,
 *  not a scary build. Genuine cold `provisioning` shows the same tail + a climbing
 *  elapsed as it runs. Failure is deliberately NOT handled here:
 *  `disconnected`/`failed` are owned by the Skew-UX host-down card (a `host-failed`
 *  CanvasMode), so this overlay renders only the up-but-not-yet-connected phases and
 *  never a second failure surface. */

import type { DaemonState } from "@kolu/padi-client/surface";
import { encodeHostKey } from "kolu-common/hostKey";
import type { ConnectPhase } from "kolu-common/surfacesWithPadi";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  untrack,
} from "solid-js";
import { showsElapsed, tailOf } from "../kaval/connectCanvasView";
import { DAEMON_STATE_PRESENTATION } from "../kaval/daemonPresentation";
import { getClockNow } from "../time/clock";
import { formatElapsedShort } from "../time/duration";
import DocLink from "../ui/DocLink";
import { LOG_TAIL_SURFACE } from "../ui/logTailChrome";
import { activeHost, connectionInfo } from "../wire";
import { connectCanvasCopy, isConnectPhase } from "./connectCanvasCopy";

export function ConnectCanvas(props: { daemonState: DaemonState | undefined }) {
  const info = () => connectionInfo();
  // A CONNECTED host whose kaval is restarting (`daemonState` DEFINED) → the neutral kaval
  // label, derived at render from the ONE daemon-presentation table (no baked-in string). A
  // host BINDING still coming up (`daemonState` UNDEFINED) → narrate off the connection cell's
  // phase, funneled through the ONE copy authority — which covers the `undefined` gap
  // (subscription pending / floored / narrowed-out) with the SAME copy as `probing`, so no
  // flicker.
  const host = () => encodeHostKey(activeHost());
  const phase = createMemo<ConnectPhase | undefined>(() => {
    if (props.daemonState !== undefined) return undefined;
    const p = info()?.phase;
    return p !== undefined && isConnectPhase(p) ? p : undefined;
  });
  const copy = createMemo(() =>
    props.daemonState !== undefined
      ? null // kaval-restart: the fallback below renders the daemon-presentation label
      : connectCanvasCopy(phase(), host()),
  );
  // The kaval-restart label — read from the daemon-presentation table at render, never baked
  // into the CanvasMode. Empty when `daemonState` is undefined (that branch renders `copy()`
  // instead, so the fallback below is only reached with a defined state).
  const kavalLabel = () =>
    props.daemonState !== undefined
      ? DAEMON_STATE_PRESENTATION[props.daemonState].canvasLabel
      : "";

  // Elapsed since THIS host's current provisioning episode began. The SESSION owns the
  // truth: the server ships `sinceMs` — the episode duration on its single clock, reset
  // per episode — and the client only EXTENDS it smoothly between frames.
  //
  // Two load-bearing rules for the wall-clock extension (#1962):
  //  1. Drive re-renders off the SHARED app clock (`getClockNow`) — the same reactive
  //     tick HostDaemonChips / inspector use. A component-local setInterval was wiped
  //     every second when `<Match when={warmingMode()}>` remounted on each mode() object
  //     (mode recomputes every getMonotonicNow tick for the boot deadline).
  //  2. Re-anchor ONLY when the server's `sinceMs` changes for the SAME host+campaign —
  //     re-baselining `at` on every effect re-run with the same sinceMs zeroes the extension
  //     and freezes the label at the last frame's sinceMs until the next log frame jumps it.
  //     Host + campaignEpoch are in the key because the boolean warming Match keeps this
  //     component mounted across active-host switches and same-host recheck; a quiet multi-
  //     minute stretch can leave anchor.ms at 0 while wall extension shows 40s, so a new
  //     campaign that reopens at sinceMs: 0 must not keep that baseline.
  const clockNow = getClockNow();
  const [anchor, setAnchor] = createSignal<{
    host: string;
    epoch: number;
    ms: number;
    at: number;
  } | null>(null);
  createEffect(() => {
    const c = copy();
    const frame = info();
    const h = host();
    // Residual `connecting` mode can still have a live connection cell with a
    // long-lived connected campaign (reload of a warm host). Title-only "Connecting…"
    // is fine; elapsed/tail must not show that campaign's uptime as connect progress.
    if (c === null || frame === undefined || !isConnectPhase(frame.phase)) {
      setAnchor(null);
      return;
    }
    const sinceMs = frame.sinceMs;
    const epoch = frame.campaignEpoch;
    setAnchor((prev) => {
      // Same host + campaign + server duration → keep the receipt baseline so wall
      // clock extends it between frames.
      if (
        prev !== null &&
        prev.host === h &&
        prev.epoch === epoch &&
        prev.ms === sinceMs
      ) {
        return prev;
      }
      return {
        host: h,
        epoch,
        ms: sinceMs,
        at: untrack(() => clockNow()),
      };
    });
  });
  // Plain function (not createMemo): reads clockNow() in the caller's tracking
  // context (JSX), the same pattern kaval uptime uses — so each shared-clock tick
  // re-evaluates the elapsed text with zero incoming frames.
  const elapsedMs = (): number | null => {
    const a = anchor();
    return a === null ? null : a.ms + (clockNow() - a.at);
  };

  const tail = createMemo(() => {
    const frame = info();
    if (frame === undefined || !isConnectPhase(frame.phase)) return [];
    return tailOf(frame.log);
  });

  return (
    <Show
      when={copy()}
      fallback={
        // kaval-restart warming (`daemonState` defined): the neutral label from the daemon-
        // presentation table, byte-identical to the pre-W6 surface (the `daemon-warming`
        // testid + the `data-daemon-state` attribute the presentation tests read).
        <div
          data-testid="daemon-warming"
          data-daemon-state={props.daemonState}
          class="flex items-center justify-center flex-1 text-fg-3 text-sm canvas-grid-bg"
        >
          {kavalLabel()}
        </div>
      }
    >
      {(c) => (
        <div
          data-testid="connect-canvas"
          data-phase={phase() ?? undefined}
          class="flex flex-col items-center justify-center flex-1 gap-3 text-fg-3 text-sm canvas-grid-bg px-6"
        >
          <div class="flex items-baseline gap-2">
            <span class="text-fg-2">{c().title}</span>
            {/* Elapsed renders off the frame's own `sinceMs`, once it reaches ≥1s — so a
                dragging connect reads as abnormal, while the brief `connecting` handshake
                never flashes a "0s" (the same 1s guard drishti's `withElapsed` uses). */}
            <Show when={showsElapsed(elapsedMs())}>
              <span
                data-testid="connect-elapsed"
                class="text-fg-4 tabular-nums text-xs"
              >
                {formatElapsedShort(elapsedMs() as number)}
              </span>
            </Show>
          </div>
          <div class="text-xs">
            <DocLink slug="remote-hosts">Add another machine →</DocLink>
          </div>
          {/* The live log tail renders whenever the frame carries log lines — the `probing`
              window's "checking for a cached agent…" narrates the instant it arrives, no
              silent wait. Data presence, not a per-phase flag. */}
          <Show when={tail().length > 0}>
            <div
              data-testid="connect-tail"
              class={`w-full max-w-2xl overflow-hidden px-3 py-2 text-[11px] leading-relaxed ${LOG_TAIL_SURFACE}`}
            >
              <For each={tail()}>
                {(entry) => (
                  <div class="truncate whitespace-pre">{entry.line}</div>
                )}
              </For>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}

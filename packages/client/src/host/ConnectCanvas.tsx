/** The connect overlay (W6 — "the honest connect"): the canvas surface shown while
 *  the ACTIVE host's binding is coming up. It reads that host's `connection` cell and
 *  switches on `phase` — so a cold remote provision NARRATES its real phase (copying
 *  the recipe → building it, with a live log tail + an elapsed timer) instead of the
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
 *  not a scary build. A genuine COLD `copying`/`building` shows the same tail + a climbing
 *  elapsed as it runs. Failure is deliberately NOT handled here:
 *  `disconnected`/`failed` are owned by the Skew-UX host-down card (a `host-failed`
 *  CanvasMode), so this overlay renders only the up-but-not-yet-connected phases and
 *  never a second failure surface. */

import type { DaemonState } from "@kolu/padi/surface";
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
  // per episode — and the client only EXTENDS it smoothly between frames. So there is NO
  // client-held episode-start place (the bug the reset came from): on a host-tab switch,
  // ConnectCanvas remounts and simply re-reads the server's authoritative `sinceMs`, so
  // the count never resets and never leaks a prior host's. `anchor` is a transient
  // extension baseline (server duration + local receipt time), re-set on every frame —
  // NOT an episode start, so it is self-correcting and belongs on the component.
  const [anchor, setAnchor] = createSignal<{ ms: number; at: number } | null>(
    null,
  );
  createEffect(() => {
    // Re-anchor on each fresh frame — in the connect-overlay path (`copy` present) with a real
    // frame (a `sinceMs` to extend). No flag gate: a `probing` frame ticks too. The GAP (no
    // frame) and the kaval-restart path (`copy` null) carry no `sinceMs`, so no timer — data
    // absence, not policy. The clock is read UNTRACKED so the effect fires on frames, not ticks.
    const c = copy();
    const frame = info();
    setAnchor(
      c !== null && frame !== undefined
        ? { ms: frame.sinceMs, at: untrack(() => getClockNow()()) }
        : null,
    );
  });
  const elapsedMs = createMemo(() => {
    const a = anchor();
    return a === null ? null : a.ms + (getClockNow()() - a.at);
  });

  const tail = createMemo(() => tailOf(info()?.log ?? []));

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
            <DocLink slug="remote-hosts">Remote hosts docs →</DocLink>
          </div>
          {/* The live log tail renders whenever the frame carries log lines — the `probing`
              window's "checking for a cached agent…" narrates the instant it arrives, no
              silent wait. Data presence, not a per-phase flag. */}
          <Show when={tail().length > 0}>
            <div
              data-testid="connect-tail"
              class="w-full max-w-2xl overflow-hidden rounded border border-bd-1/50 bg-bg-2/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-fg-4"
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

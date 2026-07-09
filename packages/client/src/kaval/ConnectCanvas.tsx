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
 *  The WARM path stays calm by construction: the session opens at `probing` (the arch
 *  probe + the "is it already here?" check), which renders a bare "Connecting to
 *  <host>…" — no tail, no elapsed — so a warm host that short-circuits from `probing`
 *  straight to `connected` never flashes a build UI. Only a genuine COLD copy flips to
 *  `copying`/`building` (tail + elapsed). Failure is deliberately NOT handled here:
 *  `disconnected`/`failed` are owned by the Skew-UX host-down card (a `host-failed`
 *  CanvasMode), so this overlay renders only the up-but-not-yet-connected phases and
 *  never a second failure surface. */

import type { DaemonState } from "@kolu/padi/surface";
import { encodeHostKey } from "kolu-common/hostKey";
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  untrack,
} from "solid-js";
import { getClockNow } from "../time/clock";
import { formatElapsedShort } from "../time/duration";
import { activeHost, connectionInfo } from "../wire";
import { connectCanvasCopy, isConnectPhase } from "./connectCanvasCopy";

/** How many trailing `log` lines the live tail shows — a tail, not the whole Nix
 *  firehose (the reassurance is "named phase + real output + elapsed", not a scroll of
 *  every line). */
const TAIL_LINES = 6;

export function ConnectCanvas(props: {
  label: string;
  daemonState: DaemonState | undefined;
}) {
  const info = () => connectionInfo();
  // Narrate off the cell ONLY for a host-binding-warming (`daemonState` undefined) whose
  // phase is a narratable up phase; a kaval-restart warming (`daemonState` defined) or an
  // unexpected phase falls back to the neutral label.
  const phase = createMemo(() => {
    if (props.daemonState !== undefined) return null;
    const p = info()?.phase;
    return p !== undefined && isConnectPhase(p) ? p : null;
  });
  const host = () => encodeHostKey(activeHost());
  const copy = createMemo(() => {
    const p = phase();
    return p === null ? null : connectCanvasCopy(p, host());
  });

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
    const c = copy();
    // Read the cell so the effect re-anchors on each fresh `sinceMs`; the clock is read
    // UNTRACKED so the effect fires on frames, not every tick.
    const ms = info()?.sinceMs ?? 0;
    setAnchor(
      c?.showProgress ? { ms, at: untrack(() => getClockNow()()) } : null,
    );
  });
  const elapsedMs = createMemo(() => {
    const a = anchor();
    return a === null ? null : a.ms + (getClockNow()() - a.at);
  });

  const tail = createMemo(() => (info()?.log ?? []).slice(-TAIL_LINES));

  return (
    <Show
      when={copy()}
      fallback={
        // kaval-restart warming (or a not-yet-classified frame): the neutral label,
        // byte-identical to the pre-W6 surface (the `daemon-warming` testid + the
        // `data-daemon-state` attribute the presentation tests read).
        <div
          data-testid="daemon-warming"
          data-daemon-state={props.daemonState}
          class="flex items-center justify-center flex-1 text-fg-3 text-sm canvas-grid-bg"
        >
          {props.label}
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
            <Show when={elapsedMs() !== null}>
              <span
                data-testid="connect-elapsed"
                class="text-fg-4 tabular-nums text-xs"
              >
                {formatElapsedShort(elapsedMs() as number)}
              </span>
            </Show>
          </div>
          <Show when={c().showProgress && tail().length > 0}>
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

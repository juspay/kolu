import type { DaemonState } from "@kolu/padi-client/surface";
import { encodeHostKey } from "kolu-common/hostKey";
import { createMemo, Show, untrack } from "solid-js";
import { toast } from "solid-sonner";
import { LogTail, type LogLine, NO_LOG_LINES } from "@kolu/solid-logtail";
import { showsElapsed, tailOf } from "../kaval/connectCanvasView";
import { DAEMON_STATE_PRESENTATION } from "../kaval/daemonPresentation";
import { getClockNow } from "../time/clock";
import { formatElapsedShort } from "../time/duration";
import DocLink from "../ui/DocLink";
import { activeHost, connectionInfo } from "../wire";
import {
  connectCanvasCopy,
  type ElapsedAnchor,
  type Episode,
  episodeElapsedAnchor,
  episodeElapsedMs,
  isNarratedPhase,
  type NarratedPhase,
} from "./connectCanvasCopy";

export function ConnectCanvas(props: { daemonState: DaemonState | undefined }) {
  const info = () => connectionInfo();
  const host = () => encodeHostKey(activeHost());
  const phase = createMemo<NarratedPhase | undefined>(() => {
    if (props.daemonState !== undefined) return undefined;
    const p = info()?.phase;
    return p !== undefined && isNarratedPhase(p) ? p : undefined;
  });
  const copy = createMemo(() =>
    props.daemonState !== undefined ? null : connectCanvasCopy(phase(), host()),
  );
  const kavalLabel = () =>
    props.daemonState !== undefined
      ? DAEMON_STATE_PRESENTATION[props.daemonState].canvasLabel
      : "";

  const clockNow = getClockNow();
  const episode = createMemo<Episode | null>(() => {
    const c = copy();
    const frame = info();
    if (c === null || frame === undefined || !c.showsElapsed) return null;
    return { host: host(), epoch: frame.campaignEpoch, ms: frame.sinceMs };
  });
  const anchor = createMemo<ElapsedAnchor | null>(
    (prev) =>
      episodeElapsedAnchor(prev, episode(), () => untrack(() => clockNow())),
    null,
  );
  const elapsedMs = (): number | null => episodeElapsedMs(anchor(), clockNow());

  const log = createMemo<readonly LogLine[]>(() => {
    const frame = info();
    return frame === undefined || !isNarratedPhase(frame.phase)
      ? NO_LOG_LINES
      : frame.log;
  });
  const tail = createMemo(() => tailOf(log()));

  return (
    <Show
      when={copy()}
      fallback={
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
            <Show when={showsElapsed(elapsedMs())}>
              <span
                data-testid="connect-elapsed"
                class="text-fg-4 tabular-nums text-xs"
              >
                {formatElapsedShort(elapsedMs() as number)}
              </span>
            </Show>
          </div>
          <Show when={tail().length > 0}>
            <div class="w-full max-w-2xl">
              <LogTail
                testid="connect-tail"
                lines={tail()}
                log={log()}
                class="h-[6lh] flex flex-col justify-end overflow-hidden px-3 py-2 text-[11px] leading-relaxed"
                onCopyError={(message) =>
                  toast.error(`Failed to copy the log: ${message}`)
                }
              />
            </div>
          </Show>
          <div class="text-xs">
            <DocLink slug="remote-hosts">Add another machine →</DocLink>
          </div>
        </div>
      )}
    </Show>
  );
}

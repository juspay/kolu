/** CanvasFailureCard — the shared warning-card chrome for a terminal canvas failure
 *  surface: a centered `canvas-grid-bg` panel with a warning icon, a title + body, an
 *  optional monospace detail line, and a vertical stack of action buttons.
 *
 *  Extracted from `HostDownCanvas` (#1763) so the new `BootStalledCanvas` renders the SAME
 *  shell rather than a hand-duplicated copy. `DegradedCanvas.tsx`'s `DangerCard` is a sibling
 *  shell for a DIFFERENT severity (danger-toned, single JSX `action` slot, no `detail` line) —
 *  intentionally NOT generalized into this one: unifying a danger single-action card with a
 *  warning multi-action list would couple two independently-changing severities behind one
 *  parameterized shell for a chrome-only saving. This card owns its own (warning) tone and
 *  typed `actions[]` array so `switchToLocalAction()` can spread into either caller. Both
 *  callers supply their own copy authority (`hostDownCopy` / `bootStalledCopy`) and their own
 *  recovery actions; the chrome lives here once.
 *
 *  Two exports, two different purities: {@link CanvasFailureCard} itself is pure
 *  presentation — props in, JSX out, no `wire`, no copy tables — so it is trivially
 *  render-testable and carries no domain knowledge. {@link switchToLocalAction} is NOT
 *  pure — it reads `activeHost`/`setActiveHost` from `../wire` — but lives here rather than
 *  in a separate module because it is the one escape hatch every caller of this shell needs,
 *  so it sits beside the shell it always renders into instead of forcing each caller to
 *  import a third file. */

import { LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import { For, type JSX, Show } from "solid-js";
import { WarningIcon } from "../ui/Icons";
import {
  LOG_TAIL_LINE,
  LOG_TAIL_SURFACE,
  type LogAbsence,
  type LogLine,
} from "../ui/logTailChrome";
import { activeHost, setActiveHost } from "../wire";
import { reconnectHost } from "./reconnectHost";

/** One action button in the card's vertical stack. `tone: "primary"` is the warning-accented
 *  recovery verb (Reconnect / Reload); `"secondary"` is the neutral escape hatch (Switch to
 *  local). `testid` keeps the existing e2e handles (`host-reconnect`, `switch-to-local`, …). */
export interface CanvasFailureAction {
  label: string;
  testid: string;
  onClick: () => void;
  tone: "primary" | "secondary";
}

/** The shared escape-hatch action — "Switch to local", the neutral verb back to the
 *  unremovable LOCAL default. Empty when the active host already IS local (switching to
 *  where you are is a no-op). Both failure canvases (`HostDownCanvas` / `BootStalledCanvas`)
 *  spread it into their actions rather than re-deriving the guard + action object, so the
 *  one escape hatch lives beside the shared card it renders into. */
export function switchToLocalAction(): CanvasFailureAction[] {
  if (activeHost().kind === "local") return [];
  return [
    {
      label: "Switch to local",
      testid: "switch-to-local",
      tone: "secondary",
      onClick: () => setActiveHost(LOCAL_HOST),
    },
  ];
}

/** The shared recovery action — "recycle the SERVER ssh connector for this host into a fresh
 *  dial" (`client.hosts.reconnect`, PR1's abort-in-flight `recheck()`). Both failure canvases
 *  (`HostDownCanvas` / `BootStalledCanvas`) plug into this factory rather than hand-wiring the
 *  same `reconnect` call + error toast, so the one connector-recovery verb lives beside the
 *  shared card it renders into (only `label`/`testid` differ per caller).
 *
 *  On SUCCESS it RESETS this host's boot deadline ({@link resetBootDeadline}) — the deliberate
 *  user-recovery reset (#1908 R8a): a Retry that actually recycles the connector earns a fresh
 *  class + campaign window, so the boot-stalled card dismisses even on a same-class retry (where
 *  the class anchor would otherwise stay exceeded and the verb would look broken). The reset is
 *  gated on the RPC RESOLVING — a REJECTED reconnect must NOT dismiss the card or grant fresh
 *  grace (the retry didn't happen), it surfaces the error and the card stays (codex F9). On the
 *  host-down card the host is `failed` (its anchor already cleared), so the reset is a no-op there. */
export function reconnectAction(opts: {
  label: string;
  testid: string;
}): CanvasFailureAction {
  return {
    label: opts.label,
    testid: opts.testid,
    tone: "primary",
    // Atomic verb lives in reconnectHost — this adapter only binds "active host"
    // + the card's label/testid.
    onClick: () => reconnectHost(activeHost()),
  };
}

/** The shared failure-card shell. `detail` is an optional verbatim line (a raw `reason`, a
 *  connect phase) shown in monospace beneath the body. `dataTestid` / `dataAttrs` let each
 *  caller keep its own outer test handles (`host-down-canvas` + `data-entry-cause`, etc.). */
export function CanvasFailureCard(props: {
  dataTestid: string;
  dataAttrs?: Record<string, string>;
  title: string;
  body: string;
  detail?: string;
  /** The failing episode's retained output, newest last — rendered verbatim in a bounded
   *  scroll beneath `detail`. Structural ({@link LogLine} — `{ line }` only, no domain type,
   *  no `source` provenance): the shell stays pure presentation, and a caller hands it
   *  whatever tail it retained. TOTAL: `[]` is the whole vocabulary for "no lines", so the
   *  card never has to guess what an absence meant. */
  log: readonly LogLine[];
  /** WHY `log` is empty, when the emptiness is not the episode's own fact — `undefined`
   *  for the ordinary case (those lines ARE what it printed, however few).
   *
   *  This card renders the two absences DIFFERENTLY, which is what earns the distinction
   *  its place: `"link-down"` draws a short note saying the output is unavailable, an
   *  ordinary empty tail draws nothing at all (there is nothing to say about a step that
   *  printed nothing). What the card must NOT do is infer WHICH it is looking at — it
   *  cannot. Only the caller holds the liveness fact, so the caller states it and this
   *  shell renders a reason it was TOLD. The card said "kolu's link to this browser went
   *  quiet" off a bare `log === undefined` before, which was true only via a four-file
   *  chain nothing in this type expressed: a second caller passing `undefined` for any
   *  other reason made the card lie confidently.
   *
   *  A FAILED-arm caller (`HostDownCanvas`) always passes `undefined` here — its tail is
   *  the failure record's own `evidence`, stapled at classification and carried past the
   *  floor with the reason (juspay/kolu#2007), so "we cannot see it" is not a state that
   *  arm can be in. `HostDiagnosticsPopover`, reading the same `failedEpisode`, is under
   *  the identical guarantee even though it renders its own tail block rather than this
   *  card (it is not a caller of this prop).
   *  REQUIRED, though it accepts `undefined` — an optional prop is how one of two callers
   *  silently dropped the evidence, so a caller with nothing to declare declares it.
   *
   *  Chrome shared with the other tails is named in `ui/logTailChrome.ts`; everything else
   *  stays local, because the three differ by decision rather than by accident. */
  logAbsence: LogAbsence | undefined;
  /** Test handle for the tail block, supplied by the caller like every other handle on this
   *  shell (`dataTestid` / `dataAttrs` / `action.testid`) — two callers now render a tail, so
   *  a selector has to be able to say WHICH card's it found. */
  logTestid: string;
  /** Optional footer line under the body (e.g. a docs link). */
  footer?: JSX.Element;
  actions: CanvasFailureAction[];
}): JSX.Element {
  return (
    <div
      data-testid={props.dataTestid}
      {...(props.dataAttrs ?? {})}
      class="relative flex-1 min-h-0 flex items-center justify-center canvas-grid-bg"
    >
      <div class="mx-6 max-w-md rounded-xl border border-warning/50 bg-warning/5 px-6 py-5">
        <div class="flex items-start gap-3">
          <WarningIcon class="mt-0.5 h-6 w-6 shrink-0 text-warning" />
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-fg">{props.title}</h2>
            <p class="mt-1.5 text-sm leading-relaxed text-fg-2">{props.body}</p>
            <Show when={props.detail}>
              {(detail) => (
                <p class="mt-2 font-mono text-xs leading-relaxed text-fg-3 break-words">
                  {detail()}
                </p>
              )}
            </Show>
            {/* The caller TOLD us its tail is missing rather than empty, and why. Say so,
                rather than rendering the same nothing an actually-silent step renders:
                the whole point of keeping the two apart is that a reader can tell which
                one they are looking at. */}
            <Show when={props.logAbsence === "link-down"}>
              <p
                data-testid={`${props.logTestid}-unavailable`}
                class="mt-2 text-xs leading-relaxed text-fg-4 italic"
              >
                Output unavailable — kolu's link to this browser went quiet.
              </p>
            </Show>
            <Show when={props.log.length > 0}>
              <div
                data-testid={props.logTestid}
                class={`mt-2 max-h-40 overflow-y-auto px-3 py-2 text-[11px] leading-relaxed ${LOG_TAIL_SURFACE}`}
              >
                <For each={props.log}>
                  {(entry) => <div class={LOG_TAIL_LINE}>{entry.line}</div>}
                </For>
              </div>
            </Show>
            <Show when={props.footer}>
              {(footer) => (
                <div class="mt-2 text-xs leading-relaxed text-fg-3">
                  {footer()}
                </div>
              )}
            </Show>
            <div class="mt-3 flex flex-col gap-2">
              <For each={props.actions}>
                {(action) => (
                  <button
                    type="button"
                    data-testid={action.testid}
                    onClick={() => action.onClick()}
                    class={
                      action.tone === "primary"
                        ? "flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-warning/60 bg-warning/10 px-3 py-2 text-xs font-medium text-fg transition-colors hover:bg-warning/20"
                        : "flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-edge bg-surface-2 px-3 py-2 text-xs font-medium text-fg transition-colors hover:bg-surface-3/60"
                    }
                  >
                    {action.label}
                  </button>
                )}
              </For>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

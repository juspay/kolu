/** CanvasFailureCard — the shared warning-card chrome for a terminal canvas failure
 *  surface: a centered `canvas-grid-bg` panel with a warning icon, a title + body, an
 *  optional monospace detail line, and a vertical stack of action buttons.
 *
 *  Extracted from `HostDownCanvas` (#1763) so the new `BootStalledCanvas` renders the SAME
 *  shell rather than a hand-duplicated copy — the honest choice the gate asked for (there was
 *  no pre-existing shell to "reuse"; this makes one). Both callers supply their own copy
 *  authority (`hostDownCopy` / `bootStalledCopy`) and their own recovery actions; the chrome
 *  lives here once. Pure presentation — no `wire`, no copy tables — so it is trivially
 *  render-testable and carries no domain knowledge. */

import { LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import { For, type JSX, Show } from "solid-js";
import { WarningIcon } from "../ui/Icons";
import { activeHost, setActiveHost } from "../wire";

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

/** The shared failure-card shell. `detail` is an optional verbatim line (a raw `reason`, a
 *  connect phase) shown in monospace beneath the body. `dataTestid` / `dataAttrs` let each
 *  caller keep its own outer test handles (`host-down-canvas` + `data-entry-cause`, etc.). */
export function CanvasFailureCard(props: {
  dataTestid: string;
  dataAttrs?: Record<string, string>;
  title: string;
  body: string;
  detail?: string;
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

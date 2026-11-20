import { LogTail, type LogLine } from "@kolu/solid-logtail";
import { LOCAL_HOST } from "kolu-common/surfacesWithPadi";
import { For, type JSX, Show } from "solid-js";
import { toast } from "solid-sonner";
import { WarningIcon } from "../ui/Icons";
import type { LogAbsence } from "../kaval/canvasModeResolver";
import { activeHost, setActiveHost } from "../wire";
import { runAction } from "../runAction";
import { reconnectHost } from "./reconnectHost";

export type CardLogAbsence = LogAbsence | "none";

export interface CanvasFailureAction {
  label: string;
  testid: string;
  onClick: () => void;
  tone: "primary" | "secondary";
}

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

export function reconnectAction(opts: {
  label: string;
  testid: string;
}): CanvasFailureAction {
  return {
    label: opts.label,
    testid: opts.testid,
    tone: "primary",
    onClick: () => runAction("reconnect host", reconnectHost(activeHost())),
  };
}

export function CanvasFailureCard(props: {
  dataTestid: string;
  dataAttrs?: Record<string, string>;
  title: string;
  body: string;
  detail?: string;
  log: readonly LogLine[];
  logAbsence: CardLogAbsence;
  logTestid: string;
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
            <Show when={props.logAbsence === "link-down"}>
              <p
                data-testid={`${props.logTestid}-unavailable`}
                class="mt-2 text-xs leading-relaxed text-fg-4 italic"
              >
                Output unavailable — kolu's link to this browser went quiet.
              </p>
            </Show>
            <Show when={props.log.length > 0}>
              <LogTail
                testid={props.logTestid}
                lines={props.log}
                log={props.log}
                class="mt-2 max-h-40 overflow-y-auto px-3 py-2 text-[11px] leading-relaxed"
                onCopyError={(message) =>
                  toast.error(`Failed to copy the log: ${message}`)
                }
              />
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

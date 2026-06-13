/**
 * The "Restart kaval" button, with an inline confirmation.
 *
 * Restarting kaval is **destructive** — it stops the daemon and every running
 * terminal (the session is captured first and offered for restore on the fresh
 * daemon) — so the primary button opens an inline confirm rather than restarting
 * on the first click. Inline, *not* a modal, so it never stacks over the kaval
 * dialog it sometimes lives inside (the overlay bug a second `Dialog` caused).
 *
 * Two homes share it — the kaval rail dialog (`tone="neutral"`) and the
 * DegradedCanvas (`tone="danger"`) — so the affordance and the confirm copy
 * can't drift between them. The actual restart is the caller's `onConfirm`: the
 * dialog closes itself first (then restarts); the canvas just restarts.
 */

import type { DaemonStatus } from "kolu-common/surface";
import { type Component, createSignal, Show } from "solid-js";
import { restartInFlight } from "./useDaemonRestart";
import { RestartIcon } from "../ui/Icons";

/** Per-tone accent for the trigger + the confirm's Restart button. */
const ACCENT: Record<"neutral" | "danger", string> = {
  neutral: "border-edge bg-surface-2 text-fg hover:bg-surface-3/60",
  danger: "border-danger/40 bg-danger/10 text-fg hover:bg-danger/20",
};

const RestartKavalButton: Component<{
  /** The daemon's status — gates the button out while a restart is in flight. */
  status: DaemonStatus | undefined;
  tone: "neutral" | "danger";
  /** Run when the user confirms. The dialog closes itself here; the canvas
   *  just calls `restartDaemon()`. */
  onConfirm: () => void;
}> = (props) => {
  const [confirming, setConfirming] = createSignal(false);
  const inFlight = (): boolean => restartInFlight(props.status);
  return (
    <Show
      when={confirming() && !inFlight()}
      fallback={
        // Primary affordance — opens the confirm step (doesn't restart yet).
        // `cursor-pointer` so it reads as clickable.
        <button
          type="button"
          data-testid="restart-kaval"
          disabled={inFlight()}
          onClick={() => setConfirming(true)}
          class={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${ACCENT[props.tone]}`}
        >
          <RestartIcon class="h-3.5 w-3.5" />
          {inFlight() ? "Restarting…" : "Restart kaval"}
        </button>
      }
    >
      {/* Inline confirmation — restarting kills the daemon + all terminals. */}
      <div class="space-y-2">
        <p class="text-[11px] leading-relaxed text-fg-3">
          Restart kaval? This stops the daemon and every running terminal — your
          session is captured first and offered for restore on the fresh daemon.
        </p>
        <div class="flex gap-2">
          <button
            type="button"
            data-testid="restart-kaval-cancel"
            onClick={() => setConfirming(false)}
            class="flex-1 cursor-pointer rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg-2 transition-colors hover:bg-surface-3/60"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="restart-kaval-confirm"
            onClick={() => {
              setConfirming(false);
              props.onConfirm();
            }}
            class={`flex-1 cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${ACCENT[props.tone]}`}
          >
            Restart kaval
          </button>
        </div>
      </div>
    </Show>
  );
};

export default RestartKavalButton;

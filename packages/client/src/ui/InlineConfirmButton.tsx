/**
 * InlineConfirmButton — the shared inline-confirmation shell for a destructive
 * daemon action: a primary trigger that opens an inline confirm step (copy +
 * Cancel/confirm pair) instead of firing on the first click. Inline, *not* a
 * modal, so it never stacks over the dialog it sometimes lives inside (the
 * overlay bug a second `Dialog` caused).
 *
 * Extracted from `RestartKavalButton` so the second destructive kaval action —
 * "Update &amp; restart kaval" (`hosts.renewDaemon`, the contract-skew recovery,
 * SK5) — reuses the exact affordance rather than re-implementing the confirm
 * scaffolding; only the copy, tone, and the confirmed action differ per caller.
 */

import { type Component, createSignal, type JSX, Show } from "solid-js";

/** Per-tone accent for the trigger + the confirm's action button. */
const CONFIRM_ACCENT: Record<"neutral" | "danger" | "warning", string> = {
  neutral: "border-edge bg-surface-2 text-fg hover:bg-surface-3/60",
  danger: "border-danger/40 bg-danger/10 text-fg hover:bg-danger/20",
  /** A destructive-but-recoverable act — the state-backup restore, which
   *  snapshots the current state first. */
  warning: "border-warning/50 bg-warning/20 text-fg hover:bg-warning/30",
};

const InlineConfirmButton: Component<{
  /** The action's label — trigger AND confirm button (e.g. "Restart kaval"). */
  label: string;
  /** Trigger label while the action is in flight (e.g. "Restarting…"). */
  inFlightLabel: string;
  /** The confirm step's explanatory copy. */
  confirmCopy: string;
  tone: "neutral" | "danger" | "warning";
  /** Gates the trigger out while the action is already in flight. */
  inFlight: boolean;
  /** Leading icon on the trigger. */
  icon?: JSX.Element;
  /** data-testid prefix — renders `<prefix>`, `<prefix>-cancel`, `<prefix>-confirm`. */
  testid: string;
  /** Run when the user confirms. */
  onConfirm: () => void;
}> = (props) => {
  const [confirming, setConfirming] = createSignal(false);
  return (
    <Show
      when={confirming() && !props.inFlight}
      fallback={
        // Primary affordance — opens the confirm step (doesn't act yet).
        <button
          type="button"
          data-testid={props.testid}
          disabled={props.inFlight}
          onClick={() => setConfirming(true)}
          class={`flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${CONFIRM_ACCENT[props.tone]}`}
        >
          {props.icon}
          {props.inFlight ? props.inFlightLabel : props.label}
        </button>
      }
    >
      <div class="space-y-2">
        <p class="text-[11px] leading-relaxed text-fg-3">{props.confirmCopy}</p>
        <div class="flex gap-2">
          <button
            type="button"
            data-testid={`${props.testid}-cancel`}
            onClick={() => setConfirming(false)}
            class="flex-1 cursor-pointer rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg-2 transition-colors hover:bg-surface-3/60"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid={`${props.testid}-confirm`}
            onClick={() => {
              setConfirming(false);
              props.onConfirm();
            }}
            class={`flex-1 cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${CONFIRM_ACCENT[props.tone]}`}
          >
            {props.label}
          </button>
        </div>
      </div>
    </Show>
  );
};

export default InlineConfirmButton;

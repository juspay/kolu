/** THE HEADER'S `⋯` — a menu, and only a menu.
 *
 *  The defect this component exists to close: the `⋯` used to START A NEW
 *  SESSION on the press. A `⋯` is the one affordance in every piece of chrome
 *  that promises *there is more here* and promises nothing about what — so a
 *  person presses it to LOOK, and the conversation they were reading was gone
 *  before they had decided anything. The button now performs nothing at all;
 *  everything it can do is a row in here, and the one destructive row is
 *  behind the repo's own confirm shell.
 *
 *  Built on `useAnchoredPopover`, the same primitive the settings popover next
 *  to it uses, so the keyboard, `Escape` and click-outside are the chrome's
 *  one implementation rather than a third hand-rolled dropdown.
 *
 *  WHAT IS OFFERED IS WHAT IS TRUE. `Stop` exists only while a turn is
 *  running (there is nothing to stop otherwise), and `Sign in…` only while
 *  the agent is not signed in. Neither is drawn disabled: a greyed row is a
 *  row a person reads, reaches for and then has to work out, and the fact
 *  behind both is already on the wire. */

import type { OrchestratorRow } from "kolu-common/orchestrator";
import { writeTextToClipboard } from "@kolu/solid-logtail";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import { type Component, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { toast } from "solid-sonner";
import { runAction, type UiAction } from "../runAction";
import InlineConfirmButton from "../ui/InlineConfirmButton";
import { surface } from "../ui/Surface";
import { useAnchoredPopover } from "../ui/useAnchoredPopover";
import { transcriptText } from "./transcript";
import { useOrchestrator } from "./useOrchestrator";

/** The sentence the confirm asks under. It names every thing that goes,
 *  because the one fact a person needs before pressing again is that this is
 *  not the divider-and-carry-on they may remember. */
const WIPE_COPY =
  "Start a new session? This conversation's messages, the files attached to them and the terminals it remembers are deleted — on this host too. There is no undo.";

const OrchestratorMenu: Component<{
  /** What `Copy transcript` copies — the rows the panel is drawing, passed in
   *  rather than re-subscribed, because a second subscription to the one
   *  transcript is a second list to disagree with. */
  rows: readonly OrchestratorRow[];
  triggerRef: HTMLElement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A turn is running. */
  working: boolean;
  /** The agent said who it is signed in AS. Silence is not signed in — the
   *  cell's own rule — so an agent that said nothing still gets the row. */
  signedIn: boolean;
  /** Opens the sign-in row under the transcript. */
  onSignIn: () => void;
}> = (props) => {
  const orch = useOrchestrator();
  const chrome = surface({ radius: "lg", shadow: "soft", portalled: true });
  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: () => props.triggerRef,
    open: () => props.open,
    onDismiss: () => props.onOpenChange(false),
    anchor: "bottom-end",
    panelMinWidth: 240,
  });

  /** Build-and-write as ONE program at the click edge: `writeTextToClipboard`
   *  falls back to `execCommand`, which only works inside the user-activation
   *  window, so nothing may be awaited before it (`CopyDiagnosticsButton` has
   *  the whole argument). */
  const copy = (): UiAction =>
    Effect.suspend(() => writeTextToClipboard(transcriptText(props.rows))).pipe(
      Effect.tap(() => Effect.sync(() => toast.success("Transcript copied"))),
      Effect.catch((err: unknown) =>
        Effect.sync(() => {
          toast.error(`Could not copy the transcript: ${toError(err).message}`);
        }),
      ),
    );

  const pick = (run: () => void): void => {
    props.onOpenChange(false);
    run();
  };

  return (
    <Show when={props.open}>
      <Portal>
        <div
          ref={panelRef}
          data-testid="orchestrator-menu-panel"
          role="menu"
          class={`fixed z-50 ${chrome.class} p-2 w-[17rem]`}
          style={{ ...panelStyle(), ...chrome.style }}
        >
          {/* The destructive row, in the repo's one confirm shell — it owns
              the confirm step, the Cancel/confirm pair and the testid
              triplet every other destructive act in this app exposes. */}
          <InlineConfirmButton
            label="New session"
            inFlightLabel="New session"
            confirmCopy={WIPE_COPY}
            tone="danger"
            inFlight={false}
            testid="orchestrator-menu-new-session"
            onConfirm={() => pick(() => orch.clearSession())}
          />
          <Show when={props.working}>
            <button
              type="button"
              role="menuitem"
              data-testid="orchestrator-menu-stop"
              class="mt-1 w-full text-left px-2 py-1 rounded-md text-xs text-fg hover:bg-surface-2 cursor-pointer"
              onClick={() => pick(() => orch.cancel())}
            >
              Stop
            </button>
          </Show>
          <Show when={!props.signedIn}>
            <button
              type="button"
              role="menuitem"
              data-testid="orchestrator-menu-signin"
              class="mt-1 w-full text-left px-2 py-1 rounded-md text-xs text-fg hover:bg-surface-2 cursor-pointer"
              onClick={() => pick(() => props.onSignIn())}
            >
              Sign in…
            </button>
          </Show>
          <button
            type="button"
            role="menuitem"
            data-testid="orchestrator-menu-copy"
            class="mt-1 w-full text-left px-2 py-1 rounded-md text-xs text-fg hover:bg-surface-2 cursor-pointer"
            onClick={() => pick(() => runAction("copy transcript", copy()))}
          >
            Copy transcript
          </button>
        </div>
      </Portal>
    </Show>
  );
};

export default OrchestratorMenu;

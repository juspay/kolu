import type { ConductorRow, ConductorState } from "kolu-common/conductor";
import { writeTextToClipboard } from "@kolu/solid-logtail";
import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import { type Component, For, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { toast } from "solid-sonner";
import { runAction, type UiAction } from "../runAction";
import InlineConfirmButton from "../ui/InlineConfirmButton";
import { surface } from "../ui/Surface";
import { useAnchoredPopover } from "../ui/useAnchoredPopover";
import { transcriptText } from "./transcript";
import { helpSheet } from "./helpContent";
import { conductorHelpColumn } from "./conductorLayout";
import { useConductor } from "./useConductor";

const WIPE_COPY =
  "Start a new session? This conversation's messages, the files attached to them and the terminals it remembers are deleted — on this host too. There is no undo.";

type Standing = ConductorState["servers"][number]["standing"];
const STANDING_CLASS: Record<Standing, string> = {
  connected: "text-ok",
  handed: "text-fg-2",
  unattached: "text-attention",
  missing: "text-danger",
};

const ConductorMenu: Component<{
  rows: readonly ConductorRow[];
  triggerRef: HTMLElement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A turn is running. */
  working: boolean;
  signedIn: boolean;
  /** Opens the sign-in row under the transcript. */
  onSignIn: () => void;
  servers: ConductorState["servers"];
}> = (props) => {
  const orch = useConductor();
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
          data-testid="conductor-menu-panel"
          role="menu"
          class={`fixed z-50 ${chrome.class} p-2 w-[17rem]`}
          style={{ ...panelStyle(), ...chrome.style }}
        >
          <InlineConfirmButton
            label="New session"
            inFlightLabel="New session"
            confirmCopy={WIPE_COPY}
            tone="danger"
            inFlight={false}
            testid="conductor-menu-new-session"
            onConfirm={() => pick(() => orch.clearSession())}
          />
          <Show when={props.working}>
            <button
              type="button"
              role="menuitem"
              data-testid="conductor-menu-stop"
              class="mt-1 w-full text-left px-2 py-1 rounded-md text-xs text-fg hover:bg-surface-2 cursor-pointer"
              onClick={() => pick(() => orch.cancel())}
            >
              Stop
            </button>
          </Show>
          <button
            type="button"
            role="menuitem"
            data-testid="conductor-menu-signin"
            data-signed-in={props.signedIn ? "" : undefined}
            class="mt-1 w-full text-left px-2 py-1 rounded-md text-xs text-fg hover:bg-surface-2 cursor-pointer"
            onClick={() => pick(() => props.onSignIn())}
          >
            {props.signedIn ? "Sign in again…" : "Sign in…"}
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="conductor-menu-copy"
            class="mt-1 w-full text-left px-2 py-1 rounded-md text-xs text-fg hover:bg-surface-2 cursor-pointer"
            onClick={() => pick(() => runAction("copy transcript", copy()))}
          >
            Copy transcript
          </button>
          <Show when={!conductorHelpColumn()}>
            <button
              type="button"
              role="menuitem"
              data-testid="conductor-menu-help"
              class="mt-1 w-full text-left px-2 py-1 rounded-md text-xs text-fg hover:bg-surface-2 cursor-pointer"
              onClick={() => pick(() => helpSheet.openDialog())}
            >
              How to use
            </button>
          </Show>
          <Show when={props.servers.length > 0}>
            <div class="mt-2 border-t border-edge pt-2">
              <p class="m-0 mb-1 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-fg-3">
                tool servers
              </p>
              <For each={props.servers}>
                {(server) => (
                  <p
                    data-testid="conductor-server"
                    data-server={server.name}
                    data-standing={server.standing}
                    class={`m-0 px-2 font-mono text-[0.68rem] ${STANDING_CLASS[server.standing]}`}
                  >
                    <span class="font-semibold">
                      {server.name}
                      {server.standing === "connected" ? " ✓" : ""}
                    </span>
                    <Show when={server.standing !== "connected"}>
                      <span class="font-normal text-fg-3">
                        {" "}
                        · {server.said ?? server.where ?? server.standing}
                      </span>
                    </Show>
                  </p>
                )}
              </For>
              <p class="m-0 px-2 font-mono text-[0.68rem] text-fg-3">
                · plus the agent's own
              </p>
            </div>
          </Show>
        </div>
      </Portal>
    </Show>
  );
};

export default ConductorMenu;

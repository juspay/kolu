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
 *  behind both is already on the wire.
 *
 *  IT ALSO HOLDS THE ROSTER. `kolu ✓ · plus the agent's own` was a strip
 *  above every conversation — a permanent row answering a question a person
 *  asks about twice a week. The fact did not move: it is read here now, as a
 *  section this menu's one press opens. */

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
import { useConductor } from "./useConductor";

/** The sentence the confirm asks under. It names every thing that goes,
 *  because the one fact a person needs before pressing again is that this is
 *  not the divider-and-carry-on they may remember. */
const WIPE_COPY =
  "Start a new session? This conversation's messages, the files attached to them and the terminals it remembers are deleted — on this host too. There is no undo.";

/** The three standings a roster row can hold, keyed by the union so a fourth
 *  one added to the schema fails the typecheck here rather than painting
 *  unstyled. There is no `missing`: a server kolu could not reach does not get
 *  a red row, it refuses the whole conversation (kolu-server's
 *  `ConductorUnavailable`), because a conductor that cannot reach the fleet is
 *  not a degraded conductor. */
type Standing = ConductorState["servers"][number]["standing"];
const STANDING_CLASS: Record<Standing, string> = {
  connected: "text-ok",
  handed: "text-fg-2",
  unattached: "text-attention",
};

const ConductorMenu: Component<{
  /** What `Copy transcript` copies — the rows the panel is drawing, passed in
   *  rather than re-subscribed, because a second subscription to the one
   *  transcript is a second list to disagree with. */
  rows: readonly ConductorRow[];
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
  /** The tool servers this conversation was handed, and how each one stands
   *  by the AGENT'S own word. They used to be a strip above the transcript on
   *  every conversation all day; they are a thing a person looks up — "does it
   *  really have kolu's hands?" — which is what this menu is. */
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
          {/* The destructive row, in the repo's one confirm shell — it owns
              the confirm step, the Cancel/confirm pair and the testid
              triplet every other destructive act in this app exposes. */}
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
          <Show when={!props.signedIn}>
            <button
              type="button"
              role="menuitem"
              data-testid="conductor-menu-signin"
              class="mt-1 w-full text-left px-2 py-1 rounded-md text-xs text-fg hover:bg-surface-2 cursor-pointer"
              onClick={() => pick(() => props.onSignIn())}
            >
              Sign in…
            </button>
          </Show>
          <button
            type="button"
            role="menuitem"
            data-testid="conductor-menu-copy"
            class="mt-1 w-full text-left px-2 py-1 rounded-md text-xs text-fg hover:bg-surface-2 cursor-pointer"
            onClick={() => pick(() => runAction("copy transcript", copy()))}
          >
            Copy transcript
          </button>
          {/* THE ROSTER — read, never pressed, so it is a section under the
              rows and not a row among them. The tick is the AGENT'S word and
              only its word: `connected` is the agent reporting the server
              attached, and the other standings each say their own thing
              instead of borrowing it. An `unattached` server carries the
              agent's own sentence about why, because that sentence is the
              whole answer to the question this section is opened with. */}
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
              {/* The agent brings its own servers and we never handed them, so
                  the roster says so rather than inventing rows for them. */}
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

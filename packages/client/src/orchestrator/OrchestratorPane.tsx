/** The orchestrator, whole: one host's conversation as a pane.
 *
 *  Mounted only while orchestrator mode is on (desktop) or the sheet is open
 *  (touch), and it owns the transcript subscription for exactly that long —
 *  the stream is snapshot-then-deltas, so re-entering the mode re-syncs rather
 *  than replaying. Everything that must survive a mode flip (the composer's
 *  text, a half-filled answer, the cell itself) lives in a singleton outside
 *  this component.
 *
 *  `install.kind === "absent"` is a HARD face, not a degraded one: the ACP
 *  adapter is baked into kolu's closure, so its absence is either a build that
 *  lost it or a child that died. The panel shows the sentence whoever found out
 *  wrote, verbatim, and offers no composer and no fallback path. */

import { makeEventListener } from "@solid-primitives/event-listener";
import {
  type Component,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from "solid-js";
import { toast } from "solid-sonner";
import { capturePointerGesture } from "../canvas/viewport/capturePointerGesture";
import { useDialogStack } from "../ui/useDialogStack";
import { attachDroppedFiles } from "./attachFiles";
import { completionOpen } from "./drafts";
import OrchestratorComposer from "./OrchestratorComposer";
import OrchestratorFleet from "./OrchestratorFleet";
import OrchestratorHeader from "./OrchestratorHeader";
import OrchestratorSignIn from "./OrchestratorSignIn";
import OrchestratorStrip from "./OrchestratorStrip";
import OrchestratorTranscript from "./OrchestratorTranscript";
import {
  clampDraggedPaneWidth,
  orchestratorPaneWidth,
  PANE_MIN_WIDTH_PX,
  PANE_WIDTH_PX,
  PEEK_MIN_WIDTH_PX,
  setOrchestratorPaneWidth,
} from "./orchestratorPaneWidth";
import { useOrchestrator } from "./useOrchestrator";
import { exitOrchestratorMode } from "./useOrchestratorMode";
import { createOrchestratorTranscript } from "./useOrchestratorTranscript";

const OrchestratorPane: Component<{
  class?: string;
  /** Which edge carries the resize grip — the edge the pane shares with what
   *  it was split from. Absent in the touch sheet, which is the whole screen
   *  and has no split to move. */
  grip?: "left" | "right";
}> = (props) => {
  const orch = useOrchestrator();
  const feed = createOrchestratorTranscript();
  let transcriptEl: HTMLDivElement | undefined;
  let paneEl!: HTMLElement;

  const dialogStack = useDialogStack();

  // `Esc` RETURNS to the posture underneath — the mode is a layer, not a
  // destination, so leaving it needs no memory of where you were. The listener
  // lives here because the behaviour belongs to the pane: it exists exactly
  // while the pane does, on desktop and in the touch sheet alike.
  //
  // TWO listeners, and the split is the whole point. A capture-phase listener
  // on the window sees `Escape` before ANYTHING else — which is what the peek
  // pane needs, because it is a live terminal and xterm claims the key for the
  // program running in the PTY without ever letting it reach the window. It is
  // also, applied anywhere else, a key thief: every popover, Corvu dialog,
  // `SearchBar`, `PrintedUrlCard` and `CodeContextMenu` dismisses on `Escape`,
  // and a capture listener that swallowed the key left the overlay open while
  // the mode quietly exited underneath it.
  //
  // So the capture listener is scoped to `.xterm` AND NOTHING ELSE — the one
  // place the key provably never reaches the window. Scoping it to the whole
  // pane instead made the pane's own popovers undismissable: the model and
  // settings panels open from a trigger that keeps focus inside the pane, so
  // the capture listener left the mode before `useAnchoredPopover`'s own
  // document-level dismiss ever ran, and the panel stayed on screen over a
  // canvas. Everything outside an xterm is handled on the way back up, where
  // an overlay that stops propagation or marks the key handled simply wins.
  const eatsEscape = (target: EventTarget | null): boolean =>
    target instanceof Element && target.closest(".xterm") !== null;
  // When a modal is up the press is ITS dismiss, and the mode must not take the
  // same one. Corvu's `createEscapeKeyDown` closes a dialog WITHOUT marking the
  // event handled, so neither listener below can learn it from the event — the
  // depth `ModalDialog` already publishes is the fact, and it counts every
  // dialog (palette, Settings, About, the intent editor, a confirm) for free.
  // Same rule for an open completion menu, which `drafts.ts` publishes for the
  // same reason.
  const standDown = (): boolean =>
    completionOpen() || dialogStack.openCount() > 0;
  makeEventListener(
    window,
    "keydown",
    (event: KeyboardEvent) => {
      if (event.key !== "Escape" || standDown()) return;
      if (!eatsEscape(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      exitOrchestratorMode();
    },
    { capture: true },
  );
  makeEventListener(window, "keydown", (event: KeyboardEvent) => {
    // `defaultPrevented` is the other half of "an overlay won": a dismiss that
    // handled the key without stopping it still reaches here, and leaving the
    // mode on the same press would close two things with one `Esc`.
    if (event.key !== "Escape" || standDown() || event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    exitOrchestratorMode();
  });

  // The grip. The width is PERSISTED but a drag writes a local signal and
  // commits once on release — `makePersisted` has no debounce, so a per-frame
  // commit would hit `localStorage` 60-120×/s for the length of the gesture.
  // The same two-signal shape (and the same `capturePointerGesture`) as the
  // dock's own resize.
  const [dragWidth, setDragWidth] = createSignal<number | null>(null);
  let abortResize: AbortController | null = null;
  function startResize(e: PointerEvent) {
    // Primary button only — a right/middle-button drag on the edge should not
    // resize (and would fight the context menu).
    if (e.button !== 0) return;
    // A resize is already in flight — ignore further pointerdowns rather than
    // abort-and-replace, so a second touch/pen cannot hijack the gesture from
    // the pointer that owns it.
    if (abortResize) return;
    e.preventDefault();
    const startX = e.clientX;
    // The RENDERED width, so a pane the CSS cap has narrowed does not jump on
    // grab.
    const startWidth = paneEl.getBoundingClientRect().width;
    // A grip on the LEFT edge grows the pane as the pointer moves left.
    const sign = props.grip === "left" ? -1 : 1;
    // WHAT THE TWO HALVES SHARE. The grip's ceiling is not a fraction of the
    // row — it is whatever is left once the peek keeps its twenty columns, so
    // the chat can take nearly the whole window when that is what you are
    // reading. The other half is the sibling the grip's edge faces: the pane
    // sits between the dock and the viewport with a `right` grip, and after
    // the surface it was split from with a `left` one.
    const neighbour =
      props.grip === "left"
        ? paneEl.previousElementSibling
        : paneEl.nextElementSibling;
    if (neighbour === null) {
      throw new Error(
        "orchestrator pane has a grip but nothing to share the row with",
      );
    }
    const available = startWidth + neighbour.getBoundingClientRect().width;
    abortResize = new AbortController();
    capturePointerGesture(
      {
        onMove: (ev) =>
          setDragWidth(
            clampDraggedPaneWidth(
              startWidth + sign * (ev.clientX - startX),
              available,
            ),
          ),
        onEnd: () => {
          // Commit exactly once. `dragWidth` stays null on a pointerdown with
          // no motion (a bare click on the grip) — skip the write.
          const width = dragWidth();
          if (width !== null) setOrchestratorPaneWidth(width);
          setDragWidth(null);
          abortResize = null;
        },
        onCancel: () => {
          // The stored width was never touched during the drag, so reverting is
          // just dropping the local one.
          setDragWidth(null);
          abortResize = null;
        },
      },
      abortResize,
      // Bind to the initiating pointer so a second touch/pen cannot drive or
      // end this resize.
      e.pointerId,
    );
  }
  // Leaving the mode mid-drag must abort the in-flight gesture rather than leak
  // window listeners.
  onCleanup(() => abortResize?.abort());

  const state = orch.state;
  /** The `absent` sentence, as a PRIMITIVE — a `<Show>` keyed on the install
   *  object would re-create the face on every cell tick, and this is the one
   *  branch in the pane that must not flicker. */
  const absent = createMemo(() => {
    const install = state().install;
    return install.kind === "absent" ? install : undefined;
  });

  const reveal = (rowId: string): void => {
    transcriptEl
      ?.querySelector(`[data-row-id="${CSS.escape(rowId)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  // DROPPING A FILE ON THE CONVERSATION attaches it to the next message — the
  // whole pane is the target, not the textarea, because the box is three lines
  // at the bottom of a tall column and aiming at it is a game. The affordance
  // has to be visible while the drag is over it: a drop target you cannot see
  // is a drop you make twice.
  const [dropping, setDropping] = createSignal(false);
  /** Only a drag carrying FILES. A dragged selection or a link is text, and
   *  text belongs to whatever it is dropped on — taking those over would make
   *  the pane eat an ordinary drag. A pane with no composer under it (the
   *  agent is absent, or it refused to open the conversation) takes nothing:
   *  there would be nowhere for the chip to appear. */
  const takesDrop = (event: DragEvent): boolean =>
    (event.dataTransfer?.types.includes("Files") ?? false) &&
    absent() === undefined &&
    state().refusal === null;
  /** Bind the three drag events to the pane itself.
   *
   *  Imperative, from the ref, for the same reason the terminal's own drop
   *  path is: this is a static section, not a control, and the alternative is
   *  an `onDrop` on a `<section>` that a11y linting rightly objects to — the
   *  honest fix is to attach the listener, not to give the element a role it
   *  does not have. */
  const bindDrop = (el: HTMLElement): void => {
    makeEventListener(el, "dragover", (event: DragEvent) => {
      if (!takesDrop(event)) return;
      // Without the preventDefault the browser refuses the drop and then
      // NAVIGATES to the file when it lands, taking the whole session with it
      // — the one failure a file drop must never have.
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "copy";
      setDropping(true);
    });
    makeEventListener(el, "dragleave", (event: DragEvent) => {
      // `dragleave` fires crossing every child boundary too; only a pointer
      // that has actually left the pane ends the affordance, or it flickers
      // its way down the transcript.
      const next = event.relatedTarget as Node | null;
      if (next !== null && el.contains(next)) return;
      setDropping(false);
    });
    makeEventListener(el, "drop", (event: DragEvent) => {
      if (!takesDrop(event)) return;
      event.preventDefault();
      setDropping(false);
      attachDroppedFiles([...(event.dataTransfer?.files ?? [])]);
    });
  };

  return (
    <section
      ref={(el) => {
        paneEl = el;
        bindDrop(el);
      }}
      data-testid="orchestrator-pane"
      data-phase={state().phase}
      class={`relative flex flex-col min-w-0 min-h-0 bg-surface-0 ${props.class ?? ""}`}
      // The cap at RENDER time is CSS, not arithmetic — this component does
      // not measure its host. `max-width` leaves the peek its minimum in a row
      // narrowed under a stored-wide chat, and `flex: 0 1 auto` with the
      // chat's own floor as `min-width` makes the CHAT give way first when the
      // row cannot hold both: the peek is `flex-1 min-w-0` and would otherwise
      // absorb every pixel of the shortfall and vanish. The stored width is
      // untouched either way, so the chat re-widens when the window grows.
      style={
        props.grip
          ? {
              width: `${dragWidth() ?? orchestratorPaneWidth()}px`,
              "max-width": `calc(100% - ${PEEK_MIN_WIDTH_PX}px)`,
              "min-width": `${PANE_MIN_WIDTH_PX}px`,
              flex: "0 1 auto",
            }
          : undefined
      }
    >
      <Show when={dropping()}>
        <div
          data-testid="orchestrator-drop-target"
          class="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-sm border-2 border-dashed border-accent bg-surface-0/80 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-accent"
        >
          Drop to attach
        </div>
      </Show>
      <Show when={props.grip}>
        {(grip) => (
          /* biome-ignore lint/a11y/noStaticElementInteractions: pointer-only
             resize affordance, same as the dock's edge handle — the cursor is
             the affordance, and this drag offers no keyboard step to bind an
             aria-value range to. */
          <div
            data-testid="orchestrator-pane-handle"
            class="absolute inset-y-0 z-40 w-1.5 cursor-col-resize hover:bg-accent/30 transition-colors"
            classList={{
              "right-0": grip() === "right",
              "left-0": grip() === "left",
            }}
            title="Drag to resize · double-click to reset"
            onPointerDown={startResize}
            onDblClick={() => setOrchestratorPaneWidth(PANE_WIDTH_PX)}
          />
        )}
      </Show>
      <Show
        when={absent()}
        fallback={
          <>
            <OrchestratorHeader
              state={state()}
              onSignIn={() => {
                if (state().signIn !== null) return;
                // Nothing to offer is a fact about the AGENT, not a button that
                // quietly does nothing: it has not asked anybody to sign in.
                toast.info(
                  `${state().agentName} has not offered a way to sign in`,
                );
              }}
            />
            <OrchestratorStrip
              servers={state().servers}
              watching={state().watching}
              onReveal={reveal}
            />
            <Show when={state().signIn}>
              {(signIn) => <OrchestratorSignIn signIn={signIn()} />}
            </Show>
            <OrchestratorFleet fleet={state().fleet} />
            <OrchestratorTranscript
              rows={feed.rows()}
              pending={feed.pending()}
              error={feed.error()}
              containerRef={(el) => {
                transcriptEl = el;
              }}
            />
            {/* A conversation the agent would not OPEN has no composer under
                it: there is nothing to say to an agent that is not there. The
                one offer is to ask again for exactly what was refused. */}
            <Show
              when={state().refusal}
              fallback={<OrchestratorComposer state={state()} />}
            >
              {(why) => (
                <div
                  data-testid="orchestrator-refusal"
                  class="border-t border-edge px-4 py-3 text-xs text-fg-2"
                >
                  <p class="mb-2 whitespace-pre-wrap">{why()}</p>
                  <button
                    type="button"
                    data-testid="orchestrator-retry"
                    class="rounded-md border border-edge-bright bg-surface-2 hover:bg-surface-3 px-2.5 py-1 text-fg cursor-pointer"
                    onClick={() => orch.newSession()}
                  >
                    Try again
                  </button>
                </div>
              )}
            </Show>
          </>
        }
      >
        {(install) => (
          <div
            data-testid="orchestrator-absent"
            class="m-auto max-w-sm px-6 text-center"
          >
            <p class="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-fg-3">
              {install().name} is not installed
            </p>
            <p class="mt-2 text-sm text-fg-2 whitespace-pre-wrap">
              {install().why}
            </p>
            <Show when={install().where}>
              {(where) => (
                <p class="mt-2 font-mono text-[0.68rem] text-fg-3 break-all">
                  {where()}
                </p>
              )}
            </Show>
          </div>
        )}
      </Show>
    </section>
  );
};

export default OrchestratorPane;

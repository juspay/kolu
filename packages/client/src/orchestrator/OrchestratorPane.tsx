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
import { completionOpen } from "./drafts";
import OrchestratorComposer from "./OrchestratorComposer";
import OrchestratorFleet from "./OrchestratorFleet";
import OrchestratorHeader from "./OrchestratorHeader";
import OrchestratorSignIn from "./OrchestratorSignIn";
import OrchestratorStrip from "./OrchestratorStrip";
import OrchestratorTranscript from "./OrchestratorTranscript";
import {
  clampOrchestratorPaneWidth,
  orchestratorPaneWidth,
  PANE_WIDTH_PX,
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
    abortResize = new AbortController();
    capturePointerGesture(
      {
        onMove: (ev) =>
          setDragWidth(
            clampOrchestratorPaneWidth(
              startWidth + sign * (ev.clientX - startX),
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

  return (
    <section
      ref={paneEl}
      data-testid="orchestrator-pane"
      data-phase={state().phase}
      class={`relative flex flex-col min-w-0 min-h-0 bg-surface-0 ${props.class ?? ""}`}
      // The CAP is CSS, not arithmetic: `max-width` keeps the pane under 60% of
      // whatever row it is in, so a window narrowed under a stored-wide chat
      // still shows the terminal beside it and still has its grip on screen —
      // without this component measuring its host. The stored width is
      // untouched, so the chat re-widens when the window grows back.
      style={
        props.grip
          ? {
              width: `${dragWidth() ?? orchestratorPaneWidth()}px`,
              "max-width": "60%",
              flex: "0 0 auto",
            }
          : undefined
      }
    >
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

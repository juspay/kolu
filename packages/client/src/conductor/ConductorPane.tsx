/** The conductor, whole: the conversation as a pane.
 *
 *  THE CHAT. Header, the strip (tool-server roster, background tasks,
 *  subagents), the transcript, the composer — no Dock, no fleet list, no
 *  canvas. The entry in the chrome bar is a DESTINATION, not a layer over the
 *  workspace: a person who selected it is reading a conversation. An agent the
 *  conversation started is checked from inside it — the create card's status
 *  line and its Look at the terminal's screen — and reached on the host tab it
 *  lives on (which every tool card offers, in one press).
 *
 *  Mounted on the first visit and then RETAINED for the page's life: leaving
 *  for a host tab hides it (`App.tsx`'s out-of-flow host with
 *  `content-visibility: hidden`) rather than unmounting it, so everything a
 *  person had open in here is still open on the way back. The subtree asks
 *  `useConductorShown()` before doing any work, because a retained view that
 *  kept reading screens and ticking clocks for nobody would be a worse bug
 *  than the one retention fixes. The transcript subscription is therefore
 *  opened ONCE, on that first visit, and held: it is snapshot-then-deltas and
 *  idle-cheap, and a stream that closed and re-synced on every tab switch is
 *  exactly the round-trip cost the retained pane exists to stop. The
 *  composer's text, a half-filled answer and the cell itself still live in a
 *  singleton outside this component — they outlive a NEW SESSION, which the
 *  pane does not.
 *
 *  `install.kind === "absent"` is a HARD face, not a degraded one: the ACP
 *  adapter is baked into kolu's closure, so its absence is either a build that
 *  lost it or a child that died. The panel shows the sentence whoever found out
 *  wrote, verbatim, and offers no composer and no fallback path. */

import { makeEventListener } from "@solid-primitives/event-listener";
import { type Component, createMemo, createSignal, Show } from "solid-js";
import { toast } from "solid-sonner";
import { useDialogStack } from "../ui/useDialogStack";
import { attachDroppedFiles } from "./attachFiles";
import { completionOpen } from "./drafts";
import { useConductorShown } from "./conductorShown";
import ConductorComposer from "./ConductorComposer";
import ConductorHeader from "./ConductorHeader";
import ConductorSignIn from "./ConductorSignIn";
import ConductorStatus from "./ConductorStatus";
import ConductorStrip from "./ConductorStrip";
import ConductorTranscript from "./ConductorTranscript";
import { useConductor } from "./useConductor";
import { exitConductorMode } from "./useConductorMode";
import { createConductorTranscript } from "./useConductorTranscript";
import { revealTranscriptRow } from "./transcriptScroll";

const ConductorPane: Component<{
  class?: string;
}> = (props) => {
  const orch = useConductor();
  const feed = createConductorTranscript();
  let transcriptEl: HTMLDivElement | undefined;

  const dialogStack = useDialogStack();

  // `Esc` goes back to the host tab you came from — the same trip the chrome
  // bar's entry makes on a second press. The listener lives here because the
  // behaviour belongs to the pane: it exists exactly while the pane does, on
  // desktop and in the touch sheet alike.
  //
  // It listens on the way UP, and never in the capture phase. Every popover,
  // Corvu dialog, `SearchBar` and context menu in the pane dismisses on
  // `Escape`, and a capture listener would steal the key from all of them —
  // leaving the overlay on screen while the view quietly changed underneath
  // it. On the way up, an overlay that stops propagation or marks the key
  // handled simply wins.
  //
  // When a modal is up the press is ITS dismiss, and the view must not take
  // the same one. Corvu's `createEscapeKeyDown` closes a dialog WITHOUT
  // marking the event handled, so the listener cannot learn it from the event
  // — the depth `ModalDialog` already publishes is the fact, and it counts
  // every dialog (palette, Settings, About, the intent editor, a confirm) for
  // free. Same rule for an open completion menu, which `drafts.ts` publishes
  // for the same reason.
  const shown = useConductorShown();
  const standDown = (): boolean =>
    completionOpen() || dialogStack.openCount() > 0;
  makeEventListener(window, "keydown", (event: KeyboardEvent) => {
    // A HIDDEN PANE TAKES NO KEYS. The pane outlives the trip to a host tab
    // now, and a window listener that outlived it with it would leave the
    // conversation's `Escape` armed over a terminal — dismissing a mode the
    // reader is not in, on a press meant for whatever they are looking at.
    if (!shown()) return;
    // `defaultPrevented` is the other half of "an overlay won": a dismiss that
    // handled the key without stopping it still reaches here, and leaving on
    // the same press would close two things with one `Esc`.
    if (event.key !== "Escape" || standDown() || event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    exitConductorMode();
  });

  const state = orch.state;
  /** The `absent` sentence, as a PRIMITIVE — a `<Show>` keyed on the install
   *  object would re-create the face on every cell tick, and this is the one
   *  branch in the pane that must not flicker. */
  const absent = createMemo(() => {
    const install = state().install;
    return install.kind === "absent" ? install : undefined;
  });

  const reveal = (rowId: string): void => {
    if (transcriptEl !== undefined) revealTranscriptRow(transcriptEl, rowId);
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
      ref={bindDrop}
      data-testid="conductor-pane"
      data-phase={state().phase}
      // NO positioning of its own. The caller supplies it — `absolute inset-0`
      // over the workspace on desktop, `relative` inside the touch sheet — and
      // a `relative` baked in here would WIN over a caller's `absolute`
      // (Tailwind emits `absolute` before `relative`, so the later rule takes
      // it), which is exactly how the chat came to lay out as a 500px column
      // beside the canvas instead of covering it. Every caller must therefore
      // pass a positioned class: the drop overlay below is `absolute inset-0`
      // against this element.
      // `overflow-x-hidden` is the BACKSTOP, not the fix: the transcript and
      // every card hold their own width (see `ConductorToolCard`), and this is
      // what keeps a future card that forgets from reaching the DOCUMENT —
      // where the damage is not a wide pane but a window whose chrome bar and
      // composer have been pushed off the right-hand edge.
      class={`flex flex-col min-w-0 min-h-0 overflow-x-hidden bg-surface-0 ${props.class ?? ""}`}
    >
      <Show when={dropping()}>
        <div
          data-testid="conductor-drop-target"
          class="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-sm border-2 border-dashed border-accent bg-surface-0/80 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-accent"
        >
          Drop to attach
        </div>
      </Show>
      <Show
        when={absent()}
        fallback={
          <>
            <ConductorHeader
              state={state()}
              rows={feed.rows()}
              onSignIn={() => {
                if (state().signIn !== null) return;
                // Nothing to offer is a fact about the AGENT, not a button that
                // quietly does nothing: it has not asked anybody to sign in.
                toast.info(
                  `${state().agentName} has not offered a way to sign in`,
                );
              }}
            />
            <ConductorStrip
              servers={state().servers}
              watching={state().watching}
              onReveal={reveal}
            />
            <Show when={state().signIn}>
              {(signIn) => <ConductorSignIn signIn={signIn()} />}
            </Show>
            <ConductorTranscript
              rows={feed.rows()}
              pending={feed.pending()}
              error={feed.error()}
              containerRef={(el) => {
                transcriptEl = el;
              }}
            />
            {/* A conversation the agent would not OPEN has no composer under
                it: there is nothing to say to an agent that is not there. The
                one offer is to ask again for exactly what was refused — and no
                status line either, because the line reports on a conversation
                that is running and this one never started. */}
            <Show
              when={state().refusal}
              fallback={
                <>
                  <ConductorStatus state={state()} rows={feed.rows()} />
                  <ConductorComposer state={state()} />
                </>
              }
            >
              {(why) => (
                <div
                  data-testid="conductor-refusal"
                  class="border-t border-edge px-4 py-3 text-xs text-fg-2"
                >
                  <p class="mb-2 whitespace-pre-wrap">{why()}</p>
                  <button
                    type="button"
                    data-testid="conductor-retry"
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
            data-testid="conductor-absent"
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

export default ConductorPane;

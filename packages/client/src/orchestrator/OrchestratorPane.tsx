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
import { type Component, createMemo, Show } from "solid-js";
import { toast } from "solid-sonner";
import OrchestratorComposer from "./OrchestratorComposer";
import OrchestratorFleet from "./OrchestratorFleet";
import OrchestratorHeader from "./OrchestratorHeader";
import OrchestratorSignIn from "./OrchestratorSignIn";
import OrchestratorStrip from "./OrchestratorStrip";
import OrchestratorTranscript from "./OrchestratorTranscript";
import { completionOpen } from "./drafts";
import { useOrchestrator } from "./useOrchestrator";
import { exitOrchestratorMode } from "./useOrchestratorMode";
import { createOrchestratorTranscript } from "./useOrchestratorTranscript";

const OrchestratorPane: Component<{ class?: string }> = (props) => {
  const orch = useOrchestrator();
  const feed = createOrchestratorTranscript();
  let transcriptEl: HTMLDivElement | undefined;

  // `Esc` RETURNS to the posture underneath — the mode is a layer, not a
  // destination, so leaving it needs no memory of where you were. The listener
  // lives here because the behaviour belongs to the pane: it exists exactly
  // while the pane does, on desktop and in the touch sheet alike.
  //
  // CAPTURE PHASE, and that is load-bearing rather than tidy. The peek pane is
  // a live terminal, so the ordinary place a person's focus sits in this mode
  // is inside xterm — which claims `Escape` for the program running in the PTY
  // and never lets it reach the window. A bubble-phase listener here left the
  // only documented way out of the mode working solely when the chat happened
  // to have focus.
  //
  // The one gesture that outranks leaving is closing an open completion menu,
  // which is the same key. The composer PUBLISHES that it has one open
  // (`completionOpen`) rather than stopping the event, because a
  // bubble-phase `stopPropagation` can no longer reach a capture-phase
  // listener — a fact both read settles the order without either listening for
  // the other.
  makeEventListener(
    window,
    "keydown",
    (event: KeyboardEvent) => {
      if (event.key !== "Escape" || completionOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      exitOrchestratorMode();
    },
    { capture: true },
  );

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
      data-testid="orchestrator-pane"
      data-phase={state().phase}
      class={`flex flex-col min-w-0 min-h-0 bg-surface-0 ${props.class ?? ""}`}
    >
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

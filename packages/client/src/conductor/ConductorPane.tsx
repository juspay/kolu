import { makeEventListener } from "@solid-primitives/event-listener";
import { type Component, createMemo, createSignal, Show } from "solid-js";
import { useDialogStack } from "../ui/useDialogStack";
import { attachDroppedFiles } from "./attachFiles";
import { completionOpen } from "./drafts";
import { Shown, useShown } from "../ui/shown";
import ChatScopeBar from "./ChatScopeBar";
import ConductorComposer from "./ConductorComposer";
import ConductorHeader from "./ConductorHeader";
import ConductorRefusal from "./ConductorRefusal";
import ConductorSignIn from "./ConductorSignIn";
import ConductorStatus from "./ConductorStatus";
import ConductorStrip from "./ConductorStrip";
import ConductorTranscript from "./ConductorTranscript";
import WorkColumn from "./WorkColumn";
import { ConductorHelpColumn, ConductorHelpSheet } from "./ConductorHelp";
import { conductorHelpColumn, conductorWide } from "./conductorLayout";
import { useConductor } from "./useConductor";
import { exitConductorMode } from "./useConductorMode";
import { createConductorTranscript } from "./useConductorTranscript";
import { revealTranscriptRow } from "./transcriptScroll";
import WorkReader from "./reader/WorkReader";
import ReaderChrome from "./reader/ReaderChrome";
import { openReader, readerFilled, readerTarget } from "./reader/useReader";
import { joinsOf, turnWorks } from "./turnWorks";
import { useWorkMap } from "./useWorks";

type TrackClass =
  | "grid-cols-[calc(var(--container-conductor-help)+var(--spacing-conductor-gutter))_minmax(0,1fr)_auto]"
  | "grid-cols-[minmax(0,1fr)_auto]"
  | "grid-cols-[0px_minmax(0,1fr)]"
  | "grid-cols-[0px_minmax(0,1fr)_0px]"
  | "grid-cols-[minmax(0,1fr)_minmax(0,2fr)_0px]";

const ConductorPane: Component<{
  class?: string;
}> = (props) => {
  const orch = useConductor();
  const feed = createConductorTranscript();
  let transcriptEl: HTMLDivElement | undefined;
  const workMap = useWorkMap();
  const joins = createMemo(() => joinsOf(workMap()));
  const turns = createMemo(() => turnWorks(feed.rows(), workMap(), joins()));

  const dialogStack = useDialogStack();

  // When a modal is up the press is ITS dismiss, and the view must not take
  // the same one. Corvu's `createEscapeKeyDown` closes a dialog WITHOUT
  // marking the event handled, so the listener cannot learn it from the event
  // — the depth `ModalDialog` already publishes is the fact, and it counts
  // every dialog (palette, Settings, About, the intent editor, a confirm) for
  // free. Same rule for an open completion menu, which `drafts.ts` publishes
  // for the same reason.
  const shown = useShown();
  const standDown = (): boolean =>
    completionOpen() || dialogStack.openCount() > 0;
  makeEventListener(window, "keydown", (event: KeyboardEvent) => {
    if (!shown()) return;
    if (event.key !== "Escape" || standDown() || event.defaultPrevented) {
      return;
    }
    event.preventDefault();
    exitConductorMode();
  });

  const state = orch.state;
  const absent = createMemo(() => {
    const install = state().install;
    return install.kind === "absent" ? install : undefined;
  });

  const reveal = (rowId: string): void => {
    if (transcriptEl !== undefined) revealTranscriptRow(transcriptEl, rowId);
  };
  const [dropping, setDropping] = createSignal(false);
  const takesDrop = (event: DragEvent): boolean =>
    (event.dataTransfer?.types.includes("Files") ?? false) &&
    absent() === undefined &&
    state().refusal === null;
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

  const reading = (): boolean => readerTarget() !== null;
  const chatAside = (): boolean =>
    reading() && (readerFilled() || !conductorWide());
  const chatShown = (): boolean => shown() && !chatAside();
  const cardsShown = (): boolean => shown() && !reading();
  const tracks = (): TrackClass => {
    if (!reading())
      return conductorHelpColumn()
        ? "grid-cols-[calc(var(--container-conductor-help)+var(--spacing-conductor-gutter))_minmax(0,1fr)_auto]"
        : "grid-cols-[minmax(0,1fr)_auto]";
    if (!conductorWide()) return "grid-cols-[0px_minmax(0,1fr)]";
    return chatAside()
      ? "grid-cols-[0px_minmax(0,1fr)_0px]"
      : "grid-cols-[minmax(0,1fr)_minmax(0,2fr)_0px]";
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
      class={`flex flex-col min-w-0 min-h-0 overflow-x-hidden bg-surface-0 text-chat ${props.class ?? ""}`}
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
              onSignIn={() => orch.askSignIn()}
            />
            <div
              data-testid="conductor-frame"
              data-reading={reading() ? "" : undefined}
              class={`grid min-h-0 flex-1 ${tracks()}`}
            >
              <Show when={conductorHelpColumn() && !reading()}>
                <ConductorHelpColumn />
              </Show>
              <Shown.Provider value={chatShown}>
                <div
                  data-testid="conductor-chat"
                  style={{
                    "content-visibility": chatAside() ? "hidden" : "visible",
                  }}
                  inert={chatAside()}
                  aria-hidden={chatAside() || undefined}
                  class="mx-auto flex min-h-0 w-full min-w-0 max-w-conductor flex-col overflow-hidden"
                >
                  <ConductorStrip
                    watching={state().watching}
                    onReveal={reveal}
                  />
                  <Show when={state().signIn}>
                    {(signIn) => <ConductorSignIn signIn={signIn()} />}
                  </Show>
                  <ChatScopeBar rows={feed.rows()} turns={turns()} />
                  <ConductorTranscript
                    rows={feed.rows()}
                    turns={turns()}
                    pending={feed.pending()}
                    error={feed.error()}
                    containerRef={(el) => {
                      transcriptEl = el;
                    }}
                  />
                  <Show
                    when={state().refusal !== null}
                    fallback={
                      <>
                        <ConductorStatus state={state()} rows={feed.rows()} />
                        <ConductorComposer state={state()} />
                      </>
                    }
                  >
                    <ConductorRefusal state={state()} />
                  </Show>
                </div>
              </Shown.Provider>
              <Show when={readerTarget()}>
                {(target) => (
                  <WorkReader
                    target={target()}
                    from="reader"
                    listing
                    onOpen={openReader}
                    chrome={<ReaderChrome target={target()} />}
                    class="border-s border-edge"
                  />
                )}
              </Show>
              <Show when={conductorWide()}>
                <Shown.Provider value={cardsShown}>
                  <aside
                    data-testid="conductor-side"
                    style={{
                      "content-visibility": reading() ? "hidden" : "visible",
                    }}
                    inert={reading()}
                    aria-hidden={reading() || undefined}
                    class={`flex min-h-0 flex-col overflow-y-auto overflow-x-hidden ${
                      reading()
                        ? "w-0"
                        : "w-conductor-side border-l border-edge ps-conductor-gutter"
                    }`}
                  >
                    <WorkColumn placement="side" />
                  </aside>
                </Shown.Provider>
              </Show>
            </div>
            <ConductorHelpSheet />
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

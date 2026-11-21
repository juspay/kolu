/** The conductor, whole: the works and the conversation as one pane.
 *
 *  THE WORKS TAKE THE WIDE SIDE. Every work and every terminal is on screen
 *  at any desktop width (`WorkColumn`), and the conversation is a PANEL of
 *  fixed measure on the right — its header, the transcript, the status line
 *  and the composer (`conductorFrame.ts` for the measures). No Dock, no fleet
 *  list, no canvas. The entry in the chrome bar is a DESTINATION, not a layer
 *  over the workspace. An agent the conversation started is checked from
 *  inside it — its terminal's row in the works, the create card's status line
 *  and their Look at the terminal's screen — and reached on the host tab it
 *  lives on (which every tool card offers, in one press).
 *
 *  THE FRAME IS CONSTANT on a desktop. The grid declares both tracks whatever
 *  is in them, so nothing slides sideways the moment the first work appears;
 *  the works welcome a newcomer while there is nothing in progress rather than
 *  leaving a hole. On a phone there is no side to put anything beside: it
 *  shows the works or the conversation, one at a time, by a tab bar under
 *  them (`ConductorPhoneTabs`).
 *
 *  Mounted on the first visit and then RETAINED for the page's life: leaving
 *  for a host tab hides it (`App.tsx`'s out-of-flow host with
 *  `content-visibility: hidden`) rather than unmounting it, so everything a
 *  person had open in here is still open on the way back. The subtree asks
 *  `useShown()` before doing any work, because a retained view that
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
import { ConductorHelpSheet } from "./ConductorHelp";
import MemoryEditor from "./memory/MemoryEditor";
import MemoryImport from "./memory/MemoryImport";
import { MemorySheet } from "./memory/MemorySheet";
import TerminalPeek from "./peek/TerminalPeek";
import { chatPutAside, frameTracks, worksDrawn } from "./conductorFrame";
import ConductorPhoneTabs from "./ConductorPhoneTabs";
import { phoneView } from "./phoneView";
import { layoutMode } from "../useMobile";
import { useConductor } from "./useConductor";
import { exitConductorMode } from "./useConductorMode";
import { createConductorTranscript } from "./useConductorTranscript";
import { revealTranscriptRow } from "./transcriptScroll";
import WorkReader from "./reader/WorkReader";
import ReaderChrome from "./reader/ReaderChrome";
import { openReader, readerFilled, readerTarget } from "./reader/useReader";
import { chatTurns, joinsOf, turnWorks } from "./turnWorks";
import {
  finishedReplyOf,
  provideTypedReply,
  type TypedReply,
} from "./typedReply";
import { useWorkMap } from "./useWorks";

const ConductorPane: Component<{
  class?: string;
}> = (props) => {
  const orch = useConductor();
  const feed = createConductorTranscript();
  let transcriptEl: HTMLDivElement | undefined;
  /** EACH ROW'S TURN, read once — one walk of the rows per change, over the
   *  index of which terminal joined which work, built once per change of the
   *  works. The transcript and the scope bar over it both read this. */
  const workMap = useWorkMap();
  const joins = createMemo(() => joinsOf(workMap()));
  const turns = createMemo(() => turnWorks(feed.rows(), workMap(), joins()));
  /** THE ROWS IN THE ORDER THE CHAT IS DRAWN: turn by turn, each turn's rows
   *  under its message — so a message sent while a reply is still being
   *  written waits below the whole of that reply. Read by the two that draw
   *  or copy the chat (the transcript, and the header's menu). */
  const drawn = createMemo(() =>
    chatTurns(feed.rows()).flatMap((turn) => turn.rows),
  );

  // THE FINISHED REPLY TO A MESSAGE YOU TYPED, handed to attention — which
  // rings for it once you have left the conversation. A memo and not an
  // effect: it is a reading of the rows, the turn's works and whether a
  // turn is running.
  provideTypedReply(
    createMemo(
      (): TypedReply | null | undefined => {
        if (feed.pending()) return undefined;
        const reply = finishedReplyOf(
          feed.rows(),
          orch.state().busySince !== null,
        );
        if (reply === null) return null;
        const works = turns().get(reply.turn)?.works ?? [];
        return {
          ...reply,
          work: works.length === 1 ? (works[0] ?? null) : null,
        };
      },
      undefined,
      {
        equals: (a, b) =>
          a === b ||
          (a !== undefined &&
            a !== null &&
            b !== undefined &&
            b !== null &&
            a.turn === b.turn &&
            a.text === b.text &&
            a.work === b.work),
      },
    ),
  );

  const dialogStack = useDialogStack();

  const shown = useShown();
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

  /** IS A FILE OPEN. Everything the frame does differently while one is open
   *  follows from this one fact. */
  const reading = (): boolean => readerTarget() !== null;
  const phone = (): boolean => layoutMode() === "phone";
  const frame = () => ({
    phone: phone(),
    view: phoneView(),
    reading: reading(),
    filled: readerFilled(),
  });
  /** IS THE CONVERSATION PUT ASIDE — a reader filling the screen, or on a
   *  phone the works or a file in its place. The panel stays mounted either
   *  way; this is what makes it zero-wide, skipped and inert. */
  const chatAside = (): boolean => chatPutAside(frame());
  /** The two retained halves of the frame ask the SAME question every other
   *  retained view in the app asks before doing any work: is anybody looking
   *  at me? A conversation at zero width and works behind a reader are not,
   *  so their clocks stop and their scrolls stand down. */
  const chatShown = (): boolean => shown() && !chatAside();
  const worksShown = (): boolean => shown() && !reading();
  const header = () => (
    <ConductorHeader
      state={state()}
      rows={drawn()}
      // A REAL CALL: the harness puts the sign-in row up with the methods
      // its handshake advertised, or the sentence saying it advertised none
      // — never a row this end pretends to have.
      onSignIn={() => orch.askSignIn()}
    />
  );

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
      // `text-chat` is the pane's BODY SIZE (15px/1.7, `index.css`), inherited
      // by every row that does not insist on a size of its own — the agent's
      // prose, a person's bubble, the box you type in. The chrome around them
      // (the header, the status line, a card's labels) keeps its own small
      // mono sizes; what changed is the thing you came here to read.
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
            {/* On a phone the header stands over the whole pane; on a desktop
                it heads the conversation's panel. */}
            <Show when={phone()}>{header()}</Show>
            {/* THE FRAME. Tracks declared once and ALWAYS declared
                (`conductorFrame.ts`): the works, then the conversation's
                panel. A FILE OPEN takes the works' track, and the
                conversation stays where it is; filling the screen with the
                file puts the conversation aside too. Everything that gives
                way stays MOUNTED at zero width — `content-visibility: hidden`
                and `inert`, the same trick `App.tsx` retains this whole pane
                with — so "← Work" is a width changing back, not a list of
                works and a transcript being built again. */}
            <div
              data-testid="conductor-frame"
              data-reading={reading() ? "" : undefined}
              class={`grid min-h-0 flex-1 ${frameTracks(frame())}`}
            >
              {/* THE WORKS, the wide side. They SCROLL BY THEMSELVES, so a
                  long list never makes the pane scroll, and they give way to
                  the reader without leaving: the way back from a file is the
                  works exactly as they were — the same ones open, scrolled
                  where they were, with their clocks stopped while nobody
                  could see them. */}
              <Show when={!phone()}>
                <Shown.Provider value={worksShown}>
                  {/* The works scroll inside the column (its
                      `data-works-scroll`), beside a sidebar that stays put;
                      this side itself never scrolls. */}
                  <aside
                    data-testid="conductor-side"
                    style={{
                      "content-visibility": reading() ? "hidden" : "visible",
                    }}
                    inert={reading()}
                    aria-hidden={reading() || undefined}
                    class={`flex min-h-0 min-w-0 flex-col overflow-hidden ${
                      reading() ? "w-0" : ""
                    }`}
                  >
                    <WorkColumn />
                  </aside>
                </Shown.Provider>
              </Show>
              {/* ON A PHONE the works are a view of their own, drawn while
                  the Work tab is chosen and taken down when it is not: the
                  chat's half of the phone holds no hidden list. */}
              <Show when={phone() && worksDrawn(frame())}>
                <div
                  data-testid="conductor-works"
                  data-works-scroll
                  class="flex min-h-0 min-w-0 flex-col overflow-y-auto overflow-x-hidden"
                >
                  <WorkColumn />
                </div>
              </Show>
              {/* THE READER — the file the person is actually here to read,
                  where the works were. It is the one thing in the frame that
                  is MOUNTED ONLY WHILE IT IS OPEN: it is what was opened, and
                  there is nothing of a reader to keep when no file is. */}
              <Show when={readerTarget()}>
                {(target) => (
                  <WorkReader
                    target={target()}
                    // THE PANE OWNS THE ADDRESS: which file is open is a fact
                    // about this pane, kept in its module signal — the
                    // workspace's own hash is not the reader's to write.
                    from="reader"
                    listing
                    onOpen={openReader}
                    chrome={<ReaderChrome target={target()} />}
                  />
                )}
              </Show>
              {/* THE CONVERSATION'S PANEL. The transcript, the status line
                  and the composer are the same measure, so a reply, what it
                  is doing and what you type to it read as one thing.

                  It is never unmounted. A reader filling the screen, or a
                  phone reading a file, leaves it at zero width with its
                  contents skipped and out of reach — the conversation is one
                  press away, with the half-typed message and the scroll
                  position still in it. */}
              <Shown.Provider value={chatShown}>
                <div
                  data-testid="conductor-chat"
                  style={{
                    "content-visibility": chatAside() ? "hidden" : "visible",
                  }}
                  inert={chatAside()}
                  aria-hidden={chatAside() || undefined}
                  class={`flex min-h-0 w-full min-w-0 flex-col overflow-hidden ${
                    chatAside()
                      ? "order-first"
                      : phone()
                        ? ""
                        : "border-s border-edge"
                  }`}
                >
                  <Show when={!phone()}>{header()}</Show>
                  <ConductorStrip
                    watching={state().watching}
                    onReveal={reveal}
                  />
                  <Show when={state().signIn}>
                    {(signIn) => <ConductorSignIn signIn={signIn()} />}
                  </Show>
                  {/* WHAT THE CHAT IS POINTED AT, over the chat it filters. */}
                  <ChatScopeBar rows={feed.rows()} turns={turns()} />
                  <ConductorTranscript
                    rows={drawn()}
                    turns={turns()}
                    pending={feed.pending()}
                    error={feed.error()}
                    containerRef={(el) => {
                      transcriptEl = el;
                    }}
                  />
                  {/* A conversation that would not OPEN has no composer under
                    it: there is nothing to say to an agent that is not there,
                    and nothing to say at all when the records a restart reads
                    would not decode. What is offered depends on WHICH of
                    those happened, which is `ConductorRefusal`'s whole job —
                    and no status line either way, because the line reports on
                    a conversation that is running and this one never
                    started. */}
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
            </div>
            <Show when={phone()}>
              <ConductorPhoneTabs />
            </Show>
            {/* THE HELP, as a sheet mounted once and opened from the header's
                `?` or the `⋯` menu's How to use. */}
            <ConductorHelpSheet />
            <MemorySheet />
            <MemoryEditor />
            <MemoryImport />
            <TerminalPeek />
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

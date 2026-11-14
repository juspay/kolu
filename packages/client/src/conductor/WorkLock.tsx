/** THE LOCK, as a person meets it — drawn on the terminal's own BODY, never
 *  in the tile's header.
 *
 *  A terminal the Conductor drives reads exactly like any other: it scrolls,
 *  it selects, it copies, its links open, search finds things in it, and a
 *  click focuses it. There is no scrim and no dimming, because dimming a
 *  terminal to say "you may not type here" costs the reading the lock was
 *  never about.
 *
 *  Three things, and nothing else:
 *
 *  1. **The frame.** A thin border in the Conductor's colour around the
 *     terminal body. That is the whole resting-state mark on a tile — the
 *     header is already overloaded, and a border is the one piece of chrome
 *     that costs no room at all.
 *  2. **The card**, raised by TYPING (a key, a paste, a dropped file, a tap
 *     on the phone's key bar — every site {@link personInput} gates). Centred
 *     over the terminal, it says who is driving and offers **Take over**; it
 *     dismisses on Esc, on a click anywhere else, or by itself after a few
 *     seconds. Nothing is sent to the terminal either way.
 *  3. **The pill**, while the person has it: one small "You're driving ·
 *     Hand back" in a corner of the body, for as long as that lasts.
 *
 *  Drawn only for a terminal a work actually drives (an active member of a
 *  work in progress whose mode runs a waterfall). A watch — the human asked
 *  kolu to keep an eye on THEIR terminal — and a work whose mode nobody has
 *  answered yet drive nothing, so there is nothing here to say.
 *
 *  Take over / Hand back are `conductor.takeOver` / `conductor.handBack` on
 *  the kolu surface, which declare `ConductorRefused` ALONE — a conversation
 *  that is down must never stand between a person and the keyboard of a
 *  terminal in front of them — and the refusal's own sentence is the toast.
 *  The work card's terminal row carries the same pair, so they can be found
 *  without typing first.
 *
 *  ONE component for every surface: the phone draws the same frame, card and
 *  pill over its one terminal as a canvas tile does, because the band and the
 *  gate must be one reading of one index. */

import {
  type Component,
  createEffect,
  createMemo,
  onCleanup,
  Show,
} from "solid-js";
import { dismissLockCard, lockCardShown } from "./personInput";
import { useConductor } from "./useConductor";
import { useMembership } from "./useWorks";
import { lockCardWords, lockWords } from "./workReadings";

const BUTTON_CLASS =
  "shrink-0 rounded-sm px-2 py-[0.2rem] font-mono text-[0.62rem] font-semibold uppercase tracking-[0.06em] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const WorkLock: Component<{
  /** The fleet ref (`<encodedHostKey>/<terminalId>`) of the terminal this
   *  frame is about. */
  terminal: string;
}> = (props) => {
  const membership = useMembership();
  const conductor = useConductor();
  /** The membership ONLY while something drives this terminal — the `null`
   *  driver (no lock) and the absent membership (no work) are one case here,
   *  and it draws nothing. */
  const driven = createMemo(() => {
    const at = membership().get(props.terminal);
    return at === undefined || at.driver === null ? undefined : at;
  });
  const carded = () => driven() !== undefined && lockCardShown(props.terminal);

  /** The card's own box, so a press INSIDE it is not the click-elsewhere that
   *  dismisses it. */
  let card: HTMLDivElement | undefined;

  /** ESC AND A CLICK ELSEWHERE, listened for only while the card is up.
   *
   *  Esc is taken in the CAPTURE phase and SWALLOWED: while the card is up,
   *  Esc belongs to the card. Left to bubble, xterm's own key handler would
   *  see it first, the gate would raise the card again, and Esc would read
   *  as doing nothing — and it costs the terminal nothing, since a terminal
   *  this card is over takes no keys anyway.
   *
   *  The press-elsewhere is captured too, but passed on untouched: a click
   *  in a driven terminal still focuses it for reading, which is the whole
   *  promise — it only also puts the card away. */
  createEffect(() => {
    if (!carded()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      dismissLockCard();
    };
    const onDown = (e: Event) => {
      const target = e.target;
      if (target instanceof Node && card?.contains(target)) return;
      dismissLockCard();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    onCleanup(() => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    });
  });

  return (
    <Show when={driven()}>
      {(at) => (
        <>
          {/* THE FRAME. `pointer-events-none` is what keeps the promise that
              a locked terminal reads like any other: the border is painted
              over the body and catches no drag, no selection and no click. */}
          <div
            data-testid="work-lock"
            // WHICH TERMINAL this frame is around. The body carries no id of
            // its own (the id is on the xterm element inside it), and a
            // reader outside — a test, a second browser — has to be able to
            // say which terminal it is looking at the lock of.
            data-lock-terminal={props.terminal}
            data-driver={at().driver ?? undefined}
            data-work={at().work}
            data-role={at().role}
            aria-hidden="true"
            class={`pointer-events-none absolute inset-0 z-10 border-2 ${
              at().driver === "you" ? "border-alert/70" : "border-conductor/60"
            }`}
          />
          {/* THE PILL — only while the person has it, in a corner of the
              BODY. Bottom left: the scroll-to-bottom control owns the other
              corner, and the top of the body is where search opens. */}
          <Show when={at().driver === "you"}>
            <button
              type="button"
              data-testid="work-hand-back"
              data-lock-terminal={props.terminal}
              title={lockWords(at())}
              class={`${BUTTON_CLASS} absolute bottom-2 left-2 z-20 flex items-center gap-1.5 border border-alert/40 bg-surface-1/95 text-alert shadow-md hover:bg-alert/15`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                conductor.handBack(props.terminal);
              }}
            >
              <span class="normal-case font-normal text-fg-2">
                You’re driving
              </span>
              <span aria-hidden="true" class="text-fg-3">
                ·
              </span>
              <span>Hand back</span>
            </button>
          </Show>
          {/* THE CARD, centred over the terminal. The wrapper takes no
              pointer events so the terminal under it stays readable while
              the card is up; the card itself takes them back. */}
          <Show when={carded()}>
            <div class="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-3">
              <div
                ref={card}
                data-testid="work-lock-card"
                data-lock-terminal={props.terminal}
                data-work={at().work}
                data-role={at().role}
                role="status"
                class="pointer-events-auto flex max-w-[22rem] flex-col gap-2 rounded-md border border-conductor/40 bg-surface-1/97 px-3 py-2 shadow-xl"
              >
                <span class="font-mono text-[0.68rem] leading-snug text-fg-1">
                  {lockCardWords(at())}
                </span>
                <div class="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    data-testid="work-lock-dismiss"
                    class={`${BUTTON_CLASS} text-fg-3 hover:bg-surface-2`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissLockCard();
                    }}
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    data-testid="work-take-over"
                    class={`${BUTTON_CLASS} bg-conductor/20 text-conductor hover:bg-conductor/30`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      // The card has done its job the moment the terminal is
                      // the person's: it is dismissed here rather than left
                      // to time out over a terminal they can now type into.
                      dismissLockCard();
                      conductor.takeOver(props.terminal);
                    }}
                  >
                    Take over
                  </button>
                </div>
              </div>
            </div>
          </Show>
        </>
      )}
    </Show>
  );
};

export default WorkLock;

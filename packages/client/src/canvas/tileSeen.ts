/** IS ANYBODY LOOKING AT THIS CANVAS TILE? — the desktop half of the fact
 *  `shownPane.ts` acts on.
 *
 *  A pane that is shown attaches, and attaching is a WRITE: the host
 *  serializes a screen, resizes the pty to the grid the pane asked for, and
 *  then forwards every byte that terminal prints for as long as the stream is
 *  open. Mobile already pays that only for the tile on screen. The desktop
 *  used to pay it for EVERY tile of the host — `visible={isDesktop() || …}` —
 *  which is why one mount attached 9–13 terminals and kolu forwarded 697.8
 *  million characters of live output in four hours (kolu#2362).
 *
 *  The canvas is a camera over a plane, so "on screen" is a FACT THE CANVAS
 *  ALREADY COMPUTES — the tile's rect against the viewport rect, the same
 *  memo that decides whether a tile burns a frame animating its aura
 *  (`CanvasTile.tsx`'s `onScreen`, with its 200 px margin). Nothing here asks
 *  the DOM: an `IntersectionObserver` or an element rect answers about
 *  LAYOUT, which is a different question and the wrong one for exactly the
 *  frames that matter (`/solidjs`, "Own work and visibility"; `ui/shown.ts`).
 *
 *  THE HOLD is the other half, and it belongs here rather than in
 *  `shownPane.ts`: mobile's tile switch is a decision the user just made, so
 *  it detaches at once, while a canvas is a place you look AROUND. So a tile
 *  that stops being seen keeps counting as seen for {@link SEEN_HOLD_MS},
 *  and a tile seen again inside that window never changes state at all: no
 *  detach and no re-attach, so the feed it already has never stops. A tile
 *  that has NEVER been seen has nothing to hold — it is not attached, and no
 *  timer runs for it. */

import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import type { CanvasTileMode } from "./CanvasTile";

/** How long a tile that has left the view keeps its attach.
 *
 *  WHAT A DETACH COSTS is the place you were reading: the tile comes back
 *  showing the END of its output, so a scrolled-up position in it is gone —
 *  and the return itself is slow, because the pane re-fetches a screen and
 *  repaints it. That is the whole scale here. A trip away — glance at another
 *  tile, answer an agent, go to lunch, come back — expects to find the tile
 *  as it was, and five seconds lost it almost every time.
 *
 *  AN HOUR, so a tile you come back to within the hour was never disconnected
 *  at all. What it costs is stated plainly: a tile you look away from keeps
 *  receiving its output for an hour, and a tile you never return to that day
 *  still lets go.
 *
 *  One baked constant — a knob here would be a way to turn the fix off. */
export const SEEN_HOLD_MS = 60 * 60_000;

/** The live facts a canvas tile's visibility is decided from. */
export interface TileSeenFacts {
  /** Is anybody looking at the CANVAS at all? False while the Conductor
   *  covers it (`ui/shown.ts`'s one accessor, provided by `App.tsx`). It
   *  wins over every row below: a covered canvas shows no tile. */
  readonly viewShown: boolean;
  /** Has the camera stopped moving on its own? False during a programmatic
   *  pan — centring on a tile, landing a restored session, the host-switch
   *  re-centre. It qualifies ONE row below, the only row that asks where the
   *  camera is: a 150 ms flight sweeps tiles through the viewport that nobody
   *  asked to see, and attaching each one — then holding that attach open for
   *  the whole grace period — is exactly the cost this module exists to
   *  avoid, so a tile that is merely flown OVER waits for the pose the camera
   *  lands on. The
   *  maximized tile and the active tile never ask: they are seen whatever the
   *  camera is doing. */
  readonly cameraSettled: boolean;
  /** This tile's render mode (`TerminalCanvas` derives it from the canvas
   *  posture and the active id). */
  readonly mode: CanvasTileMode;
  /** Is this the active tile? Seen even when panned away, so the keyboard
   *  keeps reaching the terminal the user is typing into. */
  readonly active: boolean;
  /** Does the tile's rect overlap the canvas view (plus the aura's margin)?
   *  False for a tile with no resolved layout yet — see `CanvasTile`. */
  readonly onScreen: boolean;
}

/** Can a user see this tile right now?
 *
 *  - the maximized tile fills the viewport — seen, camera or no camera;
 *  - a covered tile sits behind it (`visibility: hidden`) — not seen, and by
 *    construction it is not the active one;
 *  - the active tile is seen wherever it is parked, so the keyboard always
 *    reaches the terminal being typed into — including while the canvas is
 *    still flying towards a terminal just created;
 *  - any other tiled tile is seen when its rect is in view under a SETTLED
 *    camera.
 *
 *  Only the Conductor (`viewShown`) overrides all of it.
 *
 *  Pure, so each row is a unit test rather than a browser. */
export function tileIsSeen(facts: TileSeenFacts): boolean {
  if (!facts.viewShown) return false;
  if (facts.mode === "maximized") return true;
  if (facts.mode === "covered") return false;
  return facts.active || (facts.onScreen && facts.cameraSettled);
}

/** `seen`, with the leaving edge delayed by {@link SEEN_HOLD_MS} — the
 *  accessor a tile body's `visible` is driven from.
 *
 *  Becoming seen is IMMEDIATE (a tile panned into view attaches on the frame
 *  it arrives). Stopping is held: the flip to false lands a hold later, and
 *  only if the tile is still unseen then. Seen again inside the window
 *  cancels the timer with nothing observed in between.
 *
 *  Owned by the caller's reactive owner: the timer is cleared when the tile
 *  goes, so a closed tile cannot flip a disposed signal. */
export function createHeldSeen(seen: Accessor<boolean>): Accessor<boolean> {
  const [held, setHeld] = createSignal(seen());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  createEffect(
    on(seen, (now) => {
      if (now) {
        // Arriving is never delayed, and it spends a pending departure.
        cancel();
        setHeld(true);
        return;
      }
      // Never seen (or already let go): nothing is attached, so nothing is
      // owed a grace period. (No "already counting down" case to guard: this
      // effect runs on CHANGES of `seen`, and the `true` that must precede a
      // second `false` has already cancelled the timer above.)
      if (!held()) return;
      timer = setTimeout(() => {
        timer = undefined;
        setHeld(false);
      }, SEEN_HOLD_MS);
    }),
  );
  onCleanup(cancel);
  return held;
}

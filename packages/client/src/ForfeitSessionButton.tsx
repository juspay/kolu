/**
 * The "Start fresh" button, with an inline confirmation.
 *
 * Forfeit is the session's one deliberately DESTRUCTIVE verb — it drops every
 * parked restore entry AND clears the saved session on disk, together — so it
 * gets the same treatment as the other destructive act in the app, "Restart
 * kaval": the shared `InlineConfirmButton` shell, which opens a confirm step
 * instead of acting on the first click. Reusing the shell (rather than growing a
 * second confirm here) is why the affordance and the escape hatch can't drift
 * between the two.
 *
 * Two shapes below are load-bearing, and both were written by an incident: a
 * user restarted kaval, the restore card appeared, one stray click landed on the
 * blank card padding, and a 16-terminal session was gone with no confirmation
 * and no undo.
 *
 *  - The trigger sits in a `w-fit` wrapper, so its hit area is its LABEL. The
 *    shell's trigger is `w-full` by design (it fills the rails it normally lives
 *    in); under a fit-content parent that same `w-full` resolves to the text's
 *    own width, so the empty padding beside "Start fresh" stops being a silent,
 *    irreversible discard. The confirm step still spans the card — its copy
 *    wants the room, and fit-content gives a paragraph the full line box.
 *  - `tone="warning"` — the tone the shell reserves for a destructive-but-
 *    RECOVERABLE act. That is what forfeit now is: padi pushes the state file
 *    into the backup ring before it clears anything, and refuses the forfeit
 *    outright if that snapshot fails.
 */

import type { Component } from "solid-js";
import InlineConfirmButton from "./ui/InlineConfirmButton";

const ForfeitSessionButton: Component<{
  /** True while the card's RESTORE is in flight — gates the trigger out so the
   *  two actions can't race. The label deliberately holds still rather than
   *  reading "Restoring…": the primary button directly above already says that,
   *  and echoing it here would name a restore this button isn't running. */
  inFlight: boolean;
  onConfirm: () => void;
}> = (props) => (
  <div class="mx-auto w-fit">
    <InlineConfirmButton
      label="Start fresh"
      inFlightLabel="Start fresh"
      confirmCopy="Start fresh? This discards the saved session and every terminal it would have restored. A state backup is taken first, so “Restore state from backup” in the command palette can bring it back."
      tone="warning"
      inFlight={props.inFlight}
      testid="forfeit-session"
      onConfirm={props.onConfirm}
    />
  </div>
);

export default ForfeitSessionButton;

/** THE WORK LISTING'S OWN STATE — which work is PICKED, whether the finished
 *  list is open, and THE ONE WAY TO GO TO A WORK ({@link showWork}).
 *
 *  ONE VALUE, the picked work or none. Press a work and the screen is about
 *  it: its details fill the works' side, the other works fold to a rail, and
 *  the chat narrows to it (`pointChatAt`, what **About this work** does).
 *  A second press on it, or **All work**, unpicks it and the chat is whole
 *  again; showing the whole chat by hand does not unpick.
 *
 *  Module state, because the pick must outlive any one drawing of the list: a
 *  work chip — in the chat, in a "which work?" menu, in the reader's header —
 *  picks a work it is not inside, and so do the things outside the Conductor:
 *  a `#/work/…` link, the bell's notification, the command palette, and the
 *  mark on a terminal's dock row. */

import type { StageName, WorkId } from "kolu-work";
import { batch, createSignal } from "solid-js";
import { pointChatAt, showAllChat } from "./chatScope";
import { setPhoneView } from "./phoneView";
import { closeReader } from "./reader/useReader";
import { enterConductorMode } from "./useConductorMode";

const [picked, setPicked] = createSignal<WorkId | null>(null);
/** The stage a press on a work's strip asked for, carried into the picked
 *  work's timeline: the strip that was pressed is not the one that shows. */
const [pickedStage, setPickedStage] = createSignal<StageName | undefined>();
const [finishedOpen, setFinishedOpen] = createSignal(false);
/** A work asked to come into view — keyed by a counter so asking twice for
 *  the same work scrolls twice, and with the question to bring into view
 *  when the asker named one. Cleared by the work that answered it. */
export interface WantedCard {
  readonly id: WorkId;
  readonly ask: string | null;
  readonly seq: number;
}
const [wanted, setWanted] = createSignal<WantedCard | null>(null);
let asks = 0;

/** The picked work, or `null` for all the works. */
export const pickedWork = picked;

/** Is this work the picked one? */
export const isPicked = (id: string): boolean => picked() === id;

/** The stage the pick asked its timeline to show, if it asked for one. */
export const stageAskedFor = pickedStage;

/** PICK A WORK: the screen is about it, and so is the chat — on the stage
 *  `stage` names, when a press on its strip picked it. */
export function pickWork(id: WorkId, stage?: StageName): void {
  batch(() => {
    setPicked(id);
    setPickedStage(stage);
    pointChatAt(id);
  });
}

/** BACK TO ALL THE WORKS: nothing picked, and the whole chat. */
export function unpickWork(): void {
  batch(() => {
    setPicked(null);
    showAllChat();
  });
}

/** A press on a work's head: pick it, or unpick it when it is the one. */
export function togglePick(id: WorkId): void {
  if (picked() === id) unpickWork();
  else pickWork(id);
}

/** Is the Finished list open? Shut by default: it is history. */
export const isFinishedOpen = finishedOpen;
export const toggleFinished = (): void => {
  setFinishedOpen((was) => !was);
};
/** Open the Finished list — what the list does when the work a route asked
 *  for is a finished one. */
export const openFinished = (): void => {
  setFinishedOpen(true);
};

/** The work a route asked to bring into view, if one is waiting. */
export const wantedCard = wanted;

/** The work answered: it is in view. */
export function cardShown(seq: number): void {
  if (wanted()?.seq === seq) setWanted(null);
}

/** GO TO A WORK — the one route every face takes: a work chip, a `#/work/…`
 *  link, the bell's notification, a command-palette row, the mark on a dock
 *  row. The Conductor comes on screen, the reader gives way (the works are
 *  behind it), a phone shows its works (a desktop always does), and the work
 *  is picked and scrolled to — onto the question `ask` names, when one is
 *  given. */
export function showWork(id: WorkId, ask: string | null = null): void {
  asks += 1;
  const seq = asks;
  batch(() => {
    enterConductorMode();
    closeReader();
    setPhoneView("work");
    pickWork(id);
    setWanted({ id, ask, seq });
  });
}

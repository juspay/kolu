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
 *  mark on a terminal's dock row.
 *
 *  KEPT PER BROWSER TAB, in `sessionStorage`, like the phone's view and the
 *  Conductor's own mode (`phoneView.ts`, `useConductorMode.ts`): a reload
 *  stays on the picked work. The Conductor never writes the page's address —
 *  a `#/work/…` link is read once and taken off it — so the address is not
 *  where the pick is kept. What a reload does not keep is the chat's narrowing
 *  to the work, which a reload has always ended. */

import type { StageName, WorkId } from "kolu-work";
import type { PickedView } from "./livePanes";
import { batch, createSignal } from "solid-js";
import { defaultInvalidWarning, persistedPref } from "../persistedPref";
import { pointChatAt, showAllChat } from "./chatScope";
import { setPhoneView } from "./phoneView";
import { closeReader } from "./reader/useReader";
import { enterConductorMode } from "./useConductorMode";

/** Read a stored pick: a work id, or `null` for all the works. */
export function parsePicked(raw: string): WorkId | null {
  const value: unknown = JSON.parse(raw);
  if (value === null || (typeof value === "string" && value !== ""))
    return value;
  throw new Error(`not a picked work: ${raw}`);
}

const [picked, setPicked] = persistedPref<WorkId | null>({
  name: "kolu-conductor-picked-work",
  fallback: null,
  parse: parsePicked,
  serialize: (value) => JSON.stringify(value),
  storage: sessionStorage,
  onInvalid: defaultInvalidWarning("kolu-conductor-picked-work", null),
});
/** The stage a press on a work's map asked for, carried into the picked
 *  work's timeline: the map that was pressed is not the one that shows. */
const [pickedStage, setPickedStage] = createSignal<StageName | undefined>();
/** The view a person chose for the picked work — Terminals or Details — or
 *  none, which leaves it to `pickedView`. The pick's, not the drawing's: the
 *  picked work can be drawn again (the works are re-read, the list is drawn
 *  anew) without the person's choice going back to the default. */
const [viewChoice, setViewChoice] = createSignal<PickedView | undefined>();
/** THE ROWS THE PICKED WORK'S DETAILS HOLD OPEN, by terminal (a fleet ref) —
 *  the one fact a row reads for "am I open", whether a press on the row or
 *  **Inspect** on a live pane opened it. The pick's, as the view is: another
 *  pick, or none, forgets it, and Details being drawn again keeps it. */
const [unfolded, setUnfolded] = createSignal<ReadonlySet<string>>(
  new Set<string>(),
);
/** The open row **Inspect** asked for, which wears a highlight while it stays
 *  open — or none. Folding it ends the inspection. */
const [inspected, setInspected] = createSignal<string | null>(null);
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

/** The view chosen for the picked work, if one was. */
export const chosenView = viewChoice;

/** Put one of the picked work's views in front. */
export function chooseView(view: PickedView): void {
  setViewChoice(view);
}

/** Is this terminal's row open in the picked work's Details? */
export const isMemberUnfolded = (ref: string): boolean => unfolded().has(ref);

/** Is this the open row Inspect asked for? */
export const isMemberInspected = (ref: string): boolean =>
  inspected() === ref && unfolded().has(ref);

/** A PRESS ON A ROW: open it, or fold it. Folding the inspected row ends the
 *  inspection with it. */
export function toggleMember(ref: string): void {
  batch(() => {
    const next = new Set(unfolded());
    if (next.delete(ref)) {
      if (inspected() === ref) setInspected(null);
    } else next.add(ref);
    setUnfolded(next);
  });
}

/** INSPECT ONE TERMINAL of the picked work: its Details in front, with that
 *  terminal's row open and marked as the one asked for. */
export function inspectMember(ref: string): void {
  batch(() => {
    setUnfolded(new Set([...unfolded(), ref]));
    setInspected(ref);
    setViewChoice("details");
  });
}

/** PICK A WORK: the screen is about it, and so is the chat — on the stage
 *  `stage` names, when a press on its map picked it, which was a press to
 *  read that stage: its Details are in front. */
export function pickWork(id: WorkId, stage?: StageName): void {
  batch(() => {
    setPicked(id);
    setPickedStage(stage);
    setViewChoice(stage === undefined ? undefined : "details");
    setUnfolded(new Set<string>());
    setInspected(null);
    pointChatAt(id);
  });
}

/** BACK TO ALL THE WORKS: nothing picked, and the whole chat. */
export function unpickWork(): void {
  batch(() => {
    setPicked(null);
    setViewChoice(undefined);
    setUnfolded(new Set<string>());
    setInspected(null);
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

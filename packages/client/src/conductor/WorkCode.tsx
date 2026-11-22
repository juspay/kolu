/** A PICKED WORK'S CODE VIEW — the Right panel's Code tab, about the work's
 *  own worktree, on the work's own host.
 *
 *  Not a copy: it is the one Code view (`code-view/CodeTab.tsx`), handed
 *  the work's five inputs.
 *
 *  - **What it is about**, from the one reading of a work's worktree
 *    (`workPlaceOf`): its host and path; who lists the root, from the git
 *    reading of a member standing in it (git with none); the terminal the
 *    one rule borrows, or none. With none, the tree, the diffs and text still
 *    draw; commenting is off, and a picture or a download says in a line why
 *    it cannot be fetched. Its place is the WORK's, whichever terminal is up.
 *  - **Where its place is kept**: kolu-server, per work
 *    (`workCodeView.ts`), so the mode and the open file come back after a
 *    reload and in another browser.
 *  - **Its reads**, its own set, to the work's host, read only while it is
 *    shown — it is mounted only while Code is the view in front of a picked
 *    work, and leases the Conductor's own shown fact.
 *  - **Its own door**: a link, a wikilink, "Open path:N" and a history step
 *    land in THIS view, and never touch the Right panel.
 *  - **Its arrangement**, from its own box's width, not the window's: the
 *    work shares the window with the chat and a sidebar a person sizes. A
 *    wide box stands the tree beside the file, a narrow one (every phone)
 *    stacks it above (`codeArrangement`). The view is not built until the
 *    box has been measured once, so it is built in the arrangement its width
 *    calls for; after that a change of width turns it and never rebuilds it.
 *
 *  An open work whose worktree kolu has not read yet says so in one line, the
 *  Worktree part's own. A finished work has no switch, so no Code view. */

import { decodeHostKey } from "kolu-common/hostKey";
import type { Work, WorkId } from "kolu-work";
import { createElementSize } from "@solid-primitives/resize-observer";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  Show,
} from "solid-js";
import CodeTab from "../code-view/CodeTab";
import { buildCodeQueries, createCodeLeases } from "../code-view/codeQueries";
import type { CodeSubject } from "../code-view/codeSubject";
import { codeOwner } from "../code-view/codeTabOpenController";
import { codeArrangement } from "../code-view/codeSplit";
import { createCodeDoor } from "../code-view/codeDoor";
import { paneHeight } from "./livePanes";
import { syncWorkCodeRoot, workCodeState } from "./workCodeView";
import type { MemberLine } from "./workFacts";
import { type WorkPlace, WORKTREE_UNREAD, workPlaceOf } from "./workFile";

/** The view, over a worktree kolu has read. */
const Read: Component<{
  id: WorkId;
  place: WorkPlace;
}> = (props) => {
  // The work is fixed for this mount: a card is one work's.
  const owner = codeOwner("work", props.id);
  const subject = createMemo(
    (): CodeSubject => ({
      owner,
      host: decodeHostKey(props.place.host),
      git: {
        kind: "repo",
        root: props.place.repoPath,
        lister: props.place.lister,
      },
      terminalId: props.place.terminalId,
    }),
  );
  const state = workCodeState(props.id, () => props.place.lister);
  const leases = createCodeLeases();
  const queries = {
    ...buildCodeQueries({ subject, state, active: leases.shown }),
    lease: leases.lease,
  };
  const door = createCodeDoor((mode) => ({
    host: subject().host,
    owner,
    repoRoot: props.place.repoPath,
    mode,
  }));
  // The work's back/forward follows its root, handed over with the work it
  // belongs to as one pair.
  createEffect(() => syncWorkCodeRoot(props.id, props.place.repoPath));
  const [box, setBox] = createSignal<HTMLDivElement>();
  const boxSize = createElementSize(box);
  // The box's width once it has been measured, and from then on. A fresh
  // object per width keeps the gate below truthy at a width of 0, so it opens
  // once and stays open.
  const measured = createMemo((was: { px: number } | undefined) =>
    boxSize.width === null ? was : { px: boxSize.width },
  );
  return (
    <div
      ref={setBox}
      data-testid="work-code"
      class="min-h-0"
      style={{ height: paneHeight("stack", 1) }}
    >
      <Show when={measured()}>
        {(width) => (
          <CodeTab
            subject={subject()}
            state={state}
            queries={queries}
            door={door}
            arrangement={codeArrangement(width().px)}
          />
        )}
      </Show>
    </div>
  );
};

const WorkCode: Component<{
  id: WorkId;
  work: Work;
  members: ReadonlyArray<MemberLine>;
}> = (props) => {
  const place = createMemo(() => workPlaceOf(props.work, props.members));
  return (
    <Show
      when={place()}
      fallback={
        <p
          data-testid="work-code-unread"
          class="m-0 font-mono text-[0.62rem] text-fg-3"
        >
          {WORKTREE_UNREAD}
        </p>
      }
    >
      {(at) => <Read id={props.id} place={at()} />}
    </Show>
  );
};

export default WorkCode;

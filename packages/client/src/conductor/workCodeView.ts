/** A WORK'S CODE VIEW, AS THIS BROWSER KEEPS IT — the work's home behind the
 *  Code view's one state interface (`right-panel/codeViewState.ts`), as
 *  `useRightPanel().code` is the Right panel's.
 *
 *  Three layers, the Right panel's three for a pane:
 *
 *  - **The view kolu-server keeps** — the `workCodeViews` collection, keyed by
 *    work id: the mode and the file open in each mode. It is what a reload,
 *    and another browser, come back to.
 *  - **This browser's own write**, held here FIRST and reported AFTER
 *    (`conductor.setWorkCodeView`, the whole view): a file click moves the
 *    view at once, and the report rides behind it. A refused report says so
 *    in ONE toast — one stable id, so a server that refuses every click is
 *    one toast and not one per click. Once this browser has written a work's
 *    view it reads its own for the rest of the session, as the Right panel
 *    does for a pane.
 *  - **Back/forward**, in the browser only, keyed by the work — never on the
 *    wire, as the Right panel's is not.
 *
 *  What the view does NOT keep here: the tree's width (one preference every
 *  Code view shares), and whose place and which root it shows (those come in
 *  the view's subject, from one read by its caller). */

import { toError } from "@kolu/surface/run-stream";
import { Effect } from "effect";
import { DEFAULT_WORK_CODE_VIEW, type WorkCodeView } from "kolu-common/works";
import type { WorkId } from "kolu-work";
import { type Accessor, createEffect } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { type CodeLister, codeModeFor } from "../right-panel/codeLister";
import {
  type CodeViewState,
  codeHistoryVerbs,
  createCodeHistories,
  selectionWith,
} from "../right-panel/codeViewState";
import { runAction } from "../runAction";
import { app } from "../wire";
import { useWorkMap } from "./useWorks";

/** The views this browser has written, by work — the layer read first. */
const [written, setWritten] = createStore<Record<WorkId, WorkCodeView>>({});

/** ... and the ones kolu-server keeps: one subscription for the app. */
const served = createSharedRoot(() => app.collections.workCodeViews.use());

/** Back/forward per work, with the root it was recorded under. */
const histories = createCodeHistories<WorkId>();

/** A WORK THAT GOES TAKES ITS VIEW WITH IT, here as on kolu-server. A work's
 *  id is its branch, so the same branch opened again later is the same id:
 *  without this, a declined work (or one off the finished list) would come
 *  back holding this browser's old view and history and write the old view
 *  back on the next click. Said once: every id the works mirror held and no
 *  longer holds is let go of — its write and its history. Started by the
 *  first view of a work, and app-lifetime from then on. */
const forgetGoneWorks = createSharedRoot(() => {
  const works = useWorkMap();
  let held = new Set<WorkId>();
  createEffect(() => {
    const now = new Set(works().keys());
    for (const id of held) {
      if (now.has(id)) continue;
      setWritten(produce((all) => delete all[id]));
      histories.forget(id);
    }
    held = now;
  });
});

/** The view as it stands: this browser's write, else the one kolu keeps,
 *  else where a fresh pane stands. */
function viewOf(work: WorkId): WorkCodeView {
  return written[work] ?? served().byKey(work)?.() ?? DEFAULT_WORK_CODE_VIEW;
}

/** Write first, report after. */
function write(work: WorkId, next: WorkCodeView): void {
  setWritten(work, next);
  runAction(
    "save a work's Code view",
    app.procedures.conductor
      .setWorkCodeView({
        work,
        view: {
          codeMode: next.codeMode,
          // SPREAD, never an explicit `undefined`: the field is an optional
          // KEY on the wire, and the bound face refuses a present-but-
          // undefined one (the Right panel's report says the same).
          ...(next.selectedFileByMode !== undefined && {
            selectedFileByMode: next.selectedFileByMode,
          }),
        },
      })
      .pipe(
        Effect.catch((err) =>
          Effect.sync(() => {
            toast.error(
              `Failed to save where this work's Code view was: ${toError(err).message}`,
              { id: "work-code-view-report-failed" },
            );
          }),
        ),
      ),
  );
}

/** A WORK'S CODE VIEW STATE — the interface the view reads, for `work`.
 *  `lister` is who lists the work's root, for the one browse-only rule. */
export function workCodeState(
  work: WorkId,
  lister: Accessor<CodeLister | null>,
): CodeViewState {
  forgetGoneWorks();
  return {
    codeMode: () => codeModeFor(lister(), viewOf(work).codeMode),
    setCodeMode: (mode) => {
      const cur = viewOf(work);
      if (cur.codeMode !== mode) write(work, { ...cur, codeMode: mode });
    },
    selectedFile: (mode) => viewOf(work).selectedFileByMode?.[mode] ?? null,
    setSelectedFile: (mode, path) => {
      const cur = viewOf(work);
      const next = selectionWith(cur.selectedFileByMode, mode, path);
      if (next === "unchanged") return;
      write(work, {
        codeMode: cur.codeMode,
        ...(next !== undefined && { selectedFileByMode: next }),
      });
    },
    ...codeHistoryVerbs(() => histories.browserFor(work)),
  };
}

/** Keep a work's back/forward in step with the root its view shows: dropped
 *  when the root moves, kept on the first call so a fresh mount does not lose
 *  a stack. The caller hands the work and its root as one pair, read
 *  together. */
export function syncWorkCodeRoot(work: WorkId, root: string | null): void {
  histories.syncRepo(work, root);
}

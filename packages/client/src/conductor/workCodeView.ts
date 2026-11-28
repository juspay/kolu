/** A WORK'S CODE VIEW, AS THIS BROWSER KEEPS IT — the work's home behind the
 *  Code view's one state interface (`code-view/codeViewState.ts`), as
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
import { type Accessor, createEffect, createStore, untrack } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { type CodeLister, codeModeFor } from "../code-view/codeLister";
import {
  type CodeViewState,
  type SelectedFiles,
  codeHistoryVerbs,
  createCodeHistories,
  selectionWith,
} from "../code-view/codeViewState";
import { runAction } from "../runAction";
import { app } from "../wire";
import { useWorkKeys } from "./useWorks";

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
 *  first view of a work, and app-lifetime from then on.
 *
 *  MEMBERSHIP ALONE ({@link useWorkKeys}): which works there are is the whole
 *  question here, so this reads no record and nothing it holds grows with
 *  the fleet. */
const forgetGoneWorks = createSharedRoot(() => {
  const keys = useWorkKeys();
  createEffect(
    () => new Set(keys()),
    (now, before) => {
      if (before === undefined) return;
      for (const id of before) {
        if (now.has(id)) continue;
        setWritten((all) => {
          delete all[id];
        });
        histories.forget(id);
      }
    },
  );
});

/** The view as it stands: this browser's write, else the one kolu keeps,
 *  else where a fresh pane stands. */
function viewOf(work: WorkId): WorkCodeView {
  return written[work] ?? served().byKey(work)?.() ?? DEFAULT_WORK_CODE_VIEW;
}

/** A held record AS A DRAFT: the decoded view type is readonly, and the store
 *  write below assigns its leaves one at a time. */
type WorkCodeDraft = {
  -readonly [K in keyof Omit<
    WorkCodeView,
    "selectedFileByMode"
  >]: WorkCodeView[K];
} & {
  selectedFileByMode?: {
    -readonly [M in keyof SelectedFiles]: SelectedFiles[M];
  };
};

/** Write first, report after. ONE LEAF PER WRITE: assigning a rebuilt
 *  `selectedFileByMode` over the map the store already holds is
 *  `IMMUTABLE_UPDATE_IN_STORE` — two keys written, one of them unchanged —
 *  and wakes every reader of the other modes' leaves for a one-mode change.
 *  `mutate` is that per-key write; `next` stays the whole record, because the
 *  report is a whole-view report. The same rule, and the same four branches,
 *  as the Right panel's `writeFrom` arm (`right-panel/useRightPanel.ts`), the
 *  other face of this interface. */
function write(
  work: WorkId,
  next: WorkCodeView,
  mutate: (draft: WorkCodeDraft) => void,
): void {
  setWritten((all) => {
    const held = all[work];
    if (held) mutate(held as WorkCodeDraft);
    else all[work] = next;
  });
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

/** THE WORK'S VIEW AS PLAIN VALUES — a copy, never the store's own objects,
 *  so whoever compares against it reads no store property. */
function plainView(work: WorkId): WorkCodeView {
  const now = viewOf(work);
  return now.selectedFileByMode === undefined
    ? { codeMode: now.codeMode }
    : {
        codeMode: now.codeMode,
        selectedFileByMode: { ...now.selectedFileByMode },
      };
}

/** A WORK'S CODE VIEW STATE — the interface the view reads, for `work`.
 *  `lister` is who lists the work's root, for the one browse-only rule.
 *
 *  THE WRITERS READ NOTHING. `setSelectedFile` and `setCodeMode` are called
 *  from the Code tab's EFFECT PHASE as well as from clicks (a view clears a
 *  selection its tree no longer holds, and lands a front-door open, there),
 *  where no reactive state may be read — so the record they build the next
 *  one from is kept in a plain field here instead of read back out of the
 *  store. It is seeded once, kept by the effect below (this browser's own
 *  write, a frame from kolu-server, another face's write), and advanced by
 *  each write as it goes: a store write is not visible to a read until the
 *  next flush, so two writes in one frame would otherwise both build on the
 *  same old record. */
export function workCodeState(
  work: WorkId,
  lister: Accessor<CodeLister | null>,
): CodeViewState {
  forgetGoneWorks();
  // READ ONCE: the record the writers start from. Every one after it arrives
  // through the effect below or through a write of this face's own.
  let standing = untrack(() => plainView(work));
  createEffect(
    () => plainView(work),
    (now) => {
      standing = now;
    },
  );
  const record = (
    next: WorkCodeView,
    mutate: (d: WorkCodeDraft) => void,
  ): void => {
    standing = next;
    write(work, next, mutate);
  };
  return {
    codeMode: () => codeModeFor(lister(), viewOf(work).codeMode),
    setCodeMode: (mode) => {
      if (standing.codeMode === mode) return;
      record({ ...standing, codeMode: mode }, (s) => {
        s.codeMode = mode;
      });
    },
    selectedFile: (mode) => viewOf(work).selectedFileByMode?.[mode] ?? null,
    setSelectedFile: (mode, path) => {
      const next = selectionWith(standing.selectedFileByMode, mode, path);
      if (next === "unchanged") return;
      record(
        {
          codeMode: standing.codeMode,
          ...(next !== undefined && { selectedFileByMode: next }),
        },
        (s) => {
          if (next === undefined) {
            // The last selection went away. ABSENCE — not a present
            // `undefined` — is the only spelling of "no selection".
            delete s.selectedFileByMode;
          } else if (s.selectedFileByMode === undefined) {
            s.selectedFileByMode = { ...next };
          } else if (path === null) {
            delete s.selectedFileByMode[mode];
          } else {
            s.selectedFileByMode[mode] = path;
          }
        },
      );
    },
    ...codeHistoryVerbs(() => histories.browserFor(work)),
    canNavigateBack: () => histories.browserFor(work).canBack(),
    canNavigateForward: () => histories.browserFor(work).canForward(),
  };
}

/** Keep a work's back/forward in step with the root its view shows: dropped
 *  when the root moves, kept on the first call so a fresh mount does not lose
 *  a stack. The caller hands the work and its root as one pair, read
 *  together. */
export function syncWorkCodeRoot(work: WorkId, root: string | null): void {
  histories.syncRepo(work, root);
}

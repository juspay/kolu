/** THREE SCOPE CHANGES, THROUGH THE REAL CODE-VIEW SELECTION BRIDGE.
 *
 *  `useLineSelection`'s reseed used to write `range` (and the anchor) from an
 *  effect's apply arm, keyed on `[scope, initialRange]`. The viewer's own
 *  binding folds BOTH legs of that one change in a single memo:
 *  `@kolu/solid-pierre`'s `useCodeViewSelection` reads `range()` AND `id()`,
 *  where `id` is the very `() => props.filePath` the reseed is keyed on
 *  (`code-view/BrowseFileView.tsx:56-59`, `CodeMenuFrame.tsx:56`). A reader of
 *  both is exactly what an unsettled effect-origin write tears: the memo
 *  answers once in the flush the path changed (NEW id, STALE range — Pierre is
 *  told to highlight the old file's lines in the new file) and again after the
 *  reseed relays the change into `range`.
 *
 *  So the victim here is that bridge, standing as a mounted viewer holds it.
 *  Three changes, because an advisory tear escalates to a warning on the third
 *  — and the assertion is an EMPTY diagnostics list, `info` included, so the
 *  first sighting is already the failure.
 *
 *  Each round also asserts the SHOWN state: what the viewer is told to
 *  highlight, and which file the menu anchors to, matching the behaviour of
 *  the effect this derivation replaces.
 */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { CodeViewLineSelection, SelectedLineRange } from "@pierre/diffs";
import {
  type Accessor,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
} from "solid-js";
import { afterEach, expect, it } from "vitest";
import { useLineSelection } from "./useLineSelection";

/** `@kolu/solid-pierre`'s `useCodeViewSelection`, body for body
 *  (`packages/solid-pierre/src/useCodeViewSelection.ts:14-25`). Stood up here
 *  rather than imported because that package's barrel pulls in its Shiki
 *  grammars, one of which resolves through a Nix-backed Vite alias the client
 *  suite does not carry — and the subject of this test is the FOLD, which is
 *  these two reads in one memo. */
const useCodeViewSelection = (
  id: Accessor<string>,
  range: Accessor<SelectedLineRange | null>,
): Accessor<CodeViewLineSelection | null> =>
  createMemo(
    () => {
      const r = range();
      return r ? { id: id(), range: r } : null;
    },
    { name: "codeViewSelection" },
  );

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});

it("reseeds across three scope changes with no viewer binding left torn", () => {
  const [scope, setScope] = createSignal("src/a.ts");
  const [initial, setInitial] = createSignal<
    SelectedLineRange | null | undefined
  >(null);
  /** What the viewer was told to highlight, one entry per run of the bridge. */
  const runs: (string | null)[] = [];
  const show = (s: { id: string; range: SelectedLineRange } | null) =>
    s ? `${s.id}:${s.range.start}-${s.range.end}` : null;

  const built = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    const sel = useLineSelection(scope, { initialRange: initial });
    // THE VICTIM, as a mounted viewer folds it: the item id is the view's path
    // and the range is the controller's — both legs of one path change in one
    // memo (`code-view/BrowseFileView.tsx:56-59`).
    const codeViewSelection = useCodeViewSelection(scope, sel.range);
    // STANDING, as `<CodeView selectedLines>` holds it: a memo nobody reads
    // never re-runs, and a reader that never re-runs cannot be torn.
    createEffect(
      () => show(codeViewSelection()),
      (shown) => {
        runs.push(shown);
      },
      { name: "codeViewHighlight" },
    );
    return { sel, codeViewSelection };
  });
  flush();
  takeSolidDiagnostics();
  runs.length = 0;

  // A selection the user made, in a file the view merely contains (a
  // type-changed path's diff shows the files that used to live under it), so
  // every round below starts with both an anchor and a range to drop.
  built.sel.handleSelect({ start: 2, end: 4 }, "src/a.ts/old");
  flush();
  expect(show(built.codeViewSelection())).toBe("src/a.ts:2-4");
  expect(built.sel.path()).toBe("src/a.ts/old");
  expect(diagnostics()).toEqual([]);

  // Round 1 — a plain view switch, no navigation request: the selection and
  // its anchor go, and the viewer is told to highlight nothing.
  setScope("src/b.ts");
  flush();
  expect(show(built.codeViewSelection())).toBeNull();
  expect(runs.at(-1)).toBeNull();
  expect(built.sel.range()).toBeNull();
  expect(built.sel.path()).toBe("src/b.ts");
  expect(diagnostics()).toEqual([]);

  // Round 2 — a `path:line` navigation request: the switch and the target land
  // in ONE flush, exactly as a terminal link delivers them, and the viewer is
  // told to highlight the requested lines in the new file.
  built.sel.handleSelect({ start: 9, end: 9 });
  flush();
  takeSolidDiagnostics();
  setInitial({ start: 10, end: 12 });
  setScope("src/c.ts");
  flush();
  expect(show(built.codeViewSelection())).toBe("src/c.ts:10-12");
  expect(runs.at(-1)).toBe("src/c.ts:10-12");
  expect(built.sel.path()).toBe("src/c.ts");
  expect(diagnostics()).toEqual([]);

  // Round 3 — a switch while a request is still standing, from a selection the
  // user made elsewhere: the standing request seeds the new file, the anchor
  // does not survive. This is where an advisory tear escalates to a warning.
  built.sel.handleSelect({ start: 1, end: 1 }, "src/c.ts/old");
  flush();
  takeSolidDiagnostics();
  setScope("src/d.ts");
  flush();
  expect(show(built.codeViewSelection())).toBe("src/d.ts:10-12");
  expect(runs.at(-1)).toBe("src/d.ts:10-12");
  expect(built.sel.path()).toBe("src/d.ts");
  expect(diagnostics()).toEqual([]);

  // THE USER'S OWN SELECTION HOLDS while the scope stands still: a re-publish
  // of the same path is not an edge, and nothing reseeds over the user.
  built.sel.handleSelect({ start: 30, end: 31 });
  flush();
  setScope("src/d.ts");
  flush();
  expect(show(built.codeViewSelection())).toBe("src/d.ts:30-31");
  expect(built.sel.range()).toEqual({ start: 30, end: 31 });
  expect(built.sel.path()).toBe("src/d.ts");
  expect(diagnostics()).toEqual([]);

  // A NEW REQUEST INTO THE FILE ALREADY SHOWN (a `path:line` click naming the
  // open file): the other leg of the edge, so it reseeds over the user's
  // selection and its anchor even though the scope stood still.
  built.sel.handleSelect({ start: 60, end: 60 }, "src/d.ts/old");
  flush();
  setInitial({ start: 50, end: 50 });
  flush();
  expect(show(built.codeViewSelection())).toBe("src/d.ts:50-50");
  expect(built.sel.path()).toBe("src/d.ts");
  expect(diagnostics()).toEqual([]);
});

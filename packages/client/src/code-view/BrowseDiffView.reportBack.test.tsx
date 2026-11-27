// @vitest-environment happy-dom
/** THE VIEWER REPORTING BACK THE SELECTION IT WAS JUST HANDED.
 *
 *  Every other test of this controller drives `handleSelect` from a gesture
 *  that starts in kolu. This one drives the ONE call that starts in the
 *  viewer: `@pierre/diffs` answers a prop-driven `setSelectedLines` by calling
 *  `onSelectedLinesChange` back — synchronously, from inside the wrapper
 *  effect's apply arm, with the very range it was given. That is the only
 *  gesture in which `handleSelect` is called with values equal to the state it
 *  already holds, so it is the only one where equal-write suppression matters.
 *  Lose it and the echo is a change: the bridge memo (`useCodeViewSelection`,
 *  which reads `selection.path` — the RAW composite) re-runs, and the viewer's
 *  own effect re-runs on its own write (`EFFECT_WRITES_OWN_SOURCE`).
 *
 *  Real here: `BrowseDiffView` / `BrowseFileView`, `CodeMenuFrame`,
 *  `useLineSelection`, `useCodeViewSelection`, `@kolu/solid-pierre`'s
 *  `CodeView` with all of its effects, and `codeViewItemIdAt`/`itemIdOnPath`
 *  — so the right-click resolves its item id through the real path walk.
 *  Doubled: `@pierre/diffs` itself (its real `CodeView` needs workers and a
 *  renderer happy-dom lacks), reproducing the three rules that make the echo,
 *  each cited at its line in the installed dist.
 *
 *  Each round asserts an EMPTY diagnostics drain (`info` included), the
 *  double's held selection — what the viewer was told to paint — and the
 *  shown menu's `Copy <path>:<line>`, the user-visible half.
 */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { type JSX, render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

type Range = { start: number; end: number; side?: string; endSide?: string };
type Selection = { id: string; range: Range };

type Double = {
  /** What the viewer currently paints. */
  selected: Selection | null;
  /** Every `setSelectedLines` the wrapper's effect made — an equal write that
   *  reaches the controller still costs one of these. */
  applies: number;
  /** A GENUINE user gutter selection, as Pierre dispatches one: it stores the
   *  range without notifying itself and then reports it anyway
   *  (`dist/components/CodeView.js:1203-1227` — the `notify: false` apply and
   *  the unconditional `onSelectedLinesChange` are two separate statements).
   *  Re-selecting the line kolu already holds is therefore an equal write that
   *  no `notify` gate can stop. */
  userSelect: (id: string, range: Range) => void;
};

const { pierre } = vi.hoisted(() => ({ pierre: { views: [] as Double[] } }));

vi.mock("@pierre/diffs", () => {
  /** `dist/utils/areSelectionsEqual.js` — BY VALUE, not by reference. */
  const areSelectionsEqual = (
    a: Range | null | undefined,
    b: Range | null | undefined,
  ): boolean =>
    a?.start === b?.start &&
    a?.end === b?.end &&
    a?.side === b?.side &&
    a?.endSide === b?.endSide;

  // biome-ignore lint/suspicious/noExplicitAny: test double for Pierre's item/option shapes
  type Any = any;

  class MockCodeView {
    options: Any;
    root: HTMLElement | undefined;
    items: Any[] = [];
    selected: Selection | null = null;
    applies = 0;
    rendered: { id: string; element: Element }[] = [];

    constructor(options: Any) {
      this.options = options;
      pierre.views.push(this as unknown as Double);
    }
    setup(root: HTMLElement) {
      this.root = root;
    }
    setOptions(options: Any) {
      this.options = options;
    }
    setItems(items: Any[]) {
      this.items = items;
      this.paint();
    }
    render() {
      this.paint();
    }
    scrollTo() {}
    cleanUp() {
      this.rendered = [];
    }
    /** (c) The rows the real id resolution matches a right-click against
     *  (`codeViewItemIdAt` → `itemIdOnPath`). */
    getRenderedItems() {
      return this.rendered;
    }

    /** What kolu's wrapper calls. Counted, so a round can assert that an
     *  equal report-back costs no re-assertion of the selection at all. */
    setSelectedLines(
      selection: Selection | null,
      options?: { notify?: boolean },
    ) {
      this.applies++;
      this.applySelectedLines(selection, options);
    }

    applySelectedLines(
      selection: Selection | null,
      options?: { notify?: boolean },
    ) {
      const prev = this.selected;
      // (a) `dist/components/CodeView.js:953-958`: the held selection already
      // paints this, so there is nothing to do.
      if (
        (selection == null && prev == null) ||
        (selection != null &&
          prev?.id === selection.id &&
          areSelectionsEqual(prev.range, selection.range))
      ) {
        return;
      }
      this.selected = selection;
      // (b) `:1214-1220` via `InteractionManager.setSelection` (`:94-105`) and
      // `notifySelectionCommitted` (`:862-864`): unless `notify === false`,
      // report the selection straight back — SYNCHRONOUSLY, and with the same
      // `range` reference it was handed.
      if (options?.notify === false) return;
      this.options.onSelectedLinesChange?.(
        selection == null ? null : { id: selection.id, range: selection.range },
      );
    }

    userSelect(id: string, range: Range) {
      this.applySelectedLines({ id, range }, { notify: false });
      this.options.onSelectedLinesChange?.({ id, range });
    }

    paint() {
      const root = this.root;
      if (!root) return;
      root.textContent = "";
      this.rendered = this.items.map((item: Any) => {
        const el = document.createElement("div");
        const body: string =
          item.type === "file" ? item.file.contents : item.fileDiff.contents;
        for (const [i, text] of body.split("\n").entries()) {
          const row = document.createElement("div");
          row.setAttribute("data-column-number", String(i + 1));
          row.textContent = text;
          el.append(row);
        }
        root.append(el);
        return { id: item.id as string, element: el };
      });
    }
  }

  // `diffItems` runs Pierre's parser for real; the double hands it one file
  // whose "contents" is the raw hunk, which is all the renderer above needs.
  const parsePatchFiles = (raw: string) => [
    { files: [{ name: "diff", contents: raw }] },
  ];
  const parseDiffFromFile = (
    _old: unknown,
    next: { name: string; contents: string },
  ) => next;

  return { CodeView: MockCodeView, parsePatchFiles, parseDiffFromFile };
});

// The real pool builds web workers (precedent:
// `solid-pierre/src/CodeView.selection.test.tsx:49-52`); the wrapper only
// passes it through.
vi.mock("../../../solid-pierre/src/workerPool", () => ({
  HIGHLIGHTER_CONTRACT: {},
  getCodeViewWorkerPool: () => ({}),
}));

import BrowseDiffView from "./BrowseDiffView";
import BrowseFileView from "./BrowseFileView";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  pierre.views.length = 0;
});

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map((e) => `[${e.severity}] ${e.code} ${e.message}`);

const view = (): Double => {
  const v = pierre.views.at(-1);
  if (!v) throw new Error("the viewer was never constructed");
  return v;
};

/** The shown menu's entries, as the user reads them. */
const menuLabels = (): string[] =>
  Array.from(
    document.querySelectorAll("#code-context-menu [role=menuitem]"),
  ).map((b) => (b.textContent ?? "").trim());

/** A real right-click on a gutter row: the one gesture that both selects the
 *  line and opens the menu (`CodeMenuFrame`). The press comes first, as a
 *  browser sends it — that is what dismisses a menu still open from the last
 *  right-click, so the second one mounts a fresh menu rather than updating
 *  the standing one's rows. */
const rightClickLine = (host: HTMLElement, line: number): void => {
  const row = host.querySelector(`[data-column-number="${line}"]`);
  if (!row) throw new Error(`no gutter row for line ${line}`);
  row.dispatchEvent(
    new MouseEvent("mousedown", { bubbles: true, composed: true, button: 2 }),
  );
  flush();
  row.dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, composed: true }),
  );
  flush();
};

const mount = (element: () => JSX.Element): HTMLElement => {
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(element, host);
  flush();
  return host;
};

it("holds still when the diff viewer reports back the selection it was handed", async () => {
  const [path, setPath] = createSignal("src/a.ts");
  const [hunk, setHunk] = createSignal("a one\na two\na three");
  const host = mount(() => (
    <BrowseDiffView
      onOpen={() => {}}
      path={path()}
      hunk={hunk()}
      theme="dark"
    />
  ));
  // `onSettled` builds the instance.
  await Promise.resolve();
  flush();
  diagnostics();

  // Round 1 — the right-click that is red at the head: kolu writes a range,
  // the bridge memo wakes, the wrapper's effect pushes it into the viewer, and
  // the viewer answers inside that apply arm with the same range.
  rightClickLine(host, 1);
  expect(view().selected).toEqual({
    id: "src/a.ts",
    range: { start: 1, end: 1 },
  });
  expect(menuLabels()).toContain("Copy src/a.ts:1");
  expect(diagnostics()).toEqual([]);

  // Round 2 — the same line again: the pure echo round, where every write in
  // the chain carries the value already held.
  rightClickLine(host, 1);
  expect(view().selected).toEqual({
    id: "src/a.ts",
    range: { start: 1, end: 1 },
  });
  expect(menuLabels()).toContain("Copy src/a.ts:1");
  expect(diagnostics()).toEqual([]);

  // Round 3 — switch files, then right-click line 2 there: `code-tab.feature`'s
  // "Switching diff files keeps the `Copy path:line` entry in sync".
  setPath("src/b.ts");
  setHunk("b one\nb two\nb three");
  flush();
  rightClickLine(host, 2);
  expect(view().selected).toEqual({
    id: "src/b.ts",
    range: { start: 2, end: 2 },
  });
  expect(menuLabels()).toContain("Copy src/b.ts:2");
  expect(diagnostics()).toEqual([]);

  // Round 4 — the viewer's OWN gutter selection of the line kolu already
  // holds. Pierre reports a user gesture whatever the apply's `notify` says,
  // so this is the report-back that survives every gate: a controller that
  // treats it as a change re-asserts the selection into the viewer for nothing.
  const applies = view().applies;
  view().userSelect("src/b.ts", { start: 2, end: 2 });
  flush();
  expect(view().applies).toBe(applies);
  expect(view().selected).toEqual({
    id: "src/b.ts",
    range: { start: 2, end: 2 },
  });
  expect(diagnostics()).toEqual([]);
});

it("holds still when the file viewer reports back without naming the file", async () => {
  // `BrowseFileView` passes NO path in the echo (`onSelectedLinesChange={(s) =>
  // lineSelection.handleSelect(s?.range ?? null)}`), while the right-click
  // names the item it landed in. Only normalising the anchor against the
  // view's own scope makes those two the same state.
  const [filePath, setFilePath] = createSignal("src/one.ts");
  const [content, setContent] = createSignal("one\ntwo\nthree");
  const host = mount(() => (
    <BrowseFileView filePath={filePath()} content={content()} theme="dark" />
  ));
  await Promise.resolve();
  flush();
  diagnostics();

  rightClickLine(host, 2);
  expect(view().selected).toEqual({
    id: "src/one.ts",
    range: { start: 2, end: 2 },
  });
  expect(menuLabels()).toContain("Copy src/one.ts:2");
  expect(diagnostics()).toEqual([]);

  rightClickLine(host, 2);
  expect(view().selected).toEqual({
    id: "src/one.ts",
    range: { start: 2, end: 2 },
  });
  expect(diagnostics()).toEqual([]);

  setFilePath("src/two.ts");
  setContent("alpha\nbeta\ngamma");
  flush();
  rightClickLine(host, 3);
  expect(view().selected).toEqual({
    id: "src/two.ts",
    range: { start: 3, end: 3 },
  });
  expect(menuLabels()).toContain("Copy src/two.ts:3");
  expect(diagnostics()).toEqual([]);
});

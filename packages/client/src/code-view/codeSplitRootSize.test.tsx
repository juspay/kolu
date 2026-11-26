// @vitest-environment happy-dom
/**
 * THE CODE TAB'S SPLIT AGAINST THE SIZE ITS ROOT IS MEASURED AT.
 *
 * `@corvu-next/utils`' `createSize` is the one measurement in the resizable's
 * size path: it reads the root element's `offsetWidth`/`offsetHeight`, and
 * everything bound in pixels — a collapsible panel's `collapsedSize`, a
 * handle's aria band, a min size written in `px` — resolves against it. It is
 * a derivation now rather than a signal written from an effect's apply arm,
 * which is what this file pins from kolu's side: corvu's own suite does not
 * run in kolu's CI, and a measurement that lands a flush late puts the panels
 * on screen against a root of no size at all.
 *
 * The shape is the Code tab's — the root at `CodeTab.tsx:1324`, the inner
 * handle with `startIntersection={false}` at `:1504`, the content panel at
 * `:1532` — and the last three tests drive the PRODUCT's own wiring rather
 * than a stand-in for it: `createCodeSplit` arranged by a measured width
 * (`WorkCode.tsx:128`) and by the Right panel's literal `"stacked"`
 * (`RightPanel.tsx:257`), with the live `sizes`/`onSizesChange` pair that
 * writes the tree-size preference back from inside corvu's own size report.
 *
 * WHY THE WRITE-BACK IS NOT A RELAY TEAR, and how this file says so. A tear
 * needs the write that re-runs the victim to come from an EFFECT's frame
 * (`@solidjs/signals` `dev.attribution.js` `checkRelayTear`: a root write
 * whose origin is not an effect ends the check). Corvu reports a layout from
 * a registration frame only when it computes one of its own — with the sizes
 * controlled and as many of them as there are panels it hands back what it
 * was given — so every report kolu answers comes from a pointer or a key,
 * which is an event's frame, not an effect's. The last test is the control
 * that keeps this an observation rather than a sleeping detector: the same
 * split, with the report made from an effect's apply arm, raises the tear and
 * names the preference as what was written.
 *
 * The root's size is stubbed on the element itself, because happy-dom lays
 * nothing out and its `ResizeObserver` never calls back: the memo's reading
 * of the element is the only measurement a test can see, so a panel bound in
 * pixels is how the measurement becomes observable.
 */

import Resizable from "@corvu-next/resizable";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { createElementSize } from "@solid-primitives/resize-observer";
import { render } from "@solidjs/web";
import { createEffect, createSignal, createStore, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { controlledSizes } from "../ui/corvuResizable";
import {
  type CodeArrangement,
  codeArrangement,
  createCodeSplit,
} from "./codeSplit";

// The stacked tree share is the Right panel's server preference. What the
// split sees of it is a reader and a writer, so the mock is those two over a
// signal each test owns, behind the real writer's band and epsilon guards
// (`useRightPanel.ts:557-566`). A coalesced preference patch applies to the
// local store at once, so the write-back lands in the flush it is made in,
// exactly as it does in the app.
const pref = vi.hoisted(() => ({
  read: (() => 0.35) as () => number,
  write: ((_: number) => {}) as (size: number) => void,
}));

vi.mock("../right-panel/useRightPanel", () => ({
  MIN_CODE_PANE_SHARE: 0.1,
  useRightPanel: () => ({
    codeTabTreeSize: () => pref.read(),
    setCodeTabTreeSize: (size: number) => pref.write(size),
  }),
}));

/** The tree-size preference as the Right panel keeps it: a live value behind
 *  the real setter's guards. The last written share is mirrored in a plain
 *  variable, so the guard does not read the signal from whatever frame the
 *  write was made in. */
function treeSizePref(initial: number): () => number {
  const [size, setSize] = createSignal(initial, { name: "codeTabTreeSize" });
  let held = initial;
  pref.read = size;
  pref.write = (next) => {
    if (next < 0.1 || next > 0.9 || Math.abs(next - held) <= 1e-6) return;
    held = next;
    setSize(next);
  };
  return size;
}

/** A root 200px across and 800px down, so the dimension the root is measured
 *  in decides what half of the layout is worth in pixels. */
function stubRootBox(element: HTMLElement): void {
  Object.defineProperty(element, "offsetWidth", { value: 200 });
  Object.defineProperty(element, "offsetHeight", { value: 800 });
}

/** Every finding this test's own work raised, as `code message` pairs. */
const raised = () =>
  takeSolidDiagnostics().map((event) => `${event.code} ${event.message}`);

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;
afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

it("gives the split's panels the root size of the flush the orientation changed in", () => {
  const [orientation, setOrientation] = createSignal<"vertical" | "horizontal">(
    "vertical",
  );
  const sizes = controlledSizes(() => [0.5, 0.5]);

  // The element applies all of its props in one effect, so counting the reads
  // of one of them counts how often the tree panel was written.
  let applies = 0;
  const treeLabel = () => {
    applies++;
    return `tree ${orientation()}`;
  };

  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <Resizable orientation={orientation()} sizes={sizes()} ref={stubRootBox}>
        <Resizable.Panel
          as="div"
          data-testid="diff-file-list"
          collapsible
          collapsedSize="100px"
          aria-label={treeLabel()}
        />
        <Resizable.Handle as="button" startIntersection={false} />
        <Resizable.Panel as="div" data-testid="diff-content" />
      </Resizable>
    ),
    host,
  );
  flush();

  const tree = host.querySelector("[data-testid='diff-file-list']")!;

  // Beside the panels, the root is 200px across, and half of it is the tree
  // panel's collapsed size — the panels registered against the measured root,
  // not against a root of zero.
  setOrientation("horizontal");
  flush();
  expect(tree.hasAttribute("data-collapsed")).toBe(true);

  // FIVE MORE TURNS, past every window a check judges over several runs: the
  // consecutive-equal-output gate closes at four, so a drive that sat exactly
  // at it could be silenced by dropping one write rather than by fixing
  // anything.
  const appliesPerChange: number[] = [];
  const collapsedPerChange: boolean[] = [];
  for (const next of [
    "vertical",
    "horizontal",
    "vertical",
    "horizontal",
    "vertical",
  ] as const) {
    applies = 0;
    setOrientation(next);
    flush();
    appliesPerChange.push(applies);
    collapsedPerChange.push(tree.hasAttribute("data-collapsed"));
  }

  // One write of the element per change of the orientation, each carrying the
  // size the root has in that very flush.
  expect(appliesPerChange).toEqual([1, 1, 1, 1, 1]);
  expect(collapsedPerChange).toEqual([false, true, false, true, false]);
  expect(raised()).toEqual([]);
});

/** The product's split, with the product's props on the three children. The
 *  tree panel carries a label derived from the selection, so counting its
 *  reads counts how often the element was written. */
function CodeSplitView(props: {
  arrangement: CodeArrangement;
  label: () => string;
}) {
  const split = createCodeSplit(() => props.arrangement);
  return (
    <Resizable
      orientation={split.layout().orientation}
      sizes={split.sizes()}
      onSizesChange={split.onSizesChange}
      ref={stubRootBox}
    >
      <Resizable.Panel
        as="div"
        data-testid="diff-file-list"
        class={`min-h-0 ${split.layout().treeEdge} border-edge`}
        aria-label={props.label()}
        minSize={0.1}
      />
      <Resizable.Handle
        as="button"
        data-testid="diff-tree-content-handle"
        aria-label="Resize tree pane"
        startIntersection={false}
        onHandleDrag={split.onHandleDrag}
        onHandleDragEnd={split.onHandleDragEnd}
      />
      <Resizable.Panel as="div" data-testid="diff-content" minSize={0.1} />
    </Resizable>
  );
}

it("writes the Code tab's panels once per selection write, arranged by a measured box", () => {
  treeSizePref(0.35);
  // The per-terminal selection the Code tab keeps in a store: it changes what
  // the panels SHOW, never how they are arranged.
  const [selection, setSelection] = createStore({ path: "a.ts" });
  let applies = 0;

  // A picked work measures its own box and asks `codeArrangement`
  // (`WorkCode.tsx:128`); a box this wide stands the tree beside the file.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1000,
    height: 600,
  } as DOMRect);
  const Box = () => {
    const [box, setBox] = createSignal<HTMLDivElement>();
    const size = createElementSize(box);
    return (
      <div ref={setBox}>
        <CodeSplitView
          arrangement={
            size.width === null ? "stacked" : codeArrangement(size.width)
          }
          label={() => {
            applies++;
            return `tree ${selection.path}`;
          }}
        />
      </div>
    );
  };

  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <Box />, host);
  flush();

  const root = host.querySelector<HTMLElement>("[data-corvu-resizable-root]")!;
  const tree = host.querySelector<HTMLElement>(
    "[data-testid='diff-file-list']",
  )!;
  expect(root.dataset.orientation).toBe("horizontal");
  // The side-by-side share, which no selection write may move.
  expect(tree.style.flexBasis).toBe("30%");

  const appliesPerWrite: number[] = [];
  for (const path of ["b.ts", "c.ts", "d.ts", "e.ts", "f.ts"]) {
    applies = 0;
    setSelection((draft) => {
      draft.path = path;
    });
    flush();
    appliesPerWrite.push(applies);
  }

  // ONE WRITE OF THE ELEMENT PER WRITE OF THE SELECTION. A second one would
  // be the split's own size path relaying the change: the panel painted the
  // new selection against the previous layout, and the layout caught up a
  // flush later.
  expect(appliesPerWrite).toEqual([1, 1, 1, 1, 1]);
  expect(tree.getAttribute("aria-label")).toBe("tree f.ts");
  expect(tree.style.flexBasis).toBe("30%");
  expect(raised()).toEqual([]);
});

it("carries a stacked split's keyboard step through the tree-size preference and back", () => {
  const treeSize = treeSizePref(0.35);
  const [selection, setSelection] = createStore({ path: "a.ts" });
  let applies = 0;

  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      // The Right panel hands the literal (`RightPanel.tsx:257`).
      <CodeSplitView
        arrangement="stacked"
        label={() => {
          applies++;
          return `tree ${selection.path}`;
        }}
      />
    ),
    host,
  );
  flush();

  const tree = host.querySelector<HTMLElement>(
    "[data-testid='diff-file-list']",
  )!;
  const handle = host.querySelector<HTMLElement>(
    "[data-testid='diff-tree-content-handle']",
  )!;
  expect(tree.style.flexBasis).toBe("35%");

  // FIVE KEYBOARD STEPS on the real handle, each 0.1 of the root. Every one
  // of them reports a layout corvu computed, which kolu answers by writing
  // the preference — and the panel it is handed back to moves in that same
  // flush, writing the element once.
  const seen: Array<{
    share: number;
    basis: string;
    now: string;
    runs: number;
  }> = [];
  for (let step = 0; step < 5; step++) {
    applies = 0;
    handle.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );
    flush();
    seen.push({
      share: Math.round(treeSize() * 100) / 100,
      basis: `${Math.round(Number.parseFloat(tree.style.flexBasis))}%`,
      // The handle's own aria band, written by the effect that applies the
      // four attributes: it follows the same layout, so it is asserted
      // directly rather than through a count of equal runs.
      now: handle.getAttribute("aria-valuenow") ?? "",
      runs: applies,
    });
  }
  expect(seen).toEqual([
    { share: 0.45, basis: "45%", now: "0.45", runs: 1 },
    { share: 0.55, basis: "55%", now: "0.55", runs: 1 },
    { share: 0.65, basis: "65%", now: "0.65", runs: 1 },
    { share: 0.75, basis: "75%", now: "0.75", runs: 1 },
    { share: 0.85, basis: "85%", now: "0.85", runs: 1 },
  ]);

  // And a selection write afterwards still writes the element once and moves
  // no share: the layout is not derived from what is selected.
  const appliesPerWrite: number[] = [];
  for (const path of ["b.ts", "c.ts", "d.ts", "e.ts", "f.ts"]) {
    applies = 0;
    setSelection((draft) => {
      draft.path = path;
    });
    flush();
    appliesPerWrite.push(applies);
  }
  expect(appliesPerWrite).toEqual([1, 1, 1, 1, 1]);
  expect(treeSize()).toBe(0.85);
  expect(raised()).toEqual([]);
});

// THE CONTROL FOR THE TWO ABOVE. Their silence is a fact about where corvu
// reports from, so it is worth nothing unless the same split, reported from
// an effect's apply arm, is seen to tear. It is: the panel is written twice
// for one selection write, and the finding names kolu's write-back as the
// relay and the preference as what it wrote — the pair `solidDevBuild.ts`
// prints for the dev lane.
it("tears when the layout is reported from an effect's apply arm", () => {
  treeSizePref(0.35);
  const [selection, setSelection] = createStore({ path: "a.ts" });
  let applies = 0;

  const Reported = () => {
    const split = createCodeSplit(() => "stacked" as const);
    let step = 0;
    createEffect(
      () => selection.path,
      () => {
        step += 1;
        const share = 0.35 + step * 0.05;
        split.onSizesChange([share, 1 - share]);
      },
      { name: "reportFromEffect" },
    );
    return (
      <Resizable
        orientation={split.layout().orientation}
        sizes={split.sizes()}
        onSizesChange={split.onSizesChange}
        ref={stubRootBox}
      >
        <Resizable.Panel
          as="div"
          data-testid="diff-file-list"
          aria-label={(() => {
            applies++;
            return `tree ${selection.path}`;
          })()}
          minSize={0.1}
        />
        <Resizable.Handle as="button" startIntersection={false} />
        <Resizable.Panel as="div" data-testid="diff-content" minSize={0.1} />
      </Resizable>
    );
  };

  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <Reported />, host);
  flush();

  const appliesPerWrite: number[] = [];
  for (const path of ["b.ts", "c.ts", "d.ts", "e.ts", "f.ts"]) {
    applies = 0;
    setSelection((draft) => {
      draft.path = path;
    });
    flush();
    appliesPerWrite.push(applies);
  }
  expect(appliesPerWrite).toEqual([2, 2, 2, 2, 2]);

  const tears = takeSolidDiagnostics()
    .filter((event) => event.code === "EFFECT_RELAY_TEAR")
    .map((event) => event.data as Record<string, unknown>);
  expect(tears.length).toBeGreaterThan(0);
  expect({
    root: tears[0]?.root,
    relay: tears[0]?.relay,
    wrote: tears[0]?.wrote,
  }).toEqual({
    root: "selection.path",
    relay: "reportFromEffect",
    wrote: "codeTabTreeSize",
  });
});

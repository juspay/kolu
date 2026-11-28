/**
 * Pierre holds the selection callback it was CONSTRUCTED with and fires it
 * from its own dispatch — a strict-read window. The wrapper's callers spread a
 * merged props object (`{...koluCodeViewProps()}`), so `props` inside the
 * wrapper is a `merge()` key bag: reading `props.onSelectedLinesChange` when
 * Pierre fires is a read of a reactive source in an effect callback, which
 * `@kolu/solid-test-setup` fails the test on.
 *
 * These tests pin the mirror: the Pierre-facing closure reads a plain field,
 * the field is kept current by a tracked compute, and a consumer that swaps
 * its handler still takes effect — without the wrapper re-applying Pierre's
 * options for the swap.
 */
import { render } from "@solidjs/web";
import { createEffect, createRoot, createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodeViewLineSelection } from "@pierre/diffs";

// The mock captures the options Pierre was built with, so a test can make
// "Pierre" emit a selection — through the callback it was CONSTRUCTED with,
// and through the one a later `setOptions` handed it.
const { pierre } = vi.hoisted(() => ({
  pierre: {
    emit: (_selection: CodeViewLineSelection | null) => {},
    /** Every selection Pierre reported back on its own — what a prop-driven
     *  push must NOT produce. */
    reported: [] as (CodeViewLineSelection | null)[],
  },
}));

vi.mock("@pierre/diffs", () => {
  class MockCodeView {
    // biome-ignore lint/suspicious/noExplicitAny: test double for Pierre's options
    opts: any;
    // biome-ignore lint/suspicious/noExplicitAny: test double for Pierre's options
    constructor(opts: any) {
      this.opts = opts;
      pierre.emit = (selection) => opts?.onSelectedLinesChange?.(selection);
    }
    setup() {}
    setItems() {}
    setSelectedLines(
      selection: CodeViewLineSelection | null,
      options?: { notify?: boolean },
    ) {
      // `InteractionManager.setSelection` (`dist/managers/InteractionManager.js:94-105`)
      // reports a changed range back through `notifySelectionCommitted`
      // (`:862-864`) unless the write says `notify: false` — which is how a
      // selection the consumer PUSHED comes straight back as if the user had
      // made it.
      if (options?.notify === false) return;
      pierre.reported.push(selection);
      this.opts?.onSelectedLinesChange?.(selection);
    }
    render() {}
    scrollTo() {}
    // biome-ignore lint/suspicious/noExplicitAny: test double for Pierre's options
    setOptions(opts: any) {
      this.opts = opts;
      pierre.emit = (selection) => opts?.onSelectedLinesChange?.(selection);
    }
    getRenderedItems() {
      return [];
    }
    cleanUp() {}
  }
  return { CodeView: MockCodeView };
});

// The real pool builds web workers; the wrapper only passes it through.
vi.mock("./workerPool", () => ({
  HIGHLIGHTER_CONTRACT: {},
  getCodeViewWorkerPool: () => ({}),
}));

import { CodeView, type CodeViewProps } from "./CodeView";

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  pierre.reported.length = 0;
});

/** Mount the wrapper the way its callers do: every prop arrives through a
 *  SPREAD, so `props` inside the component is a `merge()` key bag. */
function mount(bag: () => Partial<CodeViewProps>): void {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const dispose = render(
    () => (
      <CodeView
        items={[]}
        theme="light"
        onError={(e) => {
          throw e;
        }}
        {...bag()}
      />
    ),
    host,
  );
  disposers.push(dispose, () => host.remove());
}

const SELECTION: CodeViewLineSelection = {
  id: "src/main.rs",
  range: { start: 3, end: 7 },
} as CodeViewLineSelection;

describe("CodeView — the handler Pierre holds", () => {
  it("fires from an effect's apply arm without reading a merged prop", async () => {
    const seen: (CodeViewLineSelection | null)[] = [];
    mount(() => ({
      enableLineSelection: true,
      onSelectedLinesChange: (s) => seen.push(s),
    }));
    // `onSettled` builds the instance; let it run before Pierre can fire.
    await Promise.resolve();
    createRoot((dispose) => {
      // Pierre dispatches from inside its own callback phase. An effect's
      // apply arm is the same window, and the one a unit test can drive.
      createEffect(
        () => undefined,
        () => {
          pierre.emit(SELECTION);
        },
        { name: "codeViewSelectionDispatch" },
      );
      flush();
      dispose();
    });
    expect(seen).toEqual([SELECTION]);
  });

  it("follows a handler the consumer swaps", async () => {
    const first: (CodeViewLineSelection | null)[] = [];
    const second: (CodeViewLineSelection | null)[] = [];
    const [toSecond, setToSecond] = createSignal(false);
    mount(() => ({
      enableLineSelection: true,
      onSelectedLinesChange: toSecond()
        ? (s: CodeViewLineSelection | null) => second.push(s)
        : (s: CodeViewLineSelection | null) => first.push(s),
    }));
    await Promise.resolve();
    setToSecond(true);
    flush();
    pierre.emit(null);
    expect(first).toEqual([]);
    expect(second).toEqual([null]);
  });

  it("pushes a selection into Pierre without it being reported back", async () => {
    // PROVENANCE, the gate `FileTree` already carries (`FileTree.tsx:251-268`,
    // `:872-890`): a selection the consumer PUSHED is not a user selection, so
    // the programmatic echo stops at the wrapper rather than round-tripping
    // through `onSelectedLinesChange` — which is how a controller that holds
    // one composite state ends up writing its own source.
    const seen: (CodeViewLineSelection | null)[] = [];
    const [selected, setSelected] = createSignal<CodeViewLineSelection | null>(
      null,
    );
    mount(() => ({
      enableLineSelection: true,
      selectedLines: selected(),
      onSelectedLinesChange: (s: CodeViewLineSelection | null) => seen.push(s),
    }));
    await Promise.resolve();
    flush();
    seen.length = 0;
    pierre.reported.length = 0;

    setSelected(SELECTION);
    flush();

    expect(pierre.reported).toEqual([]);
    expect(seen).toEqual([]);
    // The user's OWN gutter selection still reaches the consumer: Pierre
    // dispatches that one itself, whatever the apply said.
    pierre.emit(SELECTION);
    expect(seen).toEqual([SELECTION]);
  });
});

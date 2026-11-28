// @vitest-environment happy-dom
/**
 * `CodeContextMenu`'s controller is called from the host's `contextmenu`
 * handler, and that handler writes the very selection the items describe
 * (`CodeMenuFrame` → `useLineSelection.handleSelect`) one statement before
 * it calls `open`. Signal writes are staged until a flush, so an `open`
 * that samples `getItems()` straight sees the selection as it stood BEFORE
 * the right-click — on the first right-click, no selection at all, which
 * means an empty item list and no menu.
 *
 * The test drives that exact order: write, then open, synchronously.
 */

import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodeContextMenu,
  type CodeContextMenuController,
} from "./CodeContextMenu";
import { CopyIcon } from "./Icons";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

/** Mount the menu over a line signal that stands in for the host's line
 *  selection: no line selected means nothing to offer. */
function mountOverSelection() {
  const [line, setLine] = createSignal<number | null>(null);
  let ctrl: CodeContextMenuController | undefined;
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <CodeContextMenu
        getItems={() => {
          const l = line();
          return l === null
            ? []
            : [
                {
                  kind: "copy",
                  label: `Copy x.ts:${l}`,
                  icon: CopyIcon,
                  textToCopy: `x.ts:${l}`,
                },
              ];
        }}
        ref={(c) => {
          ctrl = c;
        }}
      />
    ),
    host,
  );
  flush();
  if (!ctrl) throw new Error("controller was never handed over");
  return { setLine, ctrl };
}

const labels = () =>
  [...document.querySelectorAll('#code-context-menu [role="menuitem"]')].map(
    (el) => el.textContent?.trim(),
  );
const rightClick = () =>
  new MouseEvent("contextmenu", { clientX: 11, clientY: 22, cancelable: true });

describe("CodeContextMenu", () => {
  it("offers the line the same handler just selected", () => {
    const { setLine, ctrl } = mountOverSelection();
    const event = rightClick();
    // The host's `contextmenu` handler, verbatim: select, then open.
    setLine(2);
    ctrl.open(event);
    flush();
    expect(labels()).toEqual(["Copy x.ts:2"]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("stays shut when the gesture selected nothing", () => {
    const { ctrl } = mountOverSelection();
    const event = rightClick();
    ctrl.open(event);
    flush();
    expect(labels()).toEqual([]);
    // Nothing to offer: the browser's own menu is left to open.
    expect(event.defaultPrevented).toBe(false);
  });
});

/** THE CODE VIEW'S SPLIT: when the tree stands beside the file, and how the
 *  side-by-side share is read and kept on this device. */

import Resizable from "@corvu-next/resizable";
import { createElementSize } from "@solid-primitives/resize-observer";
import { createRoot, createSignal } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type CodeArrangement,
  codeArrangement,
  createCodeSplit,
} from "./codeSplit";

const KEY = "kolu-code-tab-beside-tree-size";

const h = vi.hoisted(() => {
  // A share a person dragged to, in storage before this file's static import
  // of the split loads and reads it.
  localStorage.setItem("kolu-code-tab-beside-tree-size", "0.2");
  return { setStacked: vi.fn() };
});

// The stacked share is the Right panel's preference, not this file's subject.
vi.mock("../right-panel/useRightPanel", () => ({
  MIN_CODE_PANE_SHARE: 0.1,
  useRightPanel: () => ({
    codeTabTreeSize: () => 0.35,
    setCodeTabTreeSize: h.setStacked,
  }),
}));

/** A fresh module, so the share is read from storage as it stands now: the
 *  stored value is read once, when the module loads, so a static import
 *  cannot see what each test stores. */
const besideSplit = async () => {
  vi.resetModules();
  const fresh = await import("./codeSplit");
  return createRoot(() => fresh.createCodeSplit(() => "beside"));
};

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  h.setStacked.mockClear();
  document.body.innerHTML = "";
});

describe("codeArrangement", () => {
  it("stands the tree beside the file from 720px, and stacks it below", () => {
    expect(codeArrangement(720)).toBe("beside");
    expect(codeArrangement(719.5)).toBe("stacked");
  });
});

describe("the side-by-side share", () => {
  it.each([
    "abc",
    "0.95",
    "0.05",
    '"0.4"',
  ])("reads a stored %s as the default", async (raw) => {
    localStorage.setItem(KEY, raw);
    expect((await besideSplit()).sizes()[0]).toBe(0.3);
  });

  it("reads a stored share in the band", async () => {
    localStorage.setItem(KEY, "0.42");
    expect((await besideSplit()).sizes()[0]).toBe(0.42);
  });

  it("is stored once, at the end of a pointer drag", async () => {
    const split = await besideSplit();
    split.onHandleDrag();
    split.onSizesChange([0.36, 0.64]);
    split.onSizesChange([0.4, 0.6]);
    expect(split.sizes()[0]).toBe(0.4);
    expect(localStorage.getItem(KEY)).toBeNull();

    split.onHandleDragEnd();
    expect(localStorage.getItem(KEY)).toBe("0.4");
    expect(split.sizes()[0]).toBe(0.4);
  });

  it("is stored at once for a keyboard step", async () => {
    const split = await besideSplit();
    split.onSizesChange([0.35, 0.65]);
    expect(localStorage.getItem(KEY)).toBe("0.35");
  });
});

describe("an arrangement that changes inside an effect pass", () => {
  // The arrangement comes from a box measured in an effect, so the split is
  // built stacked and turned beside in the same pass: Corvu emits its stacked
  // sizes after the arrangement has changed.
  it("keeps the stored side-by-side share and stores nothing", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 1000,
      height: 600,
    } as DOMRect);
    const View = (p: { arrangement: CodeArrangement }) => {
      const split = createCodeSplit(() => p.arrangement);
      return (
        <Resizable
          orientation={split.layout().orientation}
          sizes={split.sizes()}
          onSizesChange={split.onSizesChange}
        >
          <Resizable.Panel as="div" data-testid="tree" minSize={0.1} />
          <Resizable.Handle
            onHandleDrag={split.onHandleDrag}
            onHandleDragEnd={split.onHandleDragEnd}
          />
          <Resizable.Panel as="div" minSize={0.1} />
        </Resizable>
      );
    };
    const Box = () => {
      const [box, setBox] = createSignal<HTMLDivElement>();
      const size = createElementSize(box);
      return (
        <div ref={setBox}>
          <View
            arrangement={
              size.width === null ? "stacked" : codeArrangement(size.width)
            }
          />
        </div>
      );
    };
    const stored = localStorage.getItem(KEY);
    const host = document.createElement("div");
    document.body.append(host);
    const dispose = render(() => <Box />, host);

    expect(
      host.querySelector<HTMLElement>("[data-corvu-resizable-root]")?.dataset
        .orientation,
    ).toBe("horizontal");
    expect(
      host.querySelector<HTMLElement>("[data-testid=tree]")?.style.flexBasis,
    ).toBe("20%");
    expect(localStorage.getItem(KEY)).toBe(stored);
    expect(h.setStacked).not.toHaveBeenCalled();
    dispose();
  });
});

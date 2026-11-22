/** THE CODE VIEW'S SPLIT: when the tree stands beside the file, and how the
 *  side-by-side share is read and kept on this device. */

import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codeArrangement } from "./codeSplit";

// The stacked share is the Right panel's preference, not this file's subject.
vi.mock("../right-panel/useRightPanel", () => ({
  useRightPanel: () => ({
    codeTabTreeSize: () => 0.35,
    setCodeTabTreeSize: () => {},
  }),
}));

const KEY = "kolu-code-tab-beside-tree-size";

/** A fresh module, so the share is read from storage as it stands now: the
 *  stored value is read once, when the module loads, so a static import
 *  cannot see what each test stores. */
const besideSplit = async () => {
  vi.resetModules();
  const { createCodeSplit } = await import("./codeSplit");
  return createRoot(() => createCodeSplit(() => "beside"));
};

afterEach(() => localStorage.clear());

describe("codeArrangement", () => {
  it("stands the tree beside the file from 720px, and stacks it below", () => {
    expect(codeArrangement(720)).toBe("beside");
    expect(codeArrangement(719.5)).toBe("stacked");
    expect(codeArrangement(null)).toBe("stacked");
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

/** The palette controller's close path. */

import { flush } from "solid-js";
import { expect, it, vi } from "vitest";

// The close path's other half is the guarded terminal refocus, which reaches
// the dialog stack and the terminal. Neither is what these cases are about.
// (`vi.mock` is hoisted above this import, so the controller sees the stub.)
vi.mock("./ui/ModalDialog", () => ({ refocusIfNoDialogOpen: () => {} }));

import { useCommandPalette } from "./useCommandPalette";

it("leaves the drill path alone on close — every open sets it", () => {
  const palette = useCommandPalette();

  palette.openPath(["Terminals", "zest"]);
  flush();
  expect(palette.open()).toBe(true);
  expect(palette.initialPath()).toEqual(["Terminals", "zest"]);

  // A close writes the open flag and nothing else. Resetting the path here
  // would be a second write on the edge corvu's dismiss effect and the
  // palette's own derivations read — for a value nothing reads until the next
  // open, which sets it itself.
  palette.onOpenChange(false);
  flush();
  expect(palette.open()).toBe(false);
  expect(palette.initialPath()).toEqual(["Terminals", "zest"]);

  // And every open path does set it, so the stale value is never seen: a plain
  // open lands at the root, a toggle-open too, and a group open at its group.
  palette.openDialog();
  flush();
  expect(palette.initialPath()).toEqual([]);

  palette.openGroup("Hosts");
  flush();
  expect(palette.initialPath()).toEqual(["Hosts"]);

  palette.toggle();
  flush();
  expect(palette.open()).toBe(false);
  palette.toggle();
  flush();
  expect(palette.open()).toBe(true);
  expect(palette.initialPath()).toEqual([]);
});

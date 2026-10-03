// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { registerTerminalElement } from "../terminal/terminalElements";
import { getActiveTerminalNode, getFirstTerminalNode } from "./activeTerminal";
it("refocuses the visible focused body in phone, compact and desktop layouts", () => {
  const main = document.createElement("div");
  main.dataset.visible = "";
  const split = document.createElement("div");
  split.dataset.visible = "";
  split.dataset.focused = "";
  const removeMain = registerTerminalElement("main", main);
  const removeSplit = registerTerminalElement("split", split);
  expect(getActiveTerminalNode()).toBe(split);
  delete split.dataset.visible;
  expect(getActiveTerminalNode()).toBe(main);
  removeMain();
  removeSplit();
  expect(getFirstTerminalNode()).toBeNull();
});

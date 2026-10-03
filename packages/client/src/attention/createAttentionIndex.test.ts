import { createComputed, createRoot, createSignal } from "solid-js";
import { expect, it } from "vitest";
import { createAttentionIndex } from "./createAttentionIndex";

it("only wakes terminals whose class or live membership changed", () => createRoot((dispose) => {
  const [classes, setClasses] = createSignal({ asking: ["a"], working: ["b"], finished: [], linger: [] });
  const [live, setLive] = createSignal(["a"]);
  const index = createAttentionIndex(classes, live);
  const wakes = [0, 0, 0];
  ["a", "b", "c"].forEach((id, i) => createComputed(() => { index.classOf(id); index.isLive(id); wakes[i]!++; }));
  setLive(["b"]);
  expect(wakes).toEqual([2, 2, 1]);
  setLive(["b"]);
  expect(wakes).toEqual([2, 2, 1]);
  setClasses({ asking: [], working: ["a", "b"], finished: [], linger: [] });
  expect(wakes).toEqual([3, 2, 1]);
  dispose();
}));

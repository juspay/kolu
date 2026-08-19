import { createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { createOnceMeasured } from "./onceMeasured.ts";

describe("createOnceMeasured", () => {
  it("does not fire in the same turn as registration, even when the grid is already set", () => {
    const [grid] = createSignal({ cols: 80, rows: 24 });
    let opened = 0;
    createRoot((dispose) => {
      const onceMeasured = createOnceMeasured(grid);
      onceMeasured(() => {
        opened = gate.open();
      });
      const gate = { open: () => 7 };
      expect(opened).toBe(0);
      dispose();
    });
  });

  it("fires the callback after the registering turn, with later bindings live", async () => {
    const [grid] = createSignal({ cols: 80, rows: 24 });
    let opened = 0;
    const dispose = await new Promise<() => void>((resolve) => {
      createRoot((d) => {
        const onceMeasured = createOnceMeasured(grid);
        onceMeasured(() => {
          opened = gate.open();
        });
        const gate = { open: () => 7 };
        queueMicrotask(() => resolve(d));
      });
    });
    expect(opened).toBe(7);
    dispose();
  });
});

// @vitest-environment happy-dom
/**
 * THE ROW STAYS LIVE AFTER MOUNT.
 *
 * Every other dock-row test renders once and asserts on the first paint, so all
 * of them pass against a row that has frozen. That is not hypothetical: the
 * first version of `useDockRowBag` returned a plain object of VALUES and was
 * invoked from a JSX spread, which — depending on how the spread compiles —
 * either snapshots the row at mount (the wait chip stops counting, the pip stops
 * repainting) or mints a fresh `createMemo` on every prop read. Both are
 * invisible to a render-once test.
 *
 * So this one changes a signal AFTER mount and demands the DOM follow.
 */

import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";

describe("a spread prop bag of getters stays reactive", () => {
  // The shape `useDockRowBag` returns, reduced to its load-bearing property:
  // built ONCE, fields are getters, spread onto a child.
  it("propagates a post-mount change through a spread", () => {
    const [n, setN] = createSignal(0);
    let builds = 0;
    const buildBag = () => {
      builds++;
      return {
        get label() {
          return `n=${n()}`;
        },
      };
    };
    const host = document.createElement("div");
    const dispose = render(() => {
      const bag = buildBag(); // once, as the row does
      return <span {...bag} data-testid="row" />;
    }, host);
    try {
      const el = host.querySelector('[data-testid="row"]');
      expect(el?.getAttribute("label")).toBe("n=0");
      setN(7);
      // The getter must be re-read — a value snapshot would still say n=0.
      expect(el?.getAttribute("label")).toBe("n=7");
      // And the bag itself must not be rebuilt per read: rebuilding is what
      // mints a fresh memo per read in the real row.
      expect(builds).toBe(1);
    } finally {
      dispose();
    }
  });

  it("a VALUE bag is the bug this guards — it freezes", () => {
    const [n, setN] = createSignal(0);
    const host = document.createElement("div");
    const dispose = render(() => {
      const frozen = { label: `n=${n()}` }; // the defect shape
      return <span {...frozen} data-testid="row" />;
    }, host);
    try {
      const el = host.querySelector('[data-testid="row"]');
      expect(el?.getAttribute("label")).toBe("n=0");
      setN(7);
      // Documented, not desired: this is what the row did before the fix.
      expect(el?.getAttribute("label")).toBe("n=0");
    } finally {
      dispose();
    }
  });
});

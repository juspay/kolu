// @vitest-environment happy-dom
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { describe, expect, it } from "vitest";

describe("a spread prop bag of getters stays reactive", () => {
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
      const bag = buildBag();
      return <span {...bag} data-testid="row" />;
    }, host);
    try {
      const el = host.querySelector('[data-testid="row"]');
      expect(el?.getAttribute("label")).toBe("n=0");
      setN(7);
      expect(el?.getAttribute("label")).toBe("n=7");
      expect(builds).toBe(1);
    } finally {
      dispose();
    }
  });

  it("a VALUE bag is the bug this guards — it freezes", () => {
    const [n, setN] = createSignal(0);
    const host = document.createElement("div");
    const dispose = render(() => {
      const frozen = { label: `n=${n()}` };
      return <span {...frozen} data-testid="row" />;
    }, host);
    try {
      const el = host.querySelector('[data-testid="row"]');
      expect(el?.getAttribute("label")).toBe("n=0");
      setN(7);
      expect(el?.getAttribute("label")).toBe("n=0");
    } finally {
      dispose();
    }
  });
});

// @vitest-environment happy-dom

import type { PrInfo } from "anyforge/schemas";
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import { PrPip } from "./PrPip.tsx";

function renderPip(pr: PrInfo | null) {
  const host = document.createElement("div");
  const dispose = render(() => <PrPip pr={pr} />, host);
  return { host, dispose };
}

describe("PrPip", () => {
  it("renders no PR affordance when the row has no PR", () => {
    const { host, dispose } = renderPip(null);
    try {
      expect(host.querySelector('[data-testid="dock-row-pr-pip"]')).toBeNull();
    } finally {
      dispose();
    }
  });

  it("renders a resolved PR as a real external link", () => {
    const { host, dispose } = renderPip({
      number: 42,
      title: "Keep coverage",
      state: "open",
      url: "https://example.test/pull/42",
      checks: null,
      checkRuns: [],
      reviewDecision: null,
      mergeStateStatus: "UNKNOWN",
    });
    try {
      const link = host.querySelector<HTMLAnchorElement>(
        '[data-testid="dock-row-pr-pip"]',
      );
      expect(link?.getAttribute("href")).toBe("https://example.test/pull/42");
      expect(link?.getAttribute("target")).toBe("_blank");
    } finally {
      dispose();
    }
  });
});

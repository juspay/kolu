import type { PrInfo } from "anyforge/schemas";
import { render } from "@solidjs/web";
import { describe, expect, it } from "vitest";
import { PrMarks, PrPip } from "./PrPip.tsx";

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
      headSha: null,
      isDraft: false,
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

describe("PrMarks", () => {
  const PR: PrInfo = {
    number: 7,
    title: "Keep coverage",
    state: "merged",
    url: "https://example.test/pull/7",
    checks: "fail",
    checkRuns: [],
    reviewDecision: null,
    mergeStateStatus: "UNKNOWN",
    headSha: null,
    isDraft: false,
  };

  it("draws the pip's own marks, with no link and no tooltip round them", () => {
    const pip = document.createElement("div");
    const marks = document.createElement("div");
    const disposePip = render(() => <PrPip pr={PR} />, pip);
    const disposeMarks = render(() => <PrMarks pr={PR} />, marks);
    try {
      const link = pip.querySelector("a");
      expect(marks.innerHTML).toBe(link?.innerHTML);
      expect(marks.querySelector("a")).toBeNull();
      expect(marks.querySelector("[title]")).toBeNull();
    } finally {
      disposePip();
      disposeMarks();
    }
  });
});

// @vitest-environment happy-dom

import {
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import { PrPip } from "./PrPip";

function metadata(
  pr: Extract<TerminalMetadata, { state: "active" }>["pr"],
): TerminalMetadata {
  return {
    state: "active",
    cwd: "/repo",
    git: null,
    location: LOCAL_LOCATION,
    pr,
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: 0,
  };
}

function renderPip(meta: TerminalMetadata) {
  const host = document.createElement("div");
  const dispose = render(() => <PrPip meta={meta} />, host);
  return { host, dispose };
}

describe("PrPip", () => {
  it.each([
    "pending",
    "absent",
  ] as const)("renders no PR affordance for a %s observation", (kind) => {
    const { host, dispose } = renderPip(metadata({ kind }));
    try {
      expect(host.querySelector('[data-testid="dock-row-pr-pip"]')).toBeNull();
    } finally {
      dispose();
    }
  });

  it("renders a resolved PR as a real external link", () => {
    const { host, dispose } = renderPip(
      metadata({
        kind: "ok",
        value: {
          number: 42,
          title: "Keep coverage",
          state: "open",
          url: "https://example.test/pull/42",
          checks: null,
          checkRuns: [],
          reviewDecision: null,
          mergeStateStatus: "UNKNOWN",
        },
      }),
    );
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

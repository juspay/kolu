// @vitest-environment happy-dom
/**
 * Shell split sub-entries consume the same StatePip fold as a top-level
 * DockRow — identity glyph (`#` / data-glyph="shell") and unread passthrough.
 * Kind never re-gates either axis.
 */

import { LOCAL_LOCATION, type TerminalMetadata } from "@kolu/padi/surface";
import type { TerminalId } from "kolu-common/surface";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PARENT = "parent-tile" as TerminalId;
const SPLIT = "shell-split" as TerminalId;

const bag = vi.hoisted(() => ({
  unread: false as boolean,
  meta: null as TerminalMetadata | null,
}));

vi.mock("../../wire", () => ({
  encActiveHost: () => "local",
}));

vi.mock("../../attention/useAttentionFacts", () => ({
  useAttentionFacts: () => ({
    attentionOf: () => ({ klass: "idle" as const, live: false }),
  }),
}));

vi.mock("../../tile/useTileStore", () => ({
  useTileStore: () => ({
    isActiveTile: () => false,
    isFocused: () => false,
  }),
}));

vi.mock("../../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    getMetadata: (id: TerminalId) =>
      id === SPLIT ? (bag.meta ?? undefined) : undefined,
    isUnread: (id: TerminalId) => id === SPLIT && bag.unread,
  }),
}));

const { SubTerminalRow } = await import("./SubTerminalRow");

function shellMeta(): TerminalMetadata {
  return {
    state: "active",
    cwd: "/tmp/work",
    git: null,
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: 1,
    parentId: PARENT,
  };
}

/** Ranked shell sub-row — pip fact from the ranking fold (same as top-level). */
function shellRankedRow() {
  return {
    id: SPLIT,
    depth: 1,
    kind: "shell" as const,
    bucket: "idle" as const,
    pip: "idle" as const,
    ts: 1,
  };
}

function renderSubRow() {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () => (
      <SubTerminalRow
        row={shellRankedRow()}
        surface="desktop"
        onSelect={() => {}}
      />
    ),
    host,
  );
  return {
    host,
    dispose: () => {
      dispose();
      host.remove();
    },
  };
}

beforeEach(() => {
  bag.unread = false;
  bag.meta = shellMeta();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("SubTerminalRow — shell split consumes the shared StatePip fold", () => {
  it("renders the shell identity glyph on a plain-shell sub-entry", () => {
    const { host, dispose } = renderSubRow();
    try {
      const row = host.querySelector('[data-testid="dock-sub-row"]');
      expect(row).not.toBeNull();
      const pip = row?.querySelector('[data-testid="state-pip"]');
      expect(
        pip,
        "shell sub-entry must render StatePip like a top-level row",
      ).not.toBeNull();
      expect(pip?.getAttribute("data-glyph")).toBe("shell");
      expect(pip?.getAttribute("data-pip")).toBe("idle");
      // Shell cannot ask — no attention wash attribute.
      expect(row?.hasAttribute("data-asking")).toBe(false);
    } finally {
      dispose();
    }
  });

  it("passes unread through on a shell sub-entry (same as top-level shells)", () => {
    bag.unread = true;
    const { host, dispose } = renderSubRow();
    try {
      const row = host.querySelector('[data-testid="dock-sub-row"]');
      expect(row).not.toBeNull();
      expect(
        row?.hasAttribute("data-unread"),
        "shell sub-entry must not force unread false",
      ).toBe(true);
      // Alert badge rides the shared StatePip fold when unread is true.
      const pip = row?.querySelector('[data-testid="state-pip"]');
      expect(pip?.hasAttribute("data-alert")).toBe(true);
    } finally {
      dispose();
    }
  });
});

// @vitest-environment happy-dom

import {
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import type { AgentInfo } from "kolu-common/surface";
import type { TerminalId } from "kolu-common/surface";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PARENT = "parent-tile" as TerminalId;
const SPLIT = "shell-split" as TerminalId;

const bag = vi.hoisted(() => ({
  unread: false as boolean,
  meta: null as TerminalMetadata | null,
  info: {
    repoColor: "#0ea5e9",
    annotationColor: "#b45309",
    subCount: 1,
    key: { group: "kolu", label: "feat-x" },
  } as TerminalDisplayInfo | null,
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
      id === SPLIT || id === PARENT ? (bag.meta ?? undefined) : undefined,
    getDisplayInfo: (id: TerminalId) => (id === PARENT ? bag.info : undefined),
    isUnread: (id: TerminalId) => id === SPLIT && bag.unread,
  }),
}));

const { SubTerminalRow } = await import("./SubTerminalRow");

function splitMeta(agent: AgentInfo | null = null): TerminalMetadata {
  return {
    state: "active",
    cwd: "/tmp/work",
    git: { kind: "none" },
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: 1,
    promptedAt: null,
    parentId: PARENT,
  };
}

function shellRankedRow() {
  return {
    id: SPLIT,
    parentId: PARENT,
    kind: "shell" as const,
    bucket: "idle" as const,
    pip: "idle" as const,
    asking: false,
    ts: 1,
    depth: 1,
  };
}

function renderSubRow() {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () => (
      <SubTerminalRow
        row={shellRankedRow()}
        tileId={PARENT}
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
  bag.meta = splitMeta();
  bag.info = {
    repoColor: "#0ea5e9",
    annotationColor: "#b45309",
    subCount: 1,
    key: { group: "kolu", label: "feat-x" },
  };
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
      const pip = row?.querySelector('[data-testid="state-pip"]');
      expect(pip?.hasAttribute("data-alert")).toBe(true);
    } finally {
      dispose();
    }
  });

  it("renders the split agent's session model from its own record", () => {
    bag.meta = splitMeta({
      kind: "claude-code",
      state: "tool_use",
      sessionId: "split-session",
      model: "claude-opus-4-6",
      summary: null,
      taskProgress: null,
      workflow: null,
      contextTokens: null,
      startedAt: 1,
    });
    const { host, dispose } = renderSubRow();
    try {
      const row = host.querySelector('[data-testid="dock-sub-row"]');
      expect(row?.querySelector("[data-dock-model]")?.textContent).toBe(
        "claude-opus-4-6",
      );
    } finally {
      dispose();
    }
  });

  it("draws no model tag on a plain-shell split", () => {
    const { host, dispose } = renderSubRow();
    try {
      const row = host.querySelector('[data-testid="dock-sub-row"]');
      expect(row).not.toBeNull();
      expect(row?.querySelector("[data-dock-model]")).toBeNull();
    } finally {
      dispose();
    }
  });

  it("paints the split's label with the tile's branch ink", () => {
    const { host, dispose } = renderSubRow();
    try {
      const label = host.querySelector(".dock-cards-row-label") as HTMLElement;
      expect(label.style.color).toBe("#b45309");
    } finally {
      dispose();
    }
  });

  it("falls back to the dock's quiet ink when the tile has no display row yet", () => {
    bag.info = null;
    const { host, dispose } = renderSubRow();
    try {
      const label = host.querySelector(".dock-cards-row-label") as HTMLElement;
      expect(label.style.color).toBe("");
      expect(label.className).toContain("text-fg-2");
    } finally {
      dispose();
    }
  });
});

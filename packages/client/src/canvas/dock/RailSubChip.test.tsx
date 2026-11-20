// @vitest-environment happy-dom
import {
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PARENT = "parent-tile" as TerminalId;
const SPLIT = "shell-split-rail" as TerminalId;

const bag = vi.hoisted(() => ({
  unread: false as boolean,
  meta: null as TerminalMetadata | null,
  focused: null as TerminalId | null,
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
    focusedTerminalId: () => bag.focused,
  }),
}));

vi.mock("./useDockFocus", () => ({
  useDockFocus: () => () => {},
}));

vi.mock("./useDockReparent", () => ({
  useDockReparent: () => () => {},
}));

const { RailSubChip } = await import("./Dock");

function shellMeta(): TerminalMetadata {
  return {
    state: "active",
    cwd: "/tmp/work",
    git: { kind: "none" },
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: null,
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

function renderChip() {
  const host = document.createElement("div");
  document.body.append(host);
  const dispose = render(
    () => <RailSubChip row={shellRankedRow()} repoColor="oklch(50% 0.1 100)" />,
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
  bag.focused = null;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("RailSubChip — shell split shares the StatePip fold", () => {
  it("emits paint bucket and still motion from the ranked pip fact", () => {
    const { host, dispose } = renderChip();
    try {
      const chip = host.querySelector('[data-testid="dock-rail-sub"]');
      expect(chip).not.toBeNull();
      expect(chip?.getAttribute("data-bucket")).toBe("idle");
      expect(chip?.getAttribute("data-motion")).toBe("none");
      expect(chip?.className).not.toMatch(/opacity-70/);
    } finally {
      dispose();
    }
  });

  it("passes unread through on a shell rail sub-chip", () => {
    bag.unread = true;
    const { host, dispose } = renderChip();
    try {
      const chip = host.querySelector('[data-testid="dock-rail-sub"]');
      expect(chip?.hasAttribute("data-unread")).toBe(true);
    } finally {
      dispose();
    }
  });
});

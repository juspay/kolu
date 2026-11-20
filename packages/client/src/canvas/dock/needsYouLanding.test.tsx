// @vitest-environment happy-dom

import { createSignal } from "solid-js";

import {
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PARENT = "parent-tile" as TerminalId;
const SPLIT = "blocked-split" as TerminalId;

const bag = vi.hoisted(() => ({ selected: [] as TerminalId[] }));

vi.mock("../../wire", () => ({ encActiveHost: () => "local" }));

vi.mock("../../attention/useAttentionFacts", () => ({
  useAttentionFacts: () => ({
    attentionOf: (_host: string, id: TerminalId) => ({
      klass: id === SPLIT ? ("asking" as const) : ("idle" as const),
      live: false,
    }),
  }),
}));

vi.mock("../../tile/useTileStore", () => ({
  useTileStore: () => ({ isActiveTile: () => false, isFocused: () => false }),
}));

function metaFor(id: TerminalId): TerminalMetadata {
  return {
    state: "active",
    cwd: "/tmp/work",
    git: { kind: "none" },
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent:
      id === SPLIT
        ? {
            kind: "claude-code",
            state: "awaiting_user",
            sessionId: null,
            startedAt: 0,
            summary: null,
          }
        : null,
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: 1,
    ...(id === SPLIT ? { parentId: PARENT } : {}),
  } as TerminalMetadata;
}

vi.mock("../../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    getMetadata: (id: TerminalId) => metaFor(id),
    getDisplayInfo: (id: TerminalId) =>
      id === PARENT
        ? {
            repoColor: "#aaa",
            annotationColor: "#aaa",
            subCount: 1,
            key: { group: "kolu", label: "feat-x" },
          }
        : undefined,
    isUnread: () => false,
  }),
}));

const { NeedsYouStrip } = await import("./NeedsYouStrip");

function tileRow() {
  return {
    id: PARENT,
    bucket: "idle" as const,
    pip: "idle" as const,
    asking: false,
    ts: 9_000,
    subRows: [],
  };
}

function blockedSplitRow() {
  return {
    id: SPLIT,
    parentId: PARENT,
    kind: "agent" as const,
    bucket: "awaiting" as const,
    pip: "awaiting" as const,
    asking: true,
    ts: 5,
    depth: 1,
  };
}

function renderStrip() {
  const host = document.createElement("div");
  document.body.append(host);
  const [revision, setRevision] = createSignal(0);
  const dispose = render(
    () => (
      <NeedsYouStrip
        entries={[
          {
            tile: tileRow(),
            blocked: blockedSplitRow(),
            hiddenByFilter: revision() > 0,
          },
        ]}
        density="full"
        onSelect={(id) => bag.selected.push(id)}
      />
    ),
    host,
  );
  return {
    host,
    update: () => setRevision((n) => n + 1),
    dispose: () => {
      dispose();
      host.remove();
    },
  };
}

beforeEach(() => {
  bag.selected = [];
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("NeedsYouStrip — the split-blocked entry", () => {
  it("renders at all when the blocked agent is a split", () => {
    const { host, dispose } = renderStrip();
    try {
      expect(
        host.querySelector('[data-testid="dock-needs-you-entry"]'),
        "a split-blocked tile must produce a strip entry",
      ).not.toBeNull();
      const pip = host.querySelector('[data-testid="state-pip"]');
      expect(pip?.getAttribute("data-pip")).toBe("awaiting");
      const entry = host.querySelector('[data-testid="dock-needs-you-entry"]');
      expect(entry?.getAttribute("data-tile-id")).toBe(PARENT);
    } finally {
      dispose();
    }
  });

  it("selects the SPLIT that is asking, not the tile that holds it", () => {
    const { host, dispose } = renderStrip();
    try {
      const entry = host.querySelector<HTMLElement>(
        '[data-testid="dock-needs-you-entry"]',
      );
      expect(entry).not.toBeNull();
      entry?.click();
      expect(bag.selected).toEqual([SPLIT]);
    } finally {
      dispose();
    }
  });

  it("still names the tile it belongs to, so the two ids stay distinguishable", () => {
    const { host, dispose } = renderStrip();
    try {
      const entry = host.querySelector<HTMLElement>(
        '[data-testid="dock-needs-you-entry"]',
      );
      expect(entry?.getAttribute("data-terminal-id")).toBe(SPLIT);
      expect(entry?.getAttribute("data-tile-id")).toBe(PARENT);
      expect(entry?.hasAttribute("data-asking")).toBe(true);
    } finally {
      dispose();
    }
  });
});

it("retains the blocked row DOM across fresh ranked records", () => {
  const { host, update, dispose } = renderStrip();
  try {
    const row = host.querySelector('[data-testid="dock-needs-you-entry"]');
    update();
    expect(host.querySelector('[data-testid="dock-needs-you-entry"]')).toBe(
      row,
    );
  } finally {
    dispose();
  }
});

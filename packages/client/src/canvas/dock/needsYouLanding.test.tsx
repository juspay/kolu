// @vitest-environment happy-dom
/**
 * The needs-you strip must NAVIGATE to the row it NAMES.
 *
 * When a split is the agent blocked on you, the entry paints that split's pip
 * and that split's wait — but the tile it belongs to is what has a dock row.
 * Clicking must land on the SPLIT: the desktop verb for a tile
 * (`tileStore.activate` → `focusMainTerminal`) focuses the parent's MAIN pane
 * and throws outright on a split id, so handing it the tile would send you to a
 * pane that is not waiting. The strip would then name one agent and go to
 * another — the same lie as painting the wrong clock, which the tile/blocked
 * split was introduced to end.
 *
 * `SubTerminalRow` and the section header's asking capsule both land through
 * `useDockFocus` → `focusTerminal`, which resolves a split to its tab. This pins
 * that the strip passes the id that makes those verbs correct.
 */

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
    git: null,
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
    // FAITHFUL to the real store: `displayInfos` is keyed on `terminalIds()`,
    // which is TOP-LEVEL tiles, so a split has NO display info. Mocking this to
    // answer for every id is what hid the defect this file now guards — the
    // entry asked `createDockRowData(split)` for a display row, got `null`, and
    // rendered nothing at all for the one case the tile/blocked pair exists for.
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
  const dispose = render(
    () => (
      <NeedsYouStrip
        entries={[
          {
            tile: tileRow(),
            blocked: blockedSplitRow(),
            hiddenByFilter: false,
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
  // The entry must EXIST before anything about it can be right. A split has no
  // display info of its own, so an entry that demanded one for its blocked half
  // rendered nothing — the strip dropping the very case it was built for, in
  // the real app, while every unit test passed.
  it("renders at all when the blocked agent is a split", () => {
    const { host, dispose } = renderStrip();
    try {
      expect(
        host.querySelector('[data-testid="dock-needs-you-entry"]'),
        "a split-blocked tile must produce a strip entry",
      ).not.toBeNull();
      // And it is the SPLIT's attention that got painted…
      const pip = host.querySelector('[data-testid="state-pip"]');
      expect(pip?.getAttribute("data-pip")).toBe("awaiting");
      // …while the display identity still came off the TILE, which is the only
      // half that has one. (The label's own text is `IntentMarkdownInline`'s
      // business; `data-tile-id` is this component's assertion to make.)
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
      // Passing PARENT here is what sent you to a pane that was not waiting.
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
      // `data-terminal-id` is the row the pip and the wait come off (the
      // blocked split); `data-tile-id` is the tile it lives in. A surface that
      // collapsed them could not paint one and land on the other.
      expect(entry?.getAttribute("data-terminal-id")).toBe(SPLIT);
      expect(entry?.getAttribute("data-tile-id")).toBe(PARENT);
      expect(entry?.hasAttribute("data-asking")).toBe(true);
    } finally {
      dispose();
    }
  });
});

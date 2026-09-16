// @vitest-environment happy-dom

/** The SPLIT sub-entry's model tag — the same trailing metal the two-line row
 *  wears, on a row that has no second line to spend.
 *
 *  A split is where a different model most often hides (a second agent beside
 *  its parent's), so this pins the two consumer-observable promises: a record
 *  that names a model draws it beside the label, and one that names none draws
 *  nothing (never an empty slot, never an "unknown"). */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import { DockSubRow, type DockSubRowProps } from "./DockSubRow.tsx";

function rowProps(overrides: Partial<DockSubRowProps> = {}): DockSubRowProps {
  return {
    id: "split-1" as TerminalId,
    parentId: "tile-1" as TerminalId,
    depth: 1,
    surface: "desktop" as const,
    pip: {
      variant: "working" as const,
      glyph: "claude-code" as const,
      motion: "spin" as const,
      active: true,
      asking: false,
      bytesLive: true,
      shellLive: false,
      sleeping: false,
      alert: false,
      alertLabel: "Unread",
    },
    bucket: "working" as const,
    agentState: "tool_use",
    model: "claude-opus-4-6",
    label: "flicker-fix",
    renderLabel: (markdown: string) => markdown,
    onSelect: () => {},
    ...overrides,
  };
}

function renderRow(props: ReturnType<typeof rowProps>) {
  const host = document.createElement("div");
  const dispose = render(() => <DockSubRow {...props} />, host);
  return { host, dispose };
}

const modelTag = (host: HTMLElement) => host.querySelector("[data-dock-model]");

describe("DockSubRow's model tag", () => {
  it("renders the model beside the split's label", () => {
    const { host, dispose } = renderRow(rowProps());
    try {
      expect(modelTag(host)?.textContent).toBe("claude-opus-4-6");
      // Both on the one line: the label is still there beside the tag.
      expect(host.querySelector("[data-dock-row]")?.textContent).toContain(
        "flicker-fix",
      );
    } finally {
      dispose();
    }
  });

  it("keeps the whole name reachable when the slot ellipsises", () => {
    const { host, dispose } = renderRow(
      rowProps({ model: "anthropic/claude-sonnet-4-5-20250929" }),
    );
    try {
      expect(modelTag(host)?.getAttribute("title")).toBe(
        "anthropic/claude-sonnet-4-5-20250929",
      );
    } finally {
      dispose();
    }
  });

  it("draws nothing on a split whose agent has named no model", () => {
    const { host, dispose } = renderRow(
      rowProps({ model: undefined, agentState: undefined }),
    );
    try {
      expect(modelTag(host)).toBeNull();
      expect(host.textContent).toContain("flicker-fix");
    } finally {
      dispose();
    }
  });
});

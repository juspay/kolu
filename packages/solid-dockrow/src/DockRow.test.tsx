// @vitest-environment happy-dom

/** The row's MODEL tag — line 2's trailing "on what", beside the status words'
 *  "doing what".
 *
 *  The facts the row is fed come from `dockRowFacts` in production, but what a
 *  consumer observes is what the row RENDERS, so this drives the component with
 *  the props a row is handed. Three promises are worth pinning, and they are the
 *  three ways this could silently be wrong: the name shows up at all; it does
 *  not displace the words it sits beside; and an agent that has not pinned a
 *  model draws nothing rather than an "unknown". */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import { DockRow, type DockRowProps } from "./DockRow.tsx";

/** A working agent row as the dock wires it. `surface="desktop"` only picks the
 *  text sizes; nothing here reads them. */
function rowProps(overrides: Partial<DockRowProps> = {}): DockRowProps {
  return {
    id: "t1" as TerminalId,
    surface: "desktop",
    pip: {
      variant: "working",
      glyph: "claude-code",
      motion: "spin",
      active: true,
      asking: false,
      bytesLive: true,
      shellLive: false,
      sleeping: false,
      alert: false,
      alertLabel: "Unread",
    },
    bucket: "working",
    agentState: "thinking",
    model: "claude-opus-4-6",
    label: "main",
    labelColor: "oklch(0.7 0.05 200)",
    renderLabel: (markdown) => markdown,
    subline: { text: "Running tools", fromAgent: true },
    pr: null,
    recency: { mode: "hidden" },
    onSelect: () => {},
    ...overrides,
  };
}

function renderRow(props: DockRowProps) {
  const host = document.createElement("div");
  const dispose = render(() => <DockRow {...props} />, host);
  return { host, dispose };
}

const modelTag = (host: HTMLElement) => host.querySelector("[data-dock-model]");
const subline = (host: HTMLElement) =>
  host.querySelector("[data-dock-subline]")?.textContent;

describe("DockRow's model tag", () => {
  it("names the model beside the status words, not instead of them", () => {
    const { host, dispose } = renderRow(rowProps());
    try {
      expect(modelTag(host)?.textContent).toBe("claude-opus-4-6");
      expect(subline(host)).toBe("Running tools");
    } finally {
      dispose();
    }
  });

  it("keeps the whole name reachable when the slot ellipsises", () => {
    // The tag caps its width so a long pinned id cannot push the words out, so
    // the full name has to survive somewhere: the tooltip is that somewhere.
    const { host, dispose } = renderRow(
      rowProps({ model: "claude-sonnet-4-5-20250929" }),
    );
    try {
      expect(modelTag(host)?.getAttribute("title")).toBe(
        "claude-sonnet-4-5-20250929",
      );
    } finally {
      dispose();
    }
  });

  it("draws nothing when the agent has not pinned a model", () => {
    const { host, dispose } = renderRow(
      rowProps({
        model: undefined,
        subline: { text: "Awaiting input", fromAgent: true },
      }),
    );
    try {
      expect(modelTag(host)).toBeNull();
      expect(subline(host)).toBe("Awaiting input");
    } finally {
      dispose();
    }
  });
});

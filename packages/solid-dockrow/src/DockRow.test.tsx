// @vitest-environment happy-dom

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import { DockRow, type DockRowProps } from "./DockRow.tsx";

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
  it("renders the model tag alongside the status words", () => {
    const { host, dispose } = renderRow(rowProps());
    try {
      expect(modelTag(host)?.textContent).toBe("claude-opus-4-6");
      expect(subline(host)).toBe("Running tools");
    } finally {
      dispose();
    }
  });

  it("keeps the whole name reachable when the slot ellipsises", () => {
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

describe("DockRow's tree contract", () => {
  const rowEl = (host: HTMLElement) =>
    host.querySelector("[data-dock-row]") as HTMLElement;

  it("stamps the nest, indents the row and draws its marker on a split's row", () => {
    const { host, dispose } = renderRow(
      rowProps({ parentId: "tile-1" as TerminalId, depth: 2 }),
    );
    try {
      expect(rowEl(host).getAttribute("data-parent-id")).toBe("tile-1");
      expect(rowEl(host).getAttribute("data-depth")).toBe("2");
      expect(rowEl(host).style.paddingLeft).toBe("calc(0.75rem + 2rem)");
      expect(rowEl(host).textContent).toContain("└");
      expect(subline(host)).toBe("Running tools");
      expect(modelTag(host)?.textContent).toBe("claude-opus-4-6");
    } finally {
      dispose();
    }
  });

  it("leaves a top-level row unmarked and unindented", () => {
    const { host, dispose } = renderRow(rowProps());
    try {
      expect(rowEl(host).hasAttribute("data-depth")).toBe(false);
      expect(rowEl(host).hasAttribute("data-parent-id")).toBe(false);
      expect(rowEl(host).textContent).not.toContain("└");
      expect(rowEl(host).style.paddingLeft).toBe("");
      expect(rowEl(host).className).toContain("grid-cols-subgrid");
    } finally {
      dispose();
    }
  });

  it("paints a label with no ink in the dock's quiet ink, not the inherited default", () => {
    const { host, dispose } = renderRow(rowProps({ labelColor: undefined }));
    try {
      const label = host.querySelector(".dock-cards-row-label") as HTMLElement;
      expect(label.style.color).toBe("");
      expect(label.className).toContain("text-fg-2");
    } finally {
      dispose();
    }
  });
});

describe("DockRow's drag sockets", () => {
  const rowEl = (host: HTMLElement) =>
    host.querySelector("[data-dock-row]") as HTMLElement;
  const gripEl = (host: HTMLElement) =>
    host.querySelector("[data-testid='dock-row-grip']") as HTMLElement | null;

  it("renders no grip without a handle, and a labelled one when wired", () => {
    const bare = renderRow(rowProps());
    try {
      expect(gripEl(bare.host)).toBeNull();
    } finally {
      bare.dispose();
    }

    const wired = renderRow(rowProps({ handle: { onpointerdown: () => {} } }));
    try {
      const grip = gripEl(wired.host);
      expect(grip).not.toBeNull();
      expect(grip?.getAttribute("aria-label")).toBe(
        "Drag to nest this terminal",
      );
    } finally {
      wired.dispose();
    }
  });

  it("keeps a grip pointerdown from reaching an ancestor listener", () => {
    // Both handlers here are Solid DELEGATED ones (the wrapper's, and the
    // grip's own). A native listener on an ancestor would fire before the
    // document-level delegated dispatch even walks the path, so it could not
    // observe the stop. The host is attached to the document for the same
    // reason — a detached tree never reaches the delegated listener at all.
    let gripFired = 0;
    let ancestorFired = 0;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const dispose = render(
      () => (
        <div
          onPointerDown={() => {
            ancestorFired += 1;
          }}
        >
          <DockRow
            {...rowProps({
              handle: {
                onpointerdown: () => {
                  gripFired += 1;
                },
              },
            })}
          />
        </div>
      ),
      host,
    );
    try {
      const grip = gripEl(host);
      expect(grip).not.toBeNull();
      grip?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      expect(gripFired).toBe(1);
      expect(ancestorFired).toBe(0);
    } finally {
      dispose();
      host.remove();
    }
  });

  it("stamps the drop verdict, and omits the attribute with no drop", () => {
    const over = renderRow(rowProps({ drop: "over" }));
    try {
      expect(rowEl(over.host).getAttribute("data-drop")).toBe("over");
    } finally {
      over.dispose();
    }

    const invalid = renderRow(rowProps({ drop: "invalid" }));
    try {
      expect(rowEl(invalid.host).getAttribute("data-drop")).toBe("invalid");
    } finally {
      invalid.dispose();
    }

    const neither = renderRow(rowProps());
    try {
      expect(rowEl(neither.host).hasAttribute("data-drop")).toBe(false);
    } finally {
      neither.dispose();
    }
  });
});

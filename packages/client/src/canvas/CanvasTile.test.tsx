// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@thisbeyond/solid-dnd", () => ({
  createDraggable: () => ({
    ref: () => undefined,
    dragActivators: {},
    transform: { x: 0, y: 0 },
  }),
}));

vi.mock("./viewport/animatedCamera", () => ({
  prefersReducedMotion: () => true,
}));

import { render } from "solid-js/web";
import CanvasTile from "./CanvasTile";

describe("CanvasTile shell selection", () => {
  let host: HTMLDivElement;
  let dispose: (() => void) | undefined;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
  });

  afterEach(() => {
    dispose?.();
    dispose = undefined;
    document.body.replaceChildren();
  });

  it("leaves pane selection to a live terminal but selects from tile chrome", () => {
    const onSelect = vi.fn();
    dispose = render(
      () => (
        <CanvasTile
          id="tile"
          active
          theme={{ bg: "black", fg: "white" }}
          repoColor="white"
          onSelect={onSelect}
          onClose={vi.fn()}
          onToggleFocus={vi.fn()}
          renderTitle={() => <span>Tile</span>}
          renderBody={() => (
            <div data-visible="" data-terminal-id="inner-terminal">
              <button type="button" data-testid="pane-content">
                terminal
              </button>
            </div>
          )}
          layouts={{ tile: { x: 0, y: 0, w: 100, h: 100 } }}
          startResize={vi.fn()}
          panX={() => 0}
          panY={() => 0}
          zoom={() => 1}
          viewportSize={() => ({ width: 500, height: 500 })}
        />
      ),
      host,
    );

    const paneContent = host.querySelector<HTMLElement>(
      "[data-testid=pane-content]",
    );
    const titlebar = host.querySelector<HTMLElement>(
      "[data-testid=canvas-tile-titlebar]",
    );
    expect(paneContent).not.toBeNull();
    expect(titlebar).not.toBeNull();
    expect(
      host
        .querySelector("[data-testid=canvas-tile]")
        ?.getAttribute("data-active"),
    ).toBe("");

    paneContent?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onSelect).not.toHaveBeenCalled();

    titlebar?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onSelect).toHaveBeenCalledOnce();
  });
});

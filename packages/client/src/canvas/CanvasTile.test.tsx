// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@thisbeyond/solid-dnd", () => ({
  createDraggable: () => ({
    ref: () => undefined,
    dragActivators: {},
    transform: { x: 0, y: 0 },
  }),
}));

vi.mock("./viewport/animatedPan", () => ({
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
          mode="tiled"
          theme={{ bg: "black", fg: "white" }}
          repoColor="white"
          onSelect={onSelect}
          onClose={vi.fn()}
          onToggleMaximize={vi.fn()}
          renderTitle={() => <span>Tile</span>}
          renderBody={() => (
            <div data-visible="" data-terminal-id="inner-terminal">
              <button type="button" data-testid="pane-content">
                terminal
              </button>
            </div>
          )}
          getLayout={() => ({ x: 0, y: 0, w: 100, h: 100 })}
          startResize={vi.fn()}
          panX={() => 0}
          panY={() => 0}
          zoom={() => 1}
          viewportSize={() => ({ width: 500, height: 500 })}
          viewShown={() => true}
          cameraSettled={() => true}
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

  it("puts the bar between the title bar and the body, in the clip shell", () => {
    dispose = render(
      () => (
        <CanvasTile
          id="tile"
          active
          mode="tiled"
          theme={{ bg: "black", fg: "white" }}
          repoColor="white"
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onToggleMaximize={vi.fn()}
          renderTitle={() => <span>Tile</span>}
          renderBar={() => <div data-testid="bar" />}
          renderBody={() => <div data-testid="body" />}
          getLayout={() => ({ x: 0, y: 0, w: 100, h: 100 })}
          startResize={vi.fn()}
          panX={() => 0}
          panY={() => 0}
          zoom={() => 1}
          viewportSize={() => ({ width: 500, height: 500 })}
          viewShown={() => true}
          cameraSettled={() => true}
        />
      ),
      host,
    );
    const titlebar = host.querySelector("[data-testid=canvas-tile-titlebar]");
    const bar = host.querySelector("[data-testid=bar]");
    const body = host.querySelector("[data-testid=body]");
    expect(titlebar?.nextElementSibling).toBe(bar);
    expect(bar?.nextElementSibling).toBe(body);
  });

  it("tells a covered tile it is still attached but has no decided box", () => {
    // The two facts a tile states about its body, and the whole of kolu#2362
    // §3: a tile parked behind a maximized sibling keeps its feed (a reader's
    // place in the output survives the trip) and states NO size, because the
    // canvas is not laying it out — it is holding it.
    const answers: Array<{ seen: boolean; boxDecided: boolean }> = [];
    dispose = render(
      () => (
        <CanvasTile
          id="tile"
          active={false}
          mode="covered"
          theme={{ bg: "black", fg: "white" }}
          repoColor="white"
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onToggleMaximize={vi.fn()}
          renderTitle={() => <span>Tile</span>}
          renderBody={(seen, boxDecided) => {
            answers.push({ seen: seen(), boxDecided: boxDecided() });
            return <div data-testid="body" />;
          }}
          getLayout={() => ({ x: 10, y: 20, w: 100, h: 100 })}
          startResize={vi.fn()}
          panX={() => 0}
          panY={() => 0}
          zoom={() => 1}
          viewportSize={() => ({ width: 500, height: 500 })}
          viewShown={() => true}
          cameraSettled={() => true}
        />
      ),
      host,
    );

    expect(answers).toEqual([{ seen: false, boxDecided: false }]);
    const tile = host.querySelector<HTMLElement>("[data-testid=canvas-tile]");
    // And its box is its OWN rect, not the maximized tile's: there is nothing
    // to measure differently when the posture ends.
    expect(tile?.style.visibility).toBe("hidden");
    expect(tile?.style.left).toBe("10px");
    expect(tile?.style.width).toBe("100px");
  });

  it("tells a tiled tile its box is decided", () => {
    const answers: boolean[] = [];
    dispose = render(
      () => (
        <CanvasTile
          id="tile"
          active
          mode="tiled"
          theme={{ bg: "black", fg: "white" }}
          repoColor="white"
          onSelect={vi.fn()}
          onClose={vi.fn()}
          onToggleMaximize={vi.fn()}
          renderTitle={() => <span>Tile</span>}
          renderBody={(_seen, boxDecided) => {
            answers.push(boxDecided());
            return <div data-testid="body" />;
          }}
          getLayout={() => ({ x: 0, y: 0, w: 100, h: 100 })}
          startResize={vi.fn()}
          panX={() => 0}
          panY={() => 0}
          zoom={() => 1}
          viewportSize={() => ({ width: 500, height: 500 })}
          viewShown={() => true}
          cameraSettled={() => true}
        />
      ),
      host,
    );

    expect(answers).toEqual([true]);
  });
});

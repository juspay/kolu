// @vitest-environment happy-dom
import { render } from "solid-js/web";
import { expect, it, vi } from "vitest";
const camera = vi.hoisted(() => ({
  setPanX: vi.fn(),
  setPanY: vi.fn(),
  setZoom: vi.fn(),
}));
vi.mock("../../hostScope/hostScopes", () => ({
  activeScope: () => ({
    camera: { panX: () => 0, panY: () => 0, zoom: () => 1, ...camera },
  }),
}));
vi.mock("./gestures", () => ({ installGestures: () => () => {} }));
import { useCanvasViewport } from "./useCanvasViewport";
it("waits for laid-out dimensions, uses them for centering and zoom, and releases the observer", () => {
  let width = 600;
  let disconnected = 0;
  let notify!: ResizeObserverCallback;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        notify = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {
        disconnected++;
      }
    },
  );
  const measure = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      return DOMRect.fromRect({
        width: this.isConnected ? width : 0,
        height: this.isConnected ? 400 : 0,
      });
    });
  const host = document.createElement("div");
  document.body.append(host);
  const viewport = useCanvasViewport();
  const dispose = render(
    () => <div ref={(el) => viewport.setContainerRef(el)} />,
    host,
  );
  try {
    // Insertion alone is not readiness: the split panels can still be sizing.
    expect(viewport.mounted()).toBe(false);
    expect(viewport.viewportCenter()).toBeNull();
    expect(() => viewport.viewportSize()).toThrow("first measurement");
    notify(
      [
        {
          target: host.firstElementChild,
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
          contentRect: DOMRect.fromRect({ width, height: 400 }),
        } as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    );
    expect(viewport.viewportSize()).toEqual({ width: 600, height: 400 });
    expect(viewport.viewportCenter()).toEqual({ x: 300, y: 200 });
    width = 800;
    notify(
      [
        {
          target: host.firstElementChild,
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
          contentRect: DOMRect.fromRect({ width, height: 400 }),
        } as ResizeObserverEntry,
      ],
      {} as ResizeObserver,
    );
    expect(viewport.viewportSize().width).toBe(800);
    expect(viewport.viewportCenter()).toEqual({ x: 400, y: 200 });
    viewport.zoomIn();
    expect(camera.setPanX).toHaveBeenLastCalledWith(expect.any(Number));
    // clientWidth is zero in this DOM; a second direct read would keep pan at 0.
    expect(camera.setPanX.mock.lastCall?.[0]).not.toBe(0);
  } finally {
    dispose();
    measure.mockRestore();
    vi.unstubAllGlobals();
    host.remove();
  }
  expect(disconnected).toBe(1);
  expect(viewport.mounted()).toBe(false);
});

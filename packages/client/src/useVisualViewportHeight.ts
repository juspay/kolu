import { makeEventListener } from "@solid-primitives/event-listener";

export function useVisualViewportHeight(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const sync = () => {
    const layoutHeight = Math.round(vv.height * vv.scale * 100) / 100;
    document.documentElement.style.setProperty("--app-h", `${layoutHeight}px`);
  };
  sync();
  makeEventListener(vv, "resize", sync);
}

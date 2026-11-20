import { makeEventListener } from "@solid-primitives/event-listener";

export function refitOnTabVisible(
  debouncedFit: () => void,
  isVisible?: () => boolean,
) {
  makeEventListener(document, "visibilitychange", () => {
    if (!document.hidden && (isVisible?.() ?? true)) debouncedFit();
  });
}

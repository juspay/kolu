import type { Locator } from "playwright";
import { pollFor } from "./poll.ts";
import { HYDRATION_TIMEOUT } from "./world.ts";

type DiagramState = {
  figures: number;
  painted: number;
  errors: string[];
};

function diagramState(scope: Locator): Promise<DiagramState | null> {
  return scope
    .evaluate(
      (root) => {
        const imgs = Array.from(
          root.querySelectorAll<HTMLImageElement>(
            "figure[data-md-diagram] img",
          ),
        );
        return {
          figures: root.querySelectorAll("figure[data-md-diagram]").length,
          painted: imgs.filter(
            (img) =>
              getComputedStyle(img).display !== "none" &&
              img.complete &&
              img.naturalWidth > 0,
          ).length,
          errors: Array.from(
            root.querySelectorAll("[data-md-diagram-error]"),
            (el) => el.textContent ?? "",
          ),
        };
      },
      undefined,
      { timeout: 1_000 },
    )
    .catch(() => null);
}

export async function waitForPaintedDiagram(
  scope: Locator,
  what: string,
): Promise<void> {
  await pollFor({
    observe: () => diagramState(scope),
    isDone: (state) => (state?.painted ?? 0) > 0,
    timeoutMs: HYDRATION_TIMEOUT,
    onTimeout: (last, elapsedMs) =>
      new Error(
        `${what} showed no painted diagram after ${elapsedMs}ms; last seen: ${JSON.stringify(last)}`,
      ),
  });
}

export async function expectNoDiagramError(
  scope: Locator,
  what: string,
): Promise<void> {
  const state = await diagramState(scope);
  if (state === null) throw new Error(`${what} could not be read`);
  if (state.errors.length > 0) {
    throw new Error(
      `${what} shows a diagram error: ${JSON.stringify(state.errors)}`,
    );
  }
}

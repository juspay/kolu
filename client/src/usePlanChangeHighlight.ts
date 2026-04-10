/** Track plan content changes and highlight modified elements in the DOM.
 *
 *  Compares previous vs current content line-by-line. After the DOM updates,
 *  adds a CSS animation class to elements whose data-line falls in the changed set.
 *  Concern: change visualization only — no rendering, no feedback, no selection. */

import { createEffect, on, type Accessor } from "solid-js";

/** Set up change highlighting for a plan content container.
 *  Call once per PlanPane instance. */
export function usePlanChangeHighlight(
  content: Accessor<string | undefined>,
  contentRef: () => HTMLDivElement | undefined,
) {
  let prevLines: string[] = [];

  createEffect(
    on(content, (raw) => {
      const ref = contentRef();
      if (!raw || !ref) return;
      const newLines = raw.split("\n");

      if (prevLines.length === 0) {
        prevLines = newLines;
        return;
      }

      // Find which source lines changed or were added
      const changedLines = new Set<number>();
      const maxLen = Math.max(prevLines.length, newLines.length);
      for (let i = 0; i < maxLen; i++) {
        if (prevLines[i] !== newLines[i]) changedLines.add(i + 1); // 1-based
      }
      prevLines = newLines;

      if (changedLines.size === 0) return;

      // After DOM update, highlight elements whose data-line is in the changed set
      requestAnimationFrame(() => {
        const ref2 = contentRef();
        if (!ref2) return;
        for (const el of ref2.querySelectorAll("[data-line]")) {
          const line = parseInt((el as HTMLElement).dataset.line ?? "0", 10);
          if (changedLines.has(line)) {
            el.classList.add("plan-changed");
            setTimeout(() => el.classList.remove("plan-changed"), 2000);
          }
        }
      });
    }),
  );
}

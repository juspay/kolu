/**
 * `SurfaceFaultBoundary` — the three verbs the framework owns (catch, record,
 * print) proven against a REAL Solid `ErrorBoundary` (the vitest config pins
 * the browser build, so the boundary that catches here is the one that catches
 * in a page). The LOOK is the app's; these tests hand in a capturing one.
 *
 * The printer's own litany is pinned in `../index.test.ts` (`thrownText`);
 * here the assertion is that the boundary hands the LOOK the PRINTED text —
 * not the raw value, not a summary — and that the record line fires, because a
 * boundary swallows and without it the fault reaches no console at all.
 *
 * TIMING: the boundary's error signal is written inside the batch the root is
 * running, so the fallback renders when that batch FLUSHES — assert after
 * `createRoot` returns, not inside it.
 */
import type { JSX } from "solid-js";
import { createComponent, createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SurfaceFaultBoundary } from "./fault";
import { resolveTree } from "./resolveTree.testlib";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SurfaceFaultBoundary", () => {
  it("hands the LOOK the PRINTED fault — normalized, not the raw value", () => {
    // Swallow the record line (asserted separately below) so a passing test
    // doesn't print a fake fault into the runner's output.
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A Safari-shaped stack: frames without the message. The printed text and
    // `String(error)` DIFFER here, so this asserts the printer ran — a
    // boundary that forwarded the raw error (or stringified it) fails.
    const err = new Error("undefined is not an object");
    err.stack = "renderRow@app.js:12:3";
    let seen: string | undefined;
    const dispose = createRoot((d) => {
      resolveTree(
        createComponent(SurfaceFaultBoundary, {
          fault: (text) => {
            seen = text;
            return null;
          },
          get children(): JSX.Element {
            throw err;
          },
        }),
      );
      return d;
    });
    expect(seen).toBe(
      "Error: undefined is not an object\nrenderRow@app.js:12:3",
    );
    dispose();
  });

  it("RECORDS the raw error on the console — the boundary swallows, so this line is the only trace", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = new Error("boom");
    const dispose = createRoot((d) => {
      resolveTree(
        createComponent(SurfaceFaultBoundary, {
          fault: () => null,
          get children(): JSX.Element {
            throw err;
          },
        }),
      );
      return d;
    });
    // The RAW error (a console renders its stack itself), behind the naming
    // prefix — among possibly-many dev-mode error lines, ours must be one.
    expect(spy.mock.calls).toContainEqual([
      "surface-app: this client threw while drawing the page —",
      err,
    ]);
    dispose();
  });

  it("passes a healthy tree through untouched — no LOOK, no record", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fault = vi.fn(() => null);
    const dispose = createRoot((d) => {
      const el = createComponent(SurfaceFaultBoundary, {
        fault,
        get children(): JSX.Element {
          return "the app";
        },
      });
      expect(resolveTree(el)).toBe("the app");
      return d;
    });
    expect(fault).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    dispose();
  });
});

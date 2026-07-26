// @vitest-environment happy-dom
/**
 * Locks the fix for the live PRT3 bug:
 *   click "forward & preview" → Preview tab → toast
 *   "Metadata error: Maximum call stack size exceeded" and no page.
 *
 * `createBrowser.navigate` reads the history signals (`current`/`cursor`) and
 * then writes them. A bare `createEffect(() => browser.navigate(loc))`
 * therefore tracks the same signals it mutates and re-enters until the stack
 * blows. That throw surfaces under the terminals collection's `onError` label
 * ("Metadata error") because Preview open is driven by a metadata-backed
 * location update.
 *
 * The healthy shape (what PreviewTab uses now): depend on a *location key*
 * via `on(...)`, and call `navigate` under `untrack` so trail signal writes
 * do not re-subscribe the effect. The Code tab only records from event
 * handlers for the same reason.
 *
 * e2e gap note: iframe body assertions exist in `ports.feature` /
 * `preview.feature`, but a Solid stack overflow becomes a sonner toast, not a
 * page `window` error — this unit test is the lock for that class of bug.
 */

import { createBrowser } from "@kolu/solid-browser";
import { createEffect, createRoot, createSignal, on, untrack } from "solid-js";
import { describe, expect, it } from "vitest";

type Loc = { port: number; path: string };

const same = (a: Loc, b: Loc) => a.port === b.port && a.path === b.path;

/** Solid queues effects on a microtask — flush twice so nested re-runs settle. */
async function flushSolid(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("preview trail — recording server location under a tracking scope", () => {
  it("the bare createEffect+navigate shape re-enters until the stack blows", async () => {
    // Regression detector: if this ever stops failing, Solid's tracking rules
    // changed and the PreviewTab untrack discipline needs re-proof.
    let runs = 0;
    let blew = false;
    const dispose = createRoot((d) => {
      const browser = createBrowser<Loc>({ isSameEntry: same });
      const [loc, setLoc] = createSignal<Loc | null>(null);
      createEffect(() => {
        runs++;
        if (runs > 50) {
          blew = true;
          return; // stop the re-entry without uncaught throw (vitest noise)
        }
        const l = loc();
        if (l === null) return;
        browser.navigate(l);
      });
      setLoc({ port: 5173, path: "/" });
      return d;
    });
    await flushSolid();
    dispose();
    expect(blew).toBe(true);
    expect(runs).toBeGreaterThan(50);
  });

  it("on(locationKey) + untrack(navigate) records without re-entering", async () => {
    // The shape PreviewTab ships: depend on a primitive key, write under untrack.
    let runs = 0;
    let thrown: unknown;
    let length = 0;
    const dispose = createRoot((d) => {
      const browser = createBrowser<Loc>({ isSameEntry: same });
      const [loc, setLoc] = createSignal<Loc | null>(null);

      createEffect(
        on(
          () => {
            const l = loc();
            return l === null ? null : `${l.port}\0${l.path}`;
          },
          (key) => {
            runs++;
            if (runs > 50) {
              thrown = new Error(
                `Maximum call stack size exceeded (effect re-entered ${runs} times)`,
              );
              throw thrown;
            }
            if (key === null) return;
            const l = loc();
            if (l === null) return;
            const plain = { port: l.port, path: l.path };
            untrack(() => browser.navigate(plain));
            length = browser.length();
          },
        ),
      );

      setLoc({ port: 5173, path: "/" });
      return d;
    });

    await flushSolid();
    dispose();

    if (thrown !== undefined) throw thrown;
    expect(runs).toBeGreaterThan(0);
    expect(runs).toBeLessThan(10);
    expect(length).toBe(1);
  });
});

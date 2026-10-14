// @vitest-environment happy-dom
/**
 * `LogTail` — the one block every tail wears. The behaviour worth pinning is the
 * pair a person depends on and cannot read off a class string: the Copy button
 * writes the WHOLE retained log (never the window the block happens to show),
 * and it confirms in the same breath. Copy's failure path is the same
 * `writeTextToClipboard` contract the canonical copy buttons already cover; the
 * follow-the-newest-line behaviour is a layout fact (scroll heights) that
 * happy-dom does not compute, so it is verified on screen instead.
 */

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LogLine } from "./logTailChrome";

const h = vi.hoisted(() => ({ written: [] as string[] }));

// A `vi.mock` factory is HOISTED above this module's imports, so the `Effect` it
// has to return is imported inside it — a static import is not in scope there.
vi.mock("./clipboard", async () => {
  const { Effect } = await import("effect");
  return {
    writeTextToClipboard: (text: string) => {
      h.written.push(text);
      return Effect.succeed(undefined);
    },
  };
});

// Imported after the mock above is registered, so `LogTail`'s own
// `./clipboard` import resolves to the fake.
const { default: LogTail } = await import("./LogTail");

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  h.written.length = 0;
  document.body.innerHTML = "";
});

/** Let the forked `runAction` reach its Effect — one macrotask, so an `await`
 *  in the test is enough without reaching for fake timers. */
async function tick(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

const line = (text: string): LogLine => ({ line: text });

describe("LogTail", () => {
  it("copies the whole retained log, not the visible tail — and says so", async () => {
    const full = ["one", "two", "three", "four"].map(line);
    // A four-line log shown through a two-line WINDOW: the lines the block had
    // to hide are the ones a person reaches for Copy for, and copying the
    // window would hide exactly them.
    dispose = render(
      () => <LogTail testid="t" lines={full.slice(-2)} log={full} />,
      document.body,
    );
    const rows = [...document.querySelectorAll('[data-testid="t"] > div')].map(
      (el) => el.textContent,
    );
    expect(rows).toEqual(["three", "four"]);

    const button = document.querySelector<HTMLButtonElement>(
      '[data-testid="t-copy"]',
    );
    expect(button).not.toBeNull();
    button?.click();
    await tick();

    expect(h.written).toEqual(["one\ntwo\nthree\nfour"]);
    expect(button?.textContent).toBe("copied");
  });
});

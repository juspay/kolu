// @vitest-environment happy-dom
/**
 * `LogTail` — the block every tail wears, and the clipboard write it owns. The
 * behaviours worth pinning are the pair a person depends on and cannot read off a
 * class string: Copy writes the WHOLE log it was handed (never the window the
 * block happens to show) and confirms in place, and a write that FAILS reports
 * the failure rather than a copy. The follow-the-newest-line behaviour is a
 * layout fact (scroll heights), which happy-dom does not compute — it is
 * verified on screen instead.
 */

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogTail } from "./LogTail";
import type { LogLine } from "./logTailChrome";

const h = vi.hoisted(() => ({
  written: [] as string[],
  failWith: undefined as string | undefined,
}));

// A `vi.mock` factory is HOISTED above this module's imports, so the `Effect` it
// has to return is imported inside it — a static import is not in scope there.
vi.mock("./clipboard", async () => {
  const { Cause, Effect } = await import("effect");
  return {
    writeTextToClipboard: (text: string) => {
      h.written.push(text);
      return h.failWith === undefined
        ? Effect.succeed(undefined)
        : // The real shape: `Cause.UnknownError` wraps the browser's own error.
          Effect.fail(new Cause.UnknownError(new Error(h.failWith)));
    },
  };
});

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  h.written.length = 0;
  h.failWith = undefined;
  document.body.innerHTML = "";
});

/** Let the write's promise settle — one macrotask, so an `await` in the test is
 *  enough without reaching for fake timers. */
async function tick(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

const line = (text: string): LogLine => ({ line: text });
const button = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="t-copy"]');
const block = () => document.querySelector<HTMLElement>('[data-testid="t"]');

const mount = (props: Parameters<typeof LogTail>[0]) => {
  dispose = render(() => <LogTail {...props} />, document.body);
};

describe("LogTail", () => {
  it("copies the whole retained log, not the visible tail — and says so", async () => {
    const full = ["one", "two", "three", "four"].map(line);
    // A four-line log shown through a two-line WINDOW: the lines the block had
    // to hide are the ones a person reaches for Copy for, and copying the
    // window would hide exactly them.
    mount({
      testid: "t",
      lines: full.slice(-2),
      log: full,
      onCopyError: () => {},
    });
    const rows = [...(block()?.children ?? [])].map((el) => el.textContent);
    expect(rows).toEqual(["three", "four"]);

    button()?.click();
    await tick();

    expect(h.written).toEqual(["one\ntwo\nthree\nfour"]);
    expect(button()?.textContent).toBe("copied");
  });

  it("reports a failed write with the failure's own sentence, and never claims a copy", async () => {
    h.failWith = "clipboard access blocked";
    const errors: string[] = [];
    mount({
      testid: "t",
      lines: [line("a")],
      log: [line("a")],
      onCopyError: (message) => errors.push(message),
    });

    button()?.click();
    await tick();

    // Not Effect's wrapper text ("An error occurred in Effect.try") — the cause.
    expect(errors).toEqual(["clipboard access blocked"]);
    expect(button()?.textContent).toBe("Copy");
  });

  it("reserves the corner the Copy button sits in, so a long first row never runs under it", () => {
    mount({
      testid: "t",
      lines: [
        line(
          "a very long line that would otherwise reach the block's right edge",
        ),
      ],
      log: [line("a")],
      onCopyError: () => {},
    });
    expect(block()?.className).toContain("pr-12");
    // ...and the button is OUTSIDE the scroller, so it cannot scroll away.
    expect(button()?.parentElement).toBe(block()?.parentElement);
  });
});

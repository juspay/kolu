// @vitest-environment happy-dom

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogTail } from "./LogTail";
import type { LogLine } from "./LogTail";

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
        : Effect.fail(
            new Cause.UnknownError(new Error(h.failWith), h.failWith),
          );
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
    expect(button()?.parentElement).toBe(block()?.parentElement);
  });
});

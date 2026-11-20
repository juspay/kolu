// @vitest-environment happy-dom

import { Effect } from "effect";
import type { KoluForward } from "kolu-common/surface";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

const writeTextToClipboard = vi.fn((_text: string) => Effect.void);

vi.mock("@kolu/solid-logtail", () => ({ writeTextToClipboard }));
vi.mock("./useForwards", () => ({ cancelForward: () => Effect.void }));

const { ForwardCopyButton } = await import("./ForwardPill");

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
  writeTextToClipboard.mockClear();
});

const forward: KoluForward = {
  key: "local:5173",
  host: { kind: "local" },
  remotePort: 5173,
  localPort: 61000,
  origin: "auto",
  createdAt: 0,
};

function mount() {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <ForwardCopyButton forward={forward} />, host);
  return host.querySelector<HTMLButtonElement>('[data-testid="forward-copy"]');
}

describe("ForwardCopyButton", () => {
  it("writes through the repo's clipboard helper, not navigator directly", () => {
    const button = mount();
    button?.click();
    expect(writeTextToClipboard).toHaveBeenCalledOnce();
    expect(writeTextToClipboard).toHaveBeenCalledWith(
      expect.stringContaining("61000"),
    );
  });

  it("survives a non-secure context, where navigator.clipboard is undefined", () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    try {
      const button = mount();
      expect(() => button?.click()).not.toThrow();
      expect(writeTextToClipboard).toHaveBeenCalledOnce();
    } finally {
      if (original) Object.defineProperty(navigator, "clipboard", original);
    }
  });
});

describe("what a row SHOWS and what it COPIES", () => {
  it("agrees on an IPv6-served kolu, brackets and all", async () => {
    const { pasteableAddress, forwardUrl } = await import("./ForwardPill");
    const original = window.location.hostname;
    Object.defineProperty(window, "location", {
      value: { hostname: "fd7a:1:2::2" },
      configurable: true,
    });
    try {
      expect(pasteableAddress(forward)).toBe("[fd7a:1:2::2]:61000");
      expect(forwardUrl(forward)).toContain(pasteableAddress(forward));
    } finally {
      Object.defineProperty(window, "location", {
        value: { hostname: original },
        configurable: true,
      });
    }
  });
});

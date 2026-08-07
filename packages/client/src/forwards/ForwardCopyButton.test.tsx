// @vitest-environment happy-dom
/**
 * Copying a forward's address — through the repo's one clipboard write path.
 *
 * The address IS the point of a forward: it goes into a curl, a config, another
 * machine's browser. So the copy button has to work in the shape kolu is
 * actually deployed in — reached over plain `http://` at a LAN address, a
 * machine hostname, or a Tailscale IP. In that shape `navigator.clipboard` is
 * `undefined` (it is a secure-context-only API), and reading `.writeText` off it
 * throws a SYNCHRONOUS `TypeError` — before any `.then()` is attached, so a
 * rejection handler never runs: no copy, no toast, and the error escapes the
 * click handler.
 *
 * `writeTextToClipboard` is the module that owns this problem, and it falls
 * through to the `document.execCommand("copy")` textarea path, which is the only
 * portable write that survives plain HTTP. Going through it is the whole
 * requirement here — the fallback itself is that module's to test.
 */

import { Effect } from "effect";
import type { KoluForward } from "kolu-common/surface";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

const writeTextToClipboard = vi.fn((_text: string) => Effect.void);

vi.mock("../ui/clipboard", () => ({ writeTextToClipboard }));
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
    // The LOCAL port — the door's address on the machine serving this page — is
    // what a user can actually paste somewhere else.
    expect(writeTextToClipboard).toHaveBeenCalledWith(
      expect.stringContaining("61000"),
    );
  });

  it("survives a non-secure context, where navigator.clipboard is undefined", () => {
    // The failure this test exists for is a synchronous throw out of onClick.
    // Delegating means the missing-API case is handled inside the helper, which
    // is exactly why the click below cannot throw.
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
    // A kolu reached over a tailnet `fd7a:…` address is the ordinary case, not
    // an exotic one, and `location.hostname` hands it over WITHOUT the brackets
    // a URL needs. The pill text and the copied URL are two readings of one
    // fact, so they must be one derivation: a row that displays an address the
    // copy button does not produce is a row where only one of them works.
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

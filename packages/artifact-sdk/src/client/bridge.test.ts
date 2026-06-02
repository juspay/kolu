import { afterEach, describe, expect, it, vi } from "vitest";
import { observeIframeNavigation } from "./bridge";

/** `observeIframeNavigation` reads only `window.addEventListener("message")`,
 *  `event.source`, and `event.data`. The artifact-sdk package runs its unit
 *  suite in the node env (no jsdom), so we stub the minimum surface and drive
 *  the captured handler directly with synthetic message events. */
function withFakeWindow(): {
  iframe: HTMLIFrameElement;
  post: (source: unknown, data: unknown) => void;
  restore: () => void;
} {
  const contentWindow = {} as Window;
  const iframe = { contentWindow } as unknown as HTMLIFrameElement;
  let handler: ((e: MessageEvent) => void) | null = null;
  const realWindow = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = {
    addEventListener: (type: string, fn: (e: MessageEvent) => void) => {
      if (type === "message") handler = fn;
    },
    removeEventListener: () => {
      handler = null;
    },
  };
  return {
    iframe,
    post: (source, data) =>
      handler?.({ source, data } as unknown as MessageEvent),
    restore: () => {
      (globalThis as Record<string, unknown>).window = realWindow;
    },
  };
}

describe("observeIframeNavigation", () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("fires onNavigate for a well-formed ready message from the iframe", () => {
    const fake = withFakeWindow();
    restore = fake.restore;
    const onNavigate = vi.fn();
    observeIframeNavigation(fake.iframe, onNavigate);
    fake.post(fake.iframe.contentWindow, {
      type: "kolu-artifact-sdk:ready",
      pathname: "/api/terminals/t1/file/out%2Freport.html",
    });
    expect(onNavigate).toHaveBeenCalledWith(
      "/api/terminals/t1/file/out%2Freport.html",
    );
  });

  it("ignores messages from a different source", () => {
    const fake = withFakeWindow();
    restore = fake.restore;
    const onNavigate = vi.fn();
    observeIframeNavigation(fake.iframe, onNavigate);
    fake.post({}, { type: "kolu-artifact-sdk:ready", pathname: "/evil" });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("drops a ready message with no pathname without throwing", () => {
    const fake = withFakeWindow();
    restore = fake.restore;
    const onNavigate = vi.fn();
    observeIframeNavigation(fake.iframe, onNavigate);
    expect(() =>
      fake.post(fake.iframe.contentWindow, {
        type: "kolu-artifact-sdk:ready",
      }),
    ).not.toThrow();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("drops a ready message with a non-string pathname", () => {
    const fake = withFakeWindow();
    restore = fake.restore;
    const onNavigate = vi.fn();
    observeIframeNavigation(fake.iframe, onNavigate);
    fake.post(fake.iframe.contentWindow, {
      type: "kolu-artifact-sdk:ready",
      pathname: 1,
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("drops non-object payloads", () => {
    const fake = withFakeWindow();
    restore = fake.restore;
    const onNavigate = vi.fn();
    observeIframeNavigation(fake.iframe, onNavigate);
    fake.post(fake.iframe.contentWindow, null);
    fake.post(fake.iframe.contentWindow, "kolu-artifact-sdk:ready");
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

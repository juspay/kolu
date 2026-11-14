// @vitest-environment happy-dom
/**
 * A failure's words as agents surfaces draw them: the cause alone when that is
 * all there is, and — when there is evidence — one row per line under it,
 * whose Copy hands over the WHOLE failure (the cause line, then every line).
 */

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import FailureWords from "./FailureWords";

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function mount(words: Parameters<typeof FailureWords>[0]["words"]) {
  const root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => <FailureWords words={words} tone="warn" testid="cause" />,
    root,
  );
  return {
    text: () => root.querySelector('[data-testid="cause-text"]')?.textContent,
    detail: () =>
      root.querySelector<HTMLElement>('[data-testid="cause-detail"]'),
    copy: () =>
      root.querySelector<HTMLButtonElement>(
        '[data-testid="cause-detail-copy"]',
      ),
  };
}

describe("FailureWords", () => {
  it("a cause with no evidence is the cause line alone — no evidence block", () => {
    const f = mount({ by: "padi", headline: "no route", detail: [] });
    expect(f.text()).toBe("padi: no route");
    expect(f.detail()).toBeNull();
  });

  it("evidence: one row per line, and Copy writes the cause line then every line", async () => {
    const written: string[] = [];
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async (text: string) => {
          written.push(text);
        },
      },
    });
    const f = mount({
      by: "kolu's delivery",
      headline: "cannot build x: error: 1 dependencies failed",
      detail: [
        "error: builder for '/nix/store/a.drv' failed",
        "",
        "  > exit 1",
      ],
    });
    expect(f.text()).toBe(
      "kolu's delivery: cannot build x: error: 1 dependencies failed",
    );
    expect(
      [...(f.detail()?.children ?? [])].map((row) => row.textContent),
    ).toEqual([
      "error: builder for '/nix/store/a.drv' failed",
      "",
      "  > exit 1",
    ]);
    f.copy()?.click();
    await vi.waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]).toBe(
      [
        "kolu's delivery: cannot build x: error: 1 dependencies failed",
        "error: builder for '/nix/store/a.drv' failed",
        "",
        "  > exit 1",
      ].join("\n"),
    );
  });
});

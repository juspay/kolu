// @vitest-environment happy-dom
/**
 * The second click on a printed URL crashed production: with a card already
 * open, the document-level mousedown dismiss flips the mount's <Show> in the
 * same synchronous cascade that still-mounted children are reading through —
 * Solid's "Stale read from <Show>". The class, not the instance, is what this
 * pins: every accessor-children (<Show>/<Match> non-keyed function form) along
 * the card's path must be keyed, so a stale read is unspellable.
 */

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../wire", () => ({
  activeHost: () => ({ kind: "local" as const }),
}));
vi.mock("../useServerIdentity", () => ({
  useServerIdentity: () => ({ hostname: () => "pureintent" }),
}));
vi.mock("./useTerminalStore", () => ({
  useTerminalStore: () => ({
    getTilePaneIds: () => [],
    getMetadata: () => undefined,
  }),
}));
vi.mock("../forwards/useForwards", () => ({
  forwardsForHost: () => [],
  viewerHost: () => null,
}));
vi.mock("../kaval/useDaemonStatus", () => ({
  isActiveHostLocal: () => true,
}));
vi.mock("../forwards/openPort", () => ({
  urlForPort: () => ({ kind: "none" as const }),
  ensureDoor: () => Promise.resolve(0),
}));
vi.mock("./handleWebLink", () => ({
  openRawUrl: vi.fn(),
}));
vi.mock(import("@kolu/padi-client/surface"), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, activeArm: () => undefined };
});

const { PrintedUrlCardMount } = await import("./PrintedUrlCard");
const { openPrintedUrlCard, closePrintedUrlCard } = await import(
  "./printedUrlCardState"
);

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  closePrintedUrlCard();
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

const target = {
  terminalId: "t-1" as never,
  uri: "http://localhost:5173/",
  port: 5173,
  protocol: "http:" as const,
  pathname: "/",
  search: "",
  hash: "",
  x: 40,
  y: 40,
};

describe("printed-URL card dismissal", () => {
  it("survives an outside mousedown while open (the second-click crash)", () => {
    host = document.createElement("div");
    document.body.appendChild(host);

    // The REAL mount — the same component Terminal renders.
    dispose = render(
      () => <PrintedUrlCardMount terminalId={target.terminalId} />,
      host,
    );

    openPrintedUrlCard(target);
    expect(document.querySelector("[data-testid=printed-url-card]")).not.toBe(
      null,
    );

    // Second click on the link: the document mousedown fires first (outside
    // the card panel) and dismisses — this is the cascade that threw in
    // production.
    const boom = () => {
      document.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    };
    expect(boom).not.toThrow();
    expect(document.querySelector("[data-testid=printed-url-card]")).toBe(null);
  });
});

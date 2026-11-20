// @vitest-environment happy-dom

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
    terminalIds: () => [],
    activate: () => {},
  }),
}));
vi.mock("../forwards/useForwards", () => ({
  forwardsForHost: () => [],
  viewerHost: () => null,
}));
vi.mock("../forwards/useHostListeners", () => ({
  useHostListeners: () => () => ({ status: "unknown" as const }),
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

    dispose = render(
      () => <PrintedUrlCardMount terminalId={target.terminalId} />,
      host,
    );

    openPrintedUrlCard(target);
    expect(document.querySelector("[data-testid=printed-url-card]")).not.toBe(
      null,
    );

    const boom = () => {
      document.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    };
    expect(boom).not.toThrow();
    expect(document.querySelector("[data-testid=printed-url-card]")).toBe(null);
  });
});

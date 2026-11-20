// @vitest-environment happy-dom

import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import { registerSubscription } from "@kolu/surface/subscriptions";
import { render } from "solid-js/web";
import { afterEach, expect, it, vi } from "vitest";

const LOCAL: HostKey = { kind: "local" };
const dialHistory = vi.fn(() => [
  {
    startedAt: 1_700_000_000_000,
    openedAt: 1_700_000_000_100,
    classification: "in-flight" as const,
  },
]);

const writeTextToClipboard = vi.fn((_text: string) => Effect.void);
vi.mock("@kolu/solid-logtail", () => ({ writeTextToClipboard }));
vi.mock("./wire", () => ({
  wire: { status: () => "open" },
  wireDiagnostics: { epoch: () => 1, dialHistory },
  hostKeys: () => [LOCAL],
  padiMap: {
    entry: () => ({
      state: () => ({ kind: "connected", connection: { phase: "connected" } }),
    }),
  },
}));
vi.mock("./rpc/rpc", () => ({ serverProcessId: () => "777182df" }));
vi.mock("./kaval/useDaemonStatus", () => ({
  localDaemonStatus: () => undefined,
}));

const { default: CopyDiagnosticsButton, copyDiagnosticSnapshot } = await import(
  "./CopyDiagnosticsButton"
);

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
  writeTextToClipboard.mockClear();
  dialHistory.mockClear();
});

it("writes the snapshot through the repo's clipboard helper, not navigator directly", () => {
  registerSubscription("entries[local]").frame();
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <CopyDiagnosticsButton />, host);
  host
    .querySelector<HTMLButtonElement>(
      '[data-testid="copy-diagnostic-snapshot"]',
    )
    ?.click();

  expect(writeTextToClipboard).toHaveBeenCalledOnce();
  const text = writeTextToClipboard.mock.calls[0]?.[0] ?? "";
  expect(text).toContain("kolu diagnostic snapshot");
  expect(text).toContain("[subscriptions]");
  expect(text).toContain("entries[local]");
});

it("builds LAZILY — nothing is read until the effect runs, so the write stays in the gesture window", () => {
  const action = copyDiagnosticSnapshot();
  expect(dialHistory).not.toHaveBeenCalled();
  expect(writeTextToClipboard).not.toHaveBeenCalled();

  Effect.runSync(action);
  expect(dialHistory).toHaveBeenCalled();
  expect(writeTextToClipboard).toHaveBeenCalledOnce();
});

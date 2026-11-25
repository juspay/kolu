// @vitest-environment happy-dom
/**
 * THE PALETTE AS THE APP MOUNTS IT — the real `ModalDialog`, the real Corvu
 * dialog under it, and real `PaletteRow`s inside it. The other palette tests
 * mock `@corvu-next/dialog`, `./ui/ModalDialog` and `./palette/PaletteRow`
 * away, so the chain the browser actually renders
 * (`<CommandPalette> › <ModalDialog> › <Dialog> › <Dialog.Portal> › <Portal> ›
 * <Dialog.Content> › <Dismissible> › … › <PaletteRow>`) was reached only by
 * e2e — the chain the first Solid-diagnostics run named in every one of its
 * failures.
 *
 * What this pins is that opening the palette paints its rows through that
 * chain, under `@kolu/solid-test-setup`'s gate: any Solid dev diagnostic any
 * link in it raises — a strict read, a write in an owned scope — fails this
 * test, with the code, the owner path and the location.
 *
 * It reproduces that run's owner path link for link: with `PaletteRow`'s
 * pre-fix keybind read restored this mount raises STRICT_READ_UNTRACKED at
 * `<CommandPalette> › <ModalDialog> › <Dialog> › … › <Dialog.Content> ›
 * <Dismissible> › … › <For> › <Show> › value › <PaletteRow> › <Show> ›
 * value` — the lane's string under its `<SurfaceAppProvider> › … › <App>`
 * prefix — and it raises NO second diagnostic. So the
 * REACTIVE_WRITE_IN_OWNED_SCOPE that run printed beside it, as a footer with
 * no message, owner or location, does not come from THE LINKS THIS MOUNTS.
 * It says nothing about the rest of the palette: the ten collaborators below
 * are mocked away, and one of them — `useAttentionFacts` — is an owned scope
 * of its own, so the real one could raise it and this test stay green.
 */

import { LOCAL_LOCATION } from "@kolu/padi-client/surface";
import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import type { PaletteItem } from "./CommandPalette";

// The services a mounted palette reaches for — a socket, the host map, the
// active view — stubbed flat. Everything that DRAWS is the real thing.
vi.mock("./wire", () => ({
  encActiveHost: () => "local",
  activeHost: () => ({ kind: "local" }),
  padiMap: { entry: () => ({ state: () => ({ kind: "connected" }) }) },
}));
vi.mock("./host/useHostKaval", () => ({
  useHostKavalChain: () => () => ({ kind: "serving" }),
}));
vi.mock("./attention/useAttentionFacts", () => ({
  useAttentionFacts: () => ({
    attentionOf: () => ({ klass: "idle" as const, live: false }),
  }),
}));
vi.mock("./host/HostIdentityLabel", () => ({
  HostIdentityLabel: () => <span />,
}));
vi.mock("./host/hostChipTone", () => ({
  hostHue: () => "0",
  hostLabel: () => "host",
}));
vi.mock("./settings/useTips", () => ({
  useTips: () => ({ peekAmbientTipText: () => "" }),
}));
vi.mock("./useViewState", () => ({
  useViewState: () => ({ activeId: () => null }),
}));
vi.mock("./palette/CreateIdentityPreview", () => ({ default: () => null }));
vi.mock("./canvas/activeTerminal", () => ({
  getActiveTerminalNode: () => null,
  getFirstTerminalNode: () => null,
}));
vi.mock("./useMobile", () => ({ isTouch: () => false }));
// Loaded after the mocks are registered, as the other palette tests do: a
// static import would be hoisted above them and bind the real services.
const { default: CommandPalette } = await import("./CommandPalette");

const ID = "22222222-2222-4222-8222-222222222222" as TerminalId;

const META = {
  state: "active",
  cwd: "/srv/code/tidepool",
  git: { kind: "none" },
  location: LOCAL_LOCATION,
  pr: { kind: "absent" },
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
  lastActivityAt: 0,
  promptedAt: null,
} as unknown as TerminalMetadata;

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
});

it("paints its rows through the real modal chain when it opens", () => {
  const commands = (): PaletteItem[] => [
    {
      kind: "action",
      name: "tidepool",
      keybind: { key: "k", modifier: "cmdOrCtrl" },
      row: {
        kind: "terminal",
        terminalId: ID,
        terminalMeta: META,
        hostKey: { kind: "local" },
      },
      onSelect: () => {},
    },
    { kind: "action", name: "Toggle theme", onSelect: () => {} },
  ];
  const [open, setOpen] = createSignal(false);
  const host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <CommandPalette
        commands={commands}
        open={open()}
        onOpenChange={setOpen}
      />
    ),
    host,
  );
  flush();

  // The open is the moment the e2e lane always failed in: the dialog's portal,
  // its content and every row are created in one frame.
  setOpen(true);
  flush();

  const content = document.querySelector<HTMLElement>(
    '[data-testid="command-palette"]',
  );
  expect(content).not.toBeNull();
  expect(content?.textContent).toContain("tidepool");
  expect(content?.textContent).toContain("Toggle theme");
});

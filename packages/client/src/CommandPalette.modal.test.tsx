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

/** Where the page's focus ended up, named so a failure READS: the palette's
 *  search input is the only `<input>` in the chain, and anything else that
 *  took the focus is identified by what it says. */
function focusedThing(): string {
  const el = document.activeElement;
  if (!el || el === document.body) return "none";
  if (el.tagName === "INPUT") return "search input";
  return `<${el.tagName.toLowerCase()}> ${el.textContent?.trim() ?? ""}`;
}

/** The theme group, exactly as the theme deep links reach it: a drillable
 *  group the palette opens AT (`openGroup` / `initialPath`). */
const THEME_GROUP: PaletteItem = {
  kind: "group",
  name: "Set theme",
  children: [
    { kind: "action", name: "Tide", onSelect: () => {} },
    { kind: "action", name: "Ember", onSelect: () => {} },
  ],
};

const paletteCommands = (): PaletteItem[] => [
  THEME_GROUP,
  { kind: "action", name: "Toggle theme", onSelect: () => {} },
];

/** Mount the real chain with the terminal holding focus (what every open
 *  starts from), open it at `initialPath`, and answer where focus landed. */
async function openAndSettleFocus(
  initialPath?: readonly string[],
): Promise<string> {
  const outside = document.createElement("button");
  document.body.append(outside);
  outside.focus();
  const host = document.createElement("div");
  document.body.append(host);
  const [open, setOpen] = createSignal(false);
  dispose = render(
    () => (
      <CommandPalette
        commands={paletteCommands}
        open={open()}
        onOpenChange={setOpen}
        initialPath={initialPath}
      />
    ),
    host,
  );
  flush();
  setOpen(true);
  flush();
  // Both focus owners get their frames: the palette's own `rAF` focus and
  // Corvu's focus trap, whose `afterPaint` is two `requestAnimationFrame`s
  // deep. Deliberately NO early break on the input — the bug is a LATER focus
  // taking it away, which a break would never see.
  for (let frame = 0; frame < 8; frame++) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 16);
    await promise;
  }
  return focusedThing();
}

it("focuses its search input when it opens at a path", async () => {
  const landed = await openAndSettleFocus(["Set theme"]);
  // The deep link resolved — the breadcrumb strip is the proof, and it is
  // also what puts focusable buttons AHEAD of the input in the content.
  expect(
    document.querySelector<HTMLElement>('[data-testid="command-palette"] nav')
      ?.textContent,
  ).toContain("Set theme");
  expect(landed).toBe("search input");
});

it("focuses its search input when it opens at the root", async () => {
  const landed = await openAndSettleFocus();
  expect(landed).toBe("search input");
});

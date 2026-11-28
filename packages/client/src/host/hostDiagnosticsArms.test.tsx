// @vitest-environment happy-dom
/** THE HOST POPOVER'S ARM INDEX OVER A 250-TERMINAL HOST.
 *
 *  The popover opens a foreign host's terminal collection per key, so its arm
 *  index paid three sources per terminal — the index leaf on the store-proxy
 *  key list, the per-key memo, and that key's `store.v` — on ONE memo. A host
 *  with a couple of hundred panes therefore put that memo past Solid's
 *  200-source `WIDE_SCOPE_DEPS` judge, every time the panel was open.
 *
 *  THE COLLECTION IS THE REAL ONE (`../hostScope/hostWireMirror.testlib`): the
 *  real keys stream and the real per-key `useCollection` view over real
 *  subscription stores, so the index pays what it pays in the browser.
 *
 *  The panel is MOUNTED and OPEN, because that is the only state in which this
 *  memo exists at all; the published result is the forward row's serving link,
 *  which is the one thing the index is for. The port is served by a SPLIT, so
 *  the link must name the containing tile — the rule `servingLink` exists for. */

import type { PadiTerminal } from "@kolu/padi-client/surface";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { settle } from "@kolu/surface/solid/testlib";
import type { HostKey } from "kolu-common/hostKey";
import type { KoluForward, TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";

// `useCollection` opens each key's stream through this; the mirror's procedure
// IS the stream, so calling it is the whole wire.
vi.mock("@kolu/surface/client", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  unenrolledStreamCall: (source: (input: unknown) => unknown, input: unknown) =>
    source(input),
}));

const held = vi.hoisted(() => ({ entry: (() => undefined) as () => unknown }));

vi.mock("../wire", () => ({
  padiMap: { entry: () => held.entry() },
  activeHost: () => ({ kind: "local" }),
  setActiveHost: () => {},
  interpretClientError: () => {},
}));

const forwards = vi.hoisted(() => ({ list: [] as KoluForward[] }));
vi.mock("../forwards/useForwards", () => ({
  forwardsForHost: () => forwards.list,
}));

vi.mock("@kolu/surface-app/solid", () => ({
  useSurfaceApp: () => ({ server: () => null }),
}));
vi.mock("../attention/attentionMarks", () => ({
  hostMarks: () => ({
    active: () => 0,
    asking: () => 0,
    unseenFinished: () => 0,
  }),
}));
vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({ activate: () => {} }),
}));
vi.mock("./useHostKaval", () => ({
  useHostKavalChain: () => () => ({ kind: "serving" }),
}));
vi.mock("../kaval/useDaemonStatus", () => ({ failedEpisode: () => undefined }));
vi.mock("../useServerIdentity", () => ({
  useServerIdentity: () => ({ hostname: () => "box" }),
}));
vi.mock("../ui/useAnchoredPopover", () => ({
  useAnchoredPopover: () => ({
    panelRef: () => {},
    panelStyle: () => ({}),
  }),
}));
vi.mock("./HostDaemonChips", () => ({ HostDualDaemonSlot: () => null }));
vi.mock("./HostAgentsSection", () => ({ default: () => null }));
vi.mock("../CopyDiagnosticsButton", () => ({ default: () => null }));
vi.mock("./removeHost", () => ({ removeHost: () => {} }));
vi.mock("./reconnectHost", () => ({ reconnectHost: () => {} }));
vi.mock("../runAction", () => ({ runAction: () => {} }));
vi.mock("../palette/fleetActions", () => ({ selectFleetTerminal: () => {} }));
vi.mock("solid-sonner", () => ({
  toast: { success: () => {}, error: () => {} },
}));

import { hostWireMirror } from "../hostScope/hostWireMirror.testlib";
import { HostDiagnosticsPopover } from "./HostDiagnosticsPopover";

const HOST: HostKey = { kind: "local" };
const TERMINALS = 250;
/** Every fourth terminal is a tile; the three after it are its splits. */
const TILE_EVERY = 4;
const PORT = 3000;

const ids = Array.from(
  { length: TERMINALS },
  (_, n) => `t${n}` as TerminalId,
) as TerminalId[];
const parentAt = (n: number): TerminalId | null =>
  n % TILE_EVERY === 0 ? null : (ids[n - (n % TILE_EVERY)] as TerminalId);

/** A composed record as this host serves one. `cwd` names the tile, so the
 *  serving link's text is the containing tile's own name. */
const recordAt = (n: number, servesPort: boolean): PadiTerminal =>
  ({
    state: "active",
    parentId: parentAt(n),
    cwd: `/w/box${n - (n % TILE_EVERY)}`,
    git: { kind: "none" },
    lastActivityAt: n,
    ports: {
      status: "known",
      list: servesPort
        ? [
            {
              port: PORT,
              name: "node",
              command: "node server.js",
              scope: "loopback",
              family: "ipv4",
            },
          ]
        : [],
    },
  }) as unknown as PadiTerminal;

const forward = (remotePort: number): KoluForward =>
  ({
    host: HOST,
    remotePort,
    localPort: 40000 + remotePort,
    origin: "auto",
  }) as unknown as KoluForward;

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  root?.remove();
  root = undefined;
  forwards.list = [];
});

/** The panel, open, over a 250-terminal mirror. `servesAt` is the terminal
 *  holding the listening socket. */
async function panel(servesAt: number) {
  const mirror = hostWireMirror();
  held.entry = () => mirror.entry;
  forwards.list = [forward(PORT)];
  takeSolidDiagnostics();
  const [open] = createSignal(true);
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <HostDiagnosticsPopover
        host={HOST}
        triggerRef={() => undefined}
        open={open}
        onDismiss={() => {}}
      />
    ),
    root,
  );
  flush();
  mirror.pushKeys(ids);
  for (const n of ids.keys())
    mirror.pushRecord(ids[n] as TerminalId, recordAt(n, n === servesAt));
  await settle();
  flush();
  return { mirror };
}

/** What the one forward row says serves its port. */
const servingName = (): string | null =>
  document.querySelector<HTMLElement>('[data-testid="terminal-jump"]')
    ?.textContent ?? null;

it("names the tile serving a port on a 250-terminal host with no wide memo", async () => {
  // The socket is held by a SPLIT of tile `t96`, so the link must name the
  // tile, not the pane.
  const { mirror } = await panel(99);

  expect(servingName()).toBe("/w/box96");
  expect(diagnostics()).toEqual([]);

  // The server moves to a pane under another tile: the link follows it.
  mirror.pushRecord(ids[99] as TerminalId, recordAt(99, false));
  mirror.pushRecord(ids[201] as TerminalId, recordAt(201, true));
  await settle();
  flush();
  expect(servingName()).toBe("/w/box200");
  expect(diagnostics()).toEqual([]);
});

// @vitest-environment happy-dom
/**
 * A TERMINAL ROW'S MARK IN THE PALETTE reads its unread corner from the
 * terminal's OWN host's record — the record that host's Dock reads — so the
 * palette cannot disagree with a Dock about a terminal on a host you are not
 * on. A terminal with the same id on the shown host does not wear it.
 */

import { LOCAL_LOCATION } from "@kolu/padi-client/surface";
import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { render } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatKeybind, type Keybind } from "../input/keyboard";

vi.mock("../wire", () => ({
  activeHost: () => ({ kind: "local" }),
  padiMap: { entry: () => ({ state: () => ({ kind: "connected" }) }) },
}));
vi.mock("../host/useHostKaval", () => ({
  useHostKavalChain: () => () => ({ kind: "serving" }),
}));
vi.mock("../attention/useAttentionFacts", () => ({
  useAttentionFacts: () => ({
    attentionOf: () => ({ klass: "idle" as const, live: false }),
  }),
}));
// The host chip's label reads the server's identity; a terminal row's mark
// is what is under test here.
vi.mock("../host/HostIdentityLabel", () => ({
  HostIdentityLabel: () => <span />,
}));

import { attentionRecordOf } from "../attention/savedAttention";
import PaletteRow from "./PaletteRow";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;
const REMOTE: HostKey = { kind: "remote", target: "box-1" };

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
beforeEach(() => {
  for (const host of ["local", "remote:box-1"])
    attentionRecordOf(host).clearAllUnread();
});
afterEach(() => dispose?.());

function mount(hostKey: HostKey): HTMLElement {
  const host = document.createElement("div");
  dispose = render(
    () => (
      <PaletteRow
        cmd={{
          kind: "label",
          name: "tidepool",
          row: {
            kind: "terminal",
            terminalId: ID,
            terminalMeta: META,
            hostKey,
          },
        }}
        selected={false}
        query=""
        showKindTag={false}
        drillable={false}
        onSelect={() => {}}
        onHover={() => {}}
      />
    ),
    host,
  );
  return host;
}

const pip = (el: HTMLElement) =>
  el.querySelector<HTMLElement>('[data-testid="state-pip"]');

describe("a terminal row's mark in the palette", () => {
  it("wears the unread corner its own host's Dock shows, on a host you are not on", () => {
    attentionRecordOf("remote:box-1").markUnread(ID);
    expect(pip(mount(REMOTE))?.dataset.alert).toBeDefined();
  });

  it("does not wear another host's mark for a terminal with the same id", () => {
    attentionRecordOf("remote:box-1").markUnread(ID);
    expect(pip(mount({ kind: "local" }))?.dataset.alert).toBeUndefined();
  });
});

/** THE RIGHT RAIL'S KEYCAPS follow the command's keybind: a row whose shortcut
 *  changes repaints it. The read used to sit at the top of `<Show>`'s child
 *  body, which Solid runs untracked — a one-time snapshot (and a
 *  STRICT_READ_UNTRACKED diagnostic, which `@kolu/solid-test-setup` fails on). */
describe("a row's keybind rail", () => {
  it("repaints when the command's keybind changes", () => {
    const [keybind, setKeybind] = createSignal<Keybind>({
      key: "k",
      modifier: "cmdOrCtrl",
    });
    const host = document.createElement("div");
    dispose = render(
      () => (
        <PaletteRow
          cmd={{
            kind: "action",
            name: "Open palette",
            get keybind() {
              return keybind();
            },
            onSelect: () => {},
          }}
          selected={false}
          query=""
          showKindTag={false}
          drillable={false}
          onSelect={() => {}}
          onHover={() => {}}
        />
      ),
      host,
    );
    const caps = () =>
      [...host.querySelectorAll("kbd")].map((k) => k.textContent);

    expect(caps()).toEqual([
      formatKeybind({ key: "k", modifier: "cmdOrCtrl" }),
    ]);

    setKeybind({ key: "j", modifier: "cmdOrCtrl", shift: true });
    flush();
    expect(caps()).toEqual([
      formatKeybind({ key: "j", modifier: "cmdOrCtrl", shift: true }),
    ]);
  });
});

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
import PaletteRow, { type PaletteRowMeta } from "./PaletteRow";

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
        segments={[{ text: "tidepool", hit: false }]}
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
          segments={[{ text: "Open palette", hit: false }]}
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

/** THE KIND TAG'S WORD follows the row's kind. The word used to be computed in
 *  the component BODY, which Solid runs untracked: it froze at the first kind
 *  while `data-kind` beside it followed, and `command_palette_steps.ts` matches
 *  the tag BY TEXT. */
describe("a row's kind tag", () => {
  it("repaints its word when the row's kind changes", () => {
    const [row, setRow] = createSignal<PaletteRowMeta | undefined>(undefined);
    const host = document.createElement("div");
    dispose = render(
      () => (
        <PaletteRow
          cmd={{
            kind: "label",
            name: "tidepool",
            get row() {
              return row();
            },
          }}
          selected={false}
          segments={[{ text: "tidepool", hit: false }]}
          showKindTag={true}
          drillable={false}
          onSelect={() => {}}
          onHover={() => {}}
        />
      ),
      host,
    );
    const tag = () =>
      host.querySelector<HTMLElement>('[data-testid="palette-kind-tag"]');

    expect(tag()?.dataset.kind).toBe("command");
    expect(tag()?.textContent).toBe("cmd");

    setRow({
      kind: "terminal",
      terminalId: ID,
      terminalMeta: META,
      hostKey: { kind: "local" },
    });
    flush();
    expect(tag()?.dataset.kind).toBe("terminal");
    expect(tag()?.textContent).toBe("term");
  });
});

/** THE IDENTITY SLOT'S REPO is two strings that almost never move, while the
 *  row object around them is rebuilt on every fleet snapshot. Reading them as
 *  one minted pair handed the `<Show>` a new-but-equal condition value per
 *  republish — Solid's `UNSTABLE_MEMO_OUTPUT`, which `@kolu/solid-test-setup`
 *  fails the test on. */
describe("a terminal row's repo identity", () => {
  it("stays still across four republishes that leave the repo alone", () => {
    const [row, setRow] = createSignal<PaletteRowMeta>({
      kind: "terminal",
      terminalId: ID,
      terminalMeta: META,
      hostKey: { kind: "local" },
      repoName: "tidepool",
      repoColor: "oklch(0.7 0.1 200)",
      recencyAt: 0,
    });
    const host = document.createElement("div");
    dispose = render(
      () => (
        <PaletteRow
          cmd={{
            kind: "label",
            name: "tidepool",
            get row() {
              return row();
            },
          }}
          selected={false}
          segments={[{ text: "tidepool", hit: false }]}
          showKindTag={false}
          drillable={false}
          onSelect={() => {}}
          onHover={() => {}}
        />
      ),
      host,
    );
    const monogram = host.querySelector(
      '[data-testid="palette-repo-monogram"]',
    );
    const name = host.querySelector('[data-testid="palette-repo-name"]');
    expect(name?.textContent).toBe("tidepool");

    // Four fleet snapshots: a brand-new row object each time, same repo.
    for (let i = 1; i <= 4; i++) {
      setRow({ ...row(), recencyAt: i });
      flush();
    }

    expect(host.querySelector('[data-testid="palette-repo-monogram"]')).toBe(
      monogram,
    );
    expect(host.querySelector('[data-testid="palette-repo-name"]')).toBe(name);
    expect(name?.textContent).toBe("tidepool");
  });
});

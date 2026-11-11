// @vitest-environment happy-dom
/**
 * A tool card about a terminal on ANOTHER host.
 *
 * One conversation drives terminals everywhere, so `fix-parser` alone does not
 * say where the agent typed — the card has to name the machine, and its "open
 * tile" has to land on that machine's tab rather than focusing an id the
 * currently-selected host has never heard of. The row carries the two halves
 * separately (`terminalId` + `host`, the sides of the `host/id` the fleet face
 * spoke), and this pins that the card uses both.
 */

import type { OrchestratorToolRow } from "kolu-common/orchestrator";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

const landed = vi.hoisted(() => ({
  hosts: [] as HostKey[],
  focused: [] as TerminalId[],
}));
vi.mock("../host/selectHostTab", () => ({
  selectHostTab: (host: HostKey) => landed.hosts.push(host),
}));
vi.mock("../canvas/dock/useDockFocus", () => ({
  useDockFocus: () => (id: TerminalId) => landed.focused.push(id),
}));
// The diffs block drags in the whole code viewer (and its Nix-backed grammar
// aliases) for a row that carries none — stub it so this file tests the card.
vi.mock("./OrchestratorDiffs", () => ({ default: () => null }));

import OrchestratorToolCard from "./OrchestratorToolCard";

const TERMINAL = "11111111-1111-4111-8111-111111111111" as TerminalId;

const row = (host: string | null): OrchestratorToolRow =>
  ({
    kind: "tool",
    id: "row-1",
    text: "sendInput",
    status: "completed",
    tool: "lifecycle_sendInput",
    server: "kolu",
    kolu: {
      kind: "sendInput",
      terminalId: TERMINAL,
      host,
      name: "fix-parser",
      text: "go",
      key: null,
    },
  }) as unknown as OrchestratorToolRow;

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  landed.hosts = [];
  landed.focused = [];
});

function mount(host: string | null): HTMLElement {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(() => <OrchestratorToolCard row={row(host)} />, root);
  return root;
}

describe("a tool card naming a terminal on another host", () => {
  it("says which machine it was", () => {
    const el = mount("remote:srid@zest");
    expect(
      el.querySelector('[data-testid="orchestrator-tool-host"]')?.textContent,
    ).toBe("srid@zest");
    expect(
      el
        .querySelector('[data-testid="orchestrator-tool-card"]')
        ?.getAttribute("data-host"),
    ).toBe("remote:srid@zest");
  });

  it("'open tile' switches to that host's tab, THEN focuses the tile", () => {
    const el = mount("remote:srid@zest");
    el.querySelector<HTMLElement>(
      '[data-testid="orchestrator-tool-open-tile"]',
    )?.click();
    expect(landed.hosts).toEqual([{ kind: "remote", target: "srid@zest" }]);
    expect(landed.focused).toEqual([TERMINAL]);
  });

  it("offers nothing to open for a call whose ref could not be resolved", () => {
    // Both halves are null together: a card that guessed the local host would
    // send a person to a tab that never had this terminal.
    const el = mount(null);
    expect(
      el.querySelector('[data-testid="orchestrator-tool-open-tile"]'),
    ).toBeNull();
    expect(el.querySelector('[data-testid="orchestrator-tool-host"]')).toBeNull();
  });
});

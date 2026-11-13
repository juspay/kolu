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

import type { ConductorToolRow } from "kolu-common/conductor";
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
vi.mock("./ConductorDiffs", () => ({ default: () => null }));

import ConductorToolCard from "./ConductorToolCard";

const TERMINAL = "11111111-1111-4111-8111-111111111111" as TerminalId;

const row = (host: string | null): ConductorToolRow =>
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
  }) as unknown as ConductorToolRow;

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
  dispose = render(() => <ConductorToolCard row={row(host)} />, root);
  return root;
}

describe("a tool card naming a terminal on another host", () => {
  it("says which machine it was", () => {
    const el = mount("remote:srid@zest");
    expect(
      el.querySelector('[data-testid="conductor-tool-host"]')?.textContent,
    ).toBe("srid@zest");
    expect(
      el
        .querySelector('[data-testid="conductor-tool-card"]')
        ?.getAttribute("data-host"),
    ).toBe("remote:srid@zest");
  });

  it("'open tile' switches to that host's tab, THEN focuses the tile", () => {
    const el = mount("remote:srid@zest");
    el.querySelector<HTMLElement>(
      '[data-testid="conductor-tool-open-tile"]',
    )?.click();
    expect(landed.hosts).toEqual([{ kind: "remote", target: "srid@zest" }]);
    expect(landed.focused).toEqual([TERMINAL]);
  });

  it("offers nothing to open for a call whose ref could not be resolved", () => {
    // Both halves are null together: a card that guessed the local host would
    // send a person to a tab that never had this terminal.
    const el = mount(null);
    expect(
      el.querySelector('[data-testid="conductor-tool-open-tile"]'),
    ).toBeNull();
    expect(el.querySelector('[data-testid="conductor-tool-host"]')).toBeNull();
  });
});

describe("a failed call", () => {
  /** A `screen_text` on a terminal padi does not hold, as the adapter reports
   *  it: the tool's words fenced in the call's content, and the same words read
   *  where the screen would be. */
  const failedRead = {
    kind: "tool",
    id: "row-2",
    text: "screen_text",
    status: "failed",
    tool: "screen_text",
    server: "kolu",
    progress: `\`\`\`\nsurface-mcp: Terminal ${TERMINAL} not found\n\`\`\``,
    kolu: {
      kind: "screen",
      terminalId: TERMINAL,
      host: "local",
      name: null,
      snapshot: `surface-mcp: Terminal ${TERMINAL} not found`,
    },
  } as unknown as ConductorToolRow;

  const mountRow = (one: ConductorToolRow): HTMLElement => {
    root = document.createElement("div");
    document.body.append(root);
    dispose = render(() => <ConductorToolCard row={one} />, root);
    return root;
  };

  it("says why in ONE line — the tool's sentence, without the fence or our brand", () => {
    const el = mountRow(failedRead);
    const reasons = el.querySelectorAll(
      '[data-testid="conductor-tool-reason"]',
    );
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.textContent).toBe(`Terminal ${TERMINAL} not found`);
  });

  it("offers no screen, and never says the reason twice", () => {
    const el = mountRow(failedRead);
    expect(el.querySelector("details")).toBeNull();
    const text = el.textContent ?? "";
    expect(text.split("not found")).toHaveLength(2);
    expect(text).not.toContain("```");
  });

  it("a call that did not fail has no reason line, and keeps its screen", () => {
    const el = mountRow({
      ...failedRead,
      status: "completed",
      progress: undefined,
      kolu: { ...failedRead.kolu, snapshot: "$ ls" },
    } as unknown as ConductorToolRow);
    expect(
      el.querySelector('[data-testid="conductor-tool-reason"]'),
    ).toBeNull();
    expect(el.querySelector("details summary")?.textContent).toContain(
      "screen",
    );
  });
});

describe("the payload under a card kolu recognises", () => {
  const mountRow = (one: ConductorToolRow): HTMLElement => {
    root = document.createElement("div");
    document.body.append(root);
    dispose = render(() => <ConductorToolCard row={one} />, root);
    return root;
  };

  /** What a `create` answers: the same facts the card's own words already
   *  say, in JSON. */
  const ANSWER = `{"id":"remote:naiveintent/${TERMINAL}","pid":0,"ran":"omp"}`;

  const created = {
    kind: "tool",
    id: "row-3",
    text: "lifecycle_create",
    status: "completed",
    tool: "lifecycle_create",
    server: "kolu",
    progress: ANSWER,
    kolu: {
      kind: "create",
      terminalId: TERMINAL,
      host: "remote:naiveintent",
      name: "planner",
      cwd: null,
    },
  } as unknown as ConductorToolRow;

  it("keeps it behind the disclosure instead of printing it under the words", () => {
    const el = mountRow(created);
    // NOTHING raw in the flow: every body on this card is inside a fold.
    for (const pre of el.querySelectorAll("pre")) {
      expect(pre.closest("details")).not.toBeNull();
    }
    expect(el.querySelector("details summary")?.textContent).toContain(
      "answer",
    );
    // What is left once the fold is taken away is the card's own words — and
    // the payload is not among them.
    for (const fold of el.querySelectorAll("details")) fold.remove();
    expect(el.textContent ?? "").not.toContain('"pid"');
  });

  it("still has the payload for whoever opens it", () => {
    const el = mountRow(created);
    expect(
      el.querySelector('[data-testid="conductor-tool-detail"]')?.textContent,
    ).toContain("remote:naiveintent");
  });

  it("a GENERIC card still prints its content — nothing else on it reads the payload", () => {
    const el = mountRow({
      kind: "tool",
      id: "row-4",
      text: "Bash",
      status: "completed",
      tool: "Bash",
      progress: "total 4\ndrwxr-xr-x",
    } as unknown as ConductorToolRow);
    const loose = [...el.querySelectorAll("pre")].filter(
      (pre) => pre.closest("details") === null,
    );
    expect(loose).toHaveLength(1);
    expect(loose[0]?.textContent).toContain("drwxr-xr-x");
  });
});

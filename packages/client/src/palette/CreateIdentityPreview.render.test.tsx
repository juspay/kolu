// @vitest-environment happy-dom
/**
 * The "Will create" card must track the palette while it stays mounted.
 *
 * Inside the New terminal flow the model accessor never returns null, so the
 * non-keyed `<Show>` callback runs exactly once. A body that unwraps the
 * accessor into a const paints the FIRST model forever — the card kept naming
 * the old repo/branch/agent while the user had drilled into another repo and
 * typed a new name. These tests drive the props through that transition with
 * the card never unmounting.
 */

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  PaletteCommand,
  PaletteLabel,
  PaletteMode,
} from "../CommandPalette";

vi.mock("../hostScope/activeWire", () => ({
  recentRepos: () => [],
}));

vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({ activeMeta: () => null }),
}));

const { default: CreateIdentityPreview } = await import(
  "./CreateIdentityPreview"
);
const { NEW_TERMINAL_GROUP } = await import("./newTerminalGroup");

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

const rootPath = [{ name: NEW_TERMINAL_GROUP, kind: "group" }] as const;
const leaf = {
  kind: "value" as const,
  name: "spacetime",
  prefill: () => "witty-otter",
  onSubmit: () => {},
  children: [],
};
const leafPath = [
  { name: NEW_TERMINAL_GROUP, kind: "group" },
  { name: "spacetime", kind: "value" },
] as const;

/** Root-level highlight on another repo — where the stale card froze. */
const highlightedRepo: PaletteCommand = {
  kind: "value",
  name: "kolu",
  prefill: () => "witty-otter",
  onSubmit: () => {},
  children: [],
};

function text(testid: string): string {
  return (
    host?.querySelector(`[data-testid="${testid}"]`)?.textContent?.trim() ?? ""
  );
}

function mount() {
  const [path, setPath] =
    createSignal<readonly { name: string; kind: string }[]>(rootPath);
  const [mode, setMode] = createSignal<PaletteMode>({ kind: "filter" });
  const [query, setQuery] = createSignal("");
  const [highlighted, setHighlighted] = createSignal<
    PaletteCommand | PaletteLabel | undefined
  >(highlightedRepo);

  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <CreateIdentityPreview
        path={path()}
        mode={mode()}
        query={query()}
        highlighted={highlighted()}
      />
    ),
    host,
  );
  return { setPath, setMode, setQuery, setHighlighted };
}

describe("CreateIdentityPreview — live card, never a frozen snapshot", () => {
  it("follows the drill-in from a root highlight to a named worktree", () => {
    const { setPath, setMode, setQuery, setHighlighted } = mount();

    expect(text("create-preview-repo")).toBe("kolu");
    expect(text("create-preview-annotation")).toBe("worktree name…");
    expect(text("create-preview-agent-label")).toBe("Pick agent after name");

    setPath(leafPath);
    setMode({ kind: "value", leaf });
    setQuery("feat-fun-ui");
    setHighlighted({ kind: "label", name: "claude", data: "claude" });

    // Same mounted card — the model never went null, so nothing remounted.
    expect(
      host?.querySelectorAll('[data-testid="create-identity-preview"]'),
    ).toHaveLength(1);
    expect(text("create-preview-repo")).toBe("spacetime");
    expect(text("create-preview-annotation")).toBe("feat-fun-ui");
    expect(text("create-preview-agent-label")).toBe("claude");
  });

  it("repaints the annotation on every keystroke", () => {
    const { setPath, setMode, setQuery, setHighlighted } = mount();
    setPath(leafPath);
    setMode({ kind: "value", leaf });
    setHighlighted(undefined);

    setQuery("fea");
    expect(text("create-preview-annotation")).toBe("fea");
    setQuery("feat-fun");
    expect(text("create-preview-annotation")).toBe("feat-fun");
    expect(text("create-preview-agent-label")).toBe("Plain shell");
  });

  it("swaps the provisional annotation ink for fleet ink once a name is typed", () => {
    const { setPath, setMode, setQuery } = mount();
    setPath(leafPath);
    setMode({ kind: "value", leaf });

    const anno = () =>
      host?.querySelector('[data-testid="create-preview-annotation"]');
    expect(anno()?.className).toContain("text-fg-3");

    setQuery("feat-fun-ui");
    expect(anno()?.className).toContain("annotation-ink");
    expect(anno()?.className).not.toContain("text-fg-3");
    expect(anno()?.getAttribute("style")).toMatch(/--annotation-color:/);
  });
});

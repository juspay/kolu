import { describe, expect, it } from "vitest";
import type { PaletteMode } from "../CommandPalette";
import {
  createPreviewModel,
  isNewTerminalPath,
  NEW_TERMINAL_GROUP,
} from "./CreateIdentityPreview";

describe("isNewTerminalPath", () => {
  it("is true when New terminal is on the path", () => {
    expect(
      isNewTerminalPath([{ name: NEW_TERMINAL_GROUP, kind: "group" }]),
    ).toBe(true);
    expect(
      isNewTerminalPath([
        { name: NEW_TERMINAL_GROUP, kind: "group" },
        { name: "kolu", kind: "value" },
      ]),
    ).toBe(true);
  });

  it("is false outside the create flow", () => {
    expect(isNewTerminalPath([])).toBe(false);
    expect(isNewTerminalPath([{ name: "Theme", kind: "group" }])).toBe(false);
  });
});

describe("createPreviewModel", () => {
  const pathRoot = [{ name: NEW_TERMINAL_GROUP, kind: "group" }] as const;
  const filter: PaletteMode = { kind: "filter" };

  it("returns null outside New terminal", () => {
    expect(createPreviewModel([], filter, "", undefined, null)).toBeNull();
  });

  it("previews In current directory from active meta", () => {
    const model = createPreviewModel(
      pathRoot,
      filter,
      "",
      {
        kind: "action",
        name: "In current directory",
        onSelect: () => {},
      },
      {
        cwd: "/home/u/code/kolu",
        git: {
          repoRoot: "/home/u/code/kolu",
          repoName: "kolu",
          worktreePath: "/home/u/code/kolu",
          branch: "main",
          isWorktree: false,
          mainRepoRoot: "/home/u/code/kolu",
          remoteUrl: null,
        },
      } as never,
    );
    expect(model?.repoName).toBe("kolu");
    expect(model?.annotation).toBe("main");
    expect(model?.agentLabel).toBe("Plain shell");
    expect(model?.repoColor).toMatch(/^oklch\(/);
  });

  it("previews a highlighted repo before drill-in", () => {
    const model = createPreviewModel(
      pathRoot,
      filter,
      "",
      {
        kind: "value",
        name: "spacetime",
        prefill: () => "witty-otter",
        onSubmit: () => {},
        children: [],
      },
      null,
    );
    expect(model?.repoName).toBe("spacetime");
    expect(model?.annotation).toBe("worktree name…");
  });

  it("tracks typed worktree name and selected agent", () => {
    const leaf = {
      kind: "value" as const,
      name: "spacetime",
      prefill: () => "witty-otter",
      onSubmit: () => {},
      children: [],
    };
    const model = createPreviewModel(
      [
        { name: NEW_TERMINAL_GROUP, kind: "group" },
        { name: "spacetime", kind: "value" },
      ],
      { kind: "value", leaf },
      "feat-fun-ui",
      {
        kind: "label",
        name: "claude",
        data: "claude",
      },
      null,
    );
    expect(model?.repoName).toBe("spacetime");
    expect(model?.annotation).toBe("feat-fun-ui");
    expect(model?.agentLabel).toBe("claude");
  });
});

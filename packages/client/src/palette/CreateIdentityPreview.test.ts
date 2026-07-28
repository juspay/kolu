import { describe, expect, it } from "vitest";
import type { PaletteMode } from "../CommandPalette";
import { createPreviewModel, isNewTerminalPath } from "./CreateIdentityPreview";
import { NEW_TERMINAL_GROUP } from "./newTerminalGroup";

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

  it("requires New terminal as the root group (not a deeper name collision)", () => {
    expect(
      isNewTerminalPath([
        { name: "Hosts", kind: "group" },
        { name: NEW_TERMINAL_GROUP, kind: "value" },
      ]),
    ).toBe(false);
    expect(
      isNewTerminalPath([{ name: NEW_TERMINAL_GROUP, kind: "value" }]),
    ).toBe(false);
  });
});

describe("createPreviewModel", () => {
  const pathRoot = [{ name: NEW_TERMINAL_GROUP, kind: "group" }] as const;
  const filter: PaletteMode = { kind: "filter" };

  it("returns null outside New terminal", () => {
    expect(
      createPreviewModel([], filter, "", undefined, null, null),
    ).toBeNull();
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
      null,
    );
    expect(model?.repoName).toBe("kolu");
    expect(model?.annotation).toBe("main");
    expect(model?.agentLabel).toBe("Plain shell");
    expect(model?.repoColor).toMatch(/^oklch\(/);
    expect(model?.annotationColor).toMatch(/^oklch\(/);
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
      null,
    );
    expect(model?.repoName).toBe("spacetime");
    expect(model?.annotation).toBe("worktree name…");
    // Provisional chrome copy is not a fleet identity key.
    expect(model?.annotationColor).toBeNull();
    expect(model?.repoColor).toMatch(/^oklch\(/);
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
      null,
    );
    expect(model?.repoName).toBe("spacetime");
    expect(model?.annotation).toBe("feat-fun-ui");
    expect(model?.agentLabel).toBe("claude");
    expect(model?.annotationColor).toMatch(/^oklch\(/);
  });

  it("does not claim a recent repo when filter has no match", () => {
    const model = createPreviewModel(
      pathRoot,
      filter,
      "zzz-no-match",
      undefined,
      null,
      { repoName: "should-not-show" },
    );
    expect(model?.repoName).toBe("new");
    expect(model?.annotationColor).toBeNull();
  });

  it("uses defaultRepo without reading ambient recentRepos", () => {
    const model = createPreviewModel(pathRoot, filter, "", undefined, null, {
      repoName: "from-arg",
    });
    expect(model?.repoName).toBe("from-arg");
    expect(model?.annotation).toBe("choose a destination");
    expect(model?.annotationColor).toBeNull();
  });

  it("falls back to provisional new when no defaultRepo", () => {
    const model = createPreviewModel(
      pathRoot,
      filter,
      "",
      undefined,
      null,
      null,
    );
    expect(model?.repoName).toBe("new");
    expect(model?.annotation).toBe("choose a destination");
    expect(model?.annotationColor).toBeNull();
  });
});

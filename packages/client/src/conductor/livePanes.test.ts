import { describe, expect, it } from "vitest";
import { connectedPanes, frontPane, paneLayout, pickedView } from "./livePanes";

const A = "local/11111111-1111-4111-8111-111111111111";
const B = "local/22222222-2222-4222-8222-222222222222";
const C = "remote:nix@example/11111111-1111-4111-8111-111111111111";

const onScreen = {
  shown: true,
  picked: true,
  view: "terminals" as const,
};

describe("the picked work's view", () => {
  it("opens on its terminals while one is up, on its details while none is", () => {
    expect(pickedView(undefined, true)).toBe("terminals");
    expect(pickedView(undefined, false)).toBe("details");
  });

  it("keeps the view a person chose", () => {
    expect(pickedView("details", true)).toBe("details");
    expect(pickedView("terminals", false)).toBe("terminals");
  });
});

describe("how the panes are laid out", () => {
  it("stacks one or two terminals and tabs three", () => {
    expect(paneLayout(1, false)).toBe("stack");
    expect(paneLayout(2, false)).toBe("stack");
    expect(paneLayout(3, false)).toBe("tabs");
  });

  it("tabs any number on a narrow window", () => {
    expect(paneLayout(1, true)).toBe("tabs");
    expect(paneLayout(2, true)).toBe("tabs");
  });
});

describe("the front tab", () => {
  it("is the one pressed while it is still a terminal of the work", () => {
    expect(frontPane([A, B, C], B)).toBe(B);
  });

  it("falls to the first when the pressed one has left the work", () => {
    expect(frontPane([A, C], B)).toBe(A);
    expect(frontPane([A, C], undefined)).toBe(A);
    expect(frontPane([], undefined)).toBeUndefined();
  });
});

describe("which panes hold a connection", () => {
  it("connects every stacked pane on screen", () => {
    expect(
      connectedPanes({ ...onScreen, layout: "stack", refs: [A, B], front: A }),
    ).toEqual([A, B]);
  });

  it("connects only the front tab", () => {
    expect(
      connectedPanes({
        ...onScreen,
        layout: "tabs",
        refs: [A, B, C],
        front: B,
      }),
    ).toEqual([B]);
  });

  it("connects nothing the person cannot see", () => {
    const panes = { layout: "stack" as const, refs: [A, B], front: A };
    expect(connectedPanes({ ...onScreen, ...panes, shown: false })).toEqual([]);
    expect(connectedPanes({ ...onScreen, ...panes, picked: false })).toEqual(
      [],
    );
    expect(connectedPanes({ ...onScreen, ...panes, view: "details" })).toEqual(
      [],
    );
  });

  it("connects nothing for a work with no terminals", () => {
    expect(
      connectedPanes({
        ...onScreen,
        layout: "tabs",
        refs: [],
        front: undefined,
      }),
    ).toEqual([]);
  });
});

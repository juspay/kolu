// @vitest-environment happy-dom
import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shown } from "../../ui/shown";
import { closePeek, openPeek, peekTarget } from "./usePeek";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;

const seam = vi.hoisted(() => ({
  props: undefined as Record<string, unknown> | undefined,
}));

vi.mock("./PeekTerminal", () => ({
  default: (props: Record<string, unknown>) => {
    seam.props = props;
    return <div data-testid="peek-screen" />;
  },
}));
vi.mock("../../palette/fleetTerminals", () => ({
  fleetTerminalStanding: () => ({
    kind: "here",
    meta: {
      state: "active",
      foreground: null,
      agent: {
        kind: "claude-code",
        state: "thinking",
        summary: "writing the plan",
        taskProgress: null,
      },
    },
  }),
}));
vi.mock("../../ui/ModalDialog", () => ({
  default: (props: {
    open: boolean;
    escapeCloses?: boolean;
    children: unknown;
  }) => (
    <div
      data-open={props.open ? "" : undefined}
      data-escape-closes={String(props.escapeCloses)}
    >
      {props.children as never}
    </div>
  ),
}));
vi.mock("@corvu/dialog", () => ({
  default: {
    Content: (props: Record<string, unknown>) => <div {...props} />,
  },
}));

import TerminalPeek from "./TerminalPeek";

const [shown, setShown] = createSignal(true);

const mount = () => {
  const root = document.createElement("div");
  document.body.append(root);
  return render(
    () => (
      <Shown.Provider value={shown}>
        <TerminalPeek />
      </Shown.Provider>
    ),
    root,
  );
};

afterEach(() => {
  closePeek();
  setShown(true);
  seam.props = undefined;
});

describe("TerminalPeek", () => {
  it("draws nothing while no terminal is peeked at", () => {
    mount();
    expect(document.querySelector('[data-testid="terminal-peek"]')).toBeNull();
  });

  it("draws the window on the target and says what its agent is doing", () => {
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    expect(
      document.querySelector('[data-testid="terminal-peek"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-testid="peek-status"]')?.textContent,
    ).toBe("Thinking · writing the plan");
    expect(seam.props?.host).toBe("remote:nix@example");
    expect(seam.props?.id).toBe(ID);
  });

  it("closes on the window's ×", () => {
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    document
      .querySelector<HTMLButtonElement>('[data-testid="peek-close"]')
      ?.click();
    expect(peekTarget()).toBeNull();
  });

  it("closes when the Conductor stops being the view", () => {
    openPeek({ host: "remote:nix@example", id: ID });
    mount();
    setShown(false);
    expect(peekTarget()).toBeNull();
  });
});

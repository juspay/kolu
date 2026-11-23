// @vitest-environment happy-dom
import { decodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Shown } from "../../ui/shown";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;

const seam = vi.hoisted(() => ({
  PROC: { name: "terminalAttach" },
  entryKeys: [] as HostKey[],
  attached: [] as { proc: unknown; input: unknown }[],
  frames: [] as unknown[],
  sent: [] as { host: unknown; input: unknown }[],
  log: [] as string[],
  gateRefs: [] as string[],
  allowed: true,
  onData: undefined as ((data: string) => void) | undefined,
  keyHandler: undefined as ((e: { key: string }) => boolean) | undefined,
  /** Changes a signal the stand-in's `terminal.reset()` reads. */
  touchResetRead: undefined as (() => void) | undefined,
}));

vi.mock("../../wire", async () => {
  const { Effect } = await import("effect");
  return {
    padiMap: {
      useEntry: (key: () => HostKey) => {
        seam.entryKeys.push(key());
        return { streams: { terminalAttach: { unenrolled: seam.PROC } } };
      },
    },
    padiRpcOf: (host: HostKey) => ({
      lifecycle: {
        sendInput: (input: unknown) => {
          seam.sent.push({ host, input });
          return Effect.void;
        },
      },
    }),
    preferences: () => ({ scrollLock: true }),
  };
});

vi.mock("@kolu/surface/client", async () => {
  const { Stream } = await import("effect");
  return {
    unenrolledStreamCall: (proc: unknown, input: unknown) => {
      seam.attached.push({ proc, input });
      return Stream.concat(Stream.fromIterable(seam.frames), Stream.never);
    },
  };
});

vi.mock("@kolu/xterm-kit/solid", async () => {
  const { createSignal, onMount } = await import("solid-js");
  // A signal the screen's reset reads, as xterm's `reset()` runs the scroll
  // lock's listener, which reads the lock: whatever the attach effect calls
  // reads signals the effect must never restart on.
  const [resetRead, setResetRead] = createSignal(0);
  seam.touchResetRead = () => setResetRead((n) => n + 1);
  const handle = {
    container: document.createElement("div"),
    terminal: {
      reset() {
        resetRead();
        seam.log.push("reset");
      },
      focus() {},
      blur() {},
      textarea: document.createElement("textarea"),
      dimensions: undefined,
      onRender: () => ({ dispose() {} }),
      attachCustomKeyEventHandler: (fn: (e: { key: string }) => boolean) => {
        seam.keyHandler = fn;
      },
    },
    resize: (grid: { cols: number; rows: number }) =>
      seam.log.push(`resize ${grid.cols}x${grid.rows}`),
    write: (data: string, parsed?: () => void) => {
      seam.log.push(`write ${data}`);
      parsed?.();
    },
    clearPendingOutput() {},
    scrollLock: { reset() {}, isLocked: () => false },
    recovery: { noteData() {} },
  };
  return {
    measureGridBox: () => null,
    Xterm: (props: {
      onData: (data: string) => void;
      onReady: (h: unknown) => void;
    }) => {
      seam.onData = props.onData;
      onMount(() => props.onReady(handle));
      return <div data-testid="peek-screen" />;
    },
  };
});

vi.mock("../../palette/fleetTerminals", () => ({
  fleetTerminalStanding: () => ({
    kind: "here",
    meta: { state: "active", themeName: "Tomorrow Night" },
  }),
}));

vi.mock("../personInput", () => ({
  personInputAt: (ref: string) => {
    seam.gateRefs.push(ref);
    return seam.allowed;
  },
}));

import PeekTerminal from "./PeekTerminal";

const mount = () => {
  const [mayType, setMayType] = createSignal(false);
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <Shown.Provider value={() => true}>
        <PeekTerminal
          host="remote:nix@example"
          id={ID}
          fontSize={14}
          mayType={() => mayType()}
          onGrid={() => {}}
          onCell={() => {}}
          onPhase={() => {}}
          onHeld={() => {}}
          onFocus={() => {}}
          onHandle={() => {}}
          testId="peek-screen"
        />
      </Shown.Provider>
    ),
    root,
  );
  return { dispose, setMayType };
};

afterEach(() => {
  seam.entryKeys = [];
  seam.attached = [];
  seam.frames = [];
  seam.sent = [];
  seam.log = [];
  seam.gateRefs = [];
  seam.allowed = true;
  seam.onData = undefined;
  seam.keyHandler = undefined;
});

describe("PeekTerminal", () => {
  it("asks the terminal's own host for its attach stream", async () => {
    const { dispose } = mount();
    await vi.waitFor(() => expect(seam.attached).toHaveLength(1));
    expect(seam.entryKeys[0]).toEqual(decodeHostKey("remote:nix@example"));
    expect(seam.attached[0]?.proc).toBe(seam.PROC);
    dispose();
  });

  it("attaches with the id and no size", async () => {
    const { dispose } = mount();
    await vi.waitFor(() => expect(seam.attached).toHaveLength(1));
    expect(seam.attached[0]?.input).toEqual({ id: ID });
    dispose();
  });

  it("puts the stream's frames on the screen in order", async () => {
    seam.frames = [
      { kind: "snapshot", data: "A", topLine: 0, grid: { cols: 80, rows: 24 } },
      { kind: "delta", data: "B" },
    ];
    const { dispose } = mount();
    await vi.waitFor(() => expect(seam.log).toContain("write B"));
    expect(seam.log.slice(-3)).toEqual(["resize 80x24", "write A", "write B"]);
    dispose();
  });

  it("sends a key through the gate to the terminal's own host", async () => {
    const { dispose, setMayType } = mount();
    await vi.waitFor(() => expect(seam.onData).toBeDefined());

    seam.onData?.("x");
    await vi.waitFor(() => expect(seam.sent).toHaveLength(1));
    expect(seam.sent[0]?.host).toEqual(decodeHostKey("remote:nix@example"));
    expect(seam.sent[0]?.input).toEqual({ id: ID, data: "x" });
    expect(seam.gateRefs).toContain(`remote:nix@example/${ID}`);

    seam.allowed = false;
    seam.onData?.("y");
    expect(seam.sent).toHaveLength(1);

    expect(seam.keyHandler?.({ key: "Escape" })).toBe(false);
    setMayType(true);
    expect(seam.keyHandler?.({ key: "Escape" })).toBe(true);
    dispose();
  });

  it("re-attaches on nothing the attach reads: only shown and the tab's visibility", async () => {
    const { dispose } = mount();
    await vi.waitFor(() => expect(seam.attached).toHaveLength(1));
    const resets = seam.log.filter((l) => l === "reset").length;

    seam.touchResetRead?.();
    await Promise.resolve();

    expect({
      attaches: seam.attached.length,
      resets: seam.log.filter((l) => l === "reset").length,
    }).toEqual({ attaches: 1, resets });
    dispose();
  });
});
